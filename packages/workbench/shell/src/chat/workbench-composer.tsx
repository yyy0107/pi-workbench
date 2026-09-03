"use client";

import {
  ComposerPrimitive,
  type Attachment,
  type CreateAttachment,
  type Unstable_TriggerItem,
  unstable_useTriggerPopoverScopeContext,
  useAui,
  useAuiEvent,
  useAuiState,
} from "@assistant-ui/react";
import { DirectiveNode, type DirectiveChipProps } from "@assistant-ui/react-lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $nodesOfType,
  COMMAND_PRIORITY_NORMAL,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
} from "lexical";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
} from "react";

import { ComposerAttachments } from "../assistant-ui/attachment";
import { ComposerCommandToken } from "../elements/composer";
import { ComposerWorkspaceFeedback } from "../right-workspace/presentation";
import {
  COMPOSER_CONVERSATION_MENTION_TYPE,
  COMPOSER_WORKSPACE_FILE_MENTION_TYPE,
} from "@workbench/contracts/composer";
import { useI18n } from "../i18n";
import { useWorkbenchBranding } from "../presentation";
import { cn } from "../utils";
import { useComposerCommandRegistry, useExtensionErrorReporter } from "@workbench/extension-host";
import type {
  ComposerCommandArgsSchema,
  ComposerCommandDefinition,
  ComposerCommandArgsBinding,
  ComposerJsonValue,
  ComposerCommandRegistry,
} from "@workbench/extension-sdk";
import { SlotHost } from "@workbench/extension-host/hosts/slot-host";
import type { WorkbenchAgentComposerSendError } from "@workbench/agent-runtime-client/adapter";
import type { WorkbenchAgentCommand } from "@workbench/agent-runtime-contracts/commands";
import {
  readAgentComposerExtras,
  readAgentRejectedQueueDraft,
} from "@workbench/agent-runtime-client/extras";
import {
  useWorkbenchAgentCommands,
  useWorkbenchAgentWorkspaceFileSearch,
} from "@workbench/agent-runtime-client/context";
import { useWorkspaceSelection } from "@workbench/agent-runtime-client/workspaces";

import {
  applyComposerCommandArguments,
  applyImmediateComposerCommand,
  AGENT_COMMAND_DIRECTIVE_TYPE,
  agentSkillDirectiveType,
  COMMAND_ARGUMENT_END_DIRECTIVE_TYPE,
  compileComposerDocument,
  composerCommandArgumentKey,
  composerWorkspaceFileMentionId,
  isAgentComposerDirectiveType,
  parseComposerDocument,
  WORKBENCH_COMMAND_DIRECTIVE_TYPE,
  workbenchComposerDirectiveFormatter,
} from "./composer-document";
import { composerCommandArgumentHint } from "./composer-command-argument-hint";
import { ComposerCommandParameterPanel } from "./composer-command-parameter-panel";
import {
  composerCommandParameterFields,
  composerCommandParameterIssues,
  withComposerCommandParameterDefaults,
} from "./composer-command-parameters";
import { addComposerImagesFromPaste } from "./composer-image-paste";
import { ComposerTokenIcon, type ComposerTokenKind } from "./composer-token-icon";
import { MarkdownComposerInput } from "./markdown-composer-input";
import { submitWorkbenchComposer } from "./composer-submit";
import { ComposerTriggerEngine, excludeSlashPathOrCode } from "./composer-trigger-engine";
import { formatAgentCommandLabel } from "./agent-command";
import {
  ComposerAddMenuView,
  ComposerErrorAlertView,
  ComposerPrimaryActionView,
  WorkbenchComposerCommandMenuView,
  WorkbenchComposerContextMenuView,
  WorkbenchComposerSurfaceView,
  type WorkbenchComposerMenuSuggestion,
  type WorkbenchComposerSuggestionGroup,
} from "./workbench-composer-view";

interface ComposerDraftSnapshot {
  text: string;
  attachments: readonly (File | CreateAttachment)[];
}

interface WorkspaceFileMentionSearchState {
  readonly workspaceId?: string;
  readonly query: string;
  readonly items: readonly Unstable_TriggerItem[];
  readonly loading: boolean;
  readonly loadError: boolean;
}

const EMPTY_WORKSPACE_FILE_MENTION_SEARCH: WorkspaceFileMentionSearchState = {
  query: "",
  items: [],
  loading: false,
  loadError: false,
};

function restorableComposerAttachment(attachment: Attachment): File | CreateAttachment | undefined {
  if (attachment.file) return attachment.file;
  if (!attachment.content) return undefined;
  return {
    type: attachment.type,
    name: attachment.name,
    ...(attachment.contentType ? { contentType: attachment.contentType } : {}),
    content: [...attachment.content],
  };
}

interface WorkbenchComposerSuggestion extends WorkbenchComposerMenuSuggestion {
  readonly group: WorkbenchAgentCommand["kind"] | "workbench";
  readonly exclusive: boolean;
  readonly argsSchema?: ComposerCommandArgsSchema;
  readonly argsBinding?: ComposerCommandArgsBinding;
  readonly definition?: ComposerCommandDefinition;
}

type ComposerCommandParameterValues = Readonly<Record<string, ComposerJsonValue>>;
type ComposerCommandParametersByKey = Readonly<Record<string, ComposerCommandParameterValues>>;

const EMPTY_COMPOSER_COMMANDS = Object.freeze([]) as readonly ComposerCommandDefinition[];
type TriggerAdapter = NonNullable<
  ComponentProps<typeof ComposerPrimitive.Unstable_TriggerPopover>["adapter"]
>;

function suggestionKey(item: Pick<Unstable_TriggerItem, "id" | "type">): string {
  return `${item.type}:${item.id}`;
}

function suggestionParameterKey(item: Pick<Unstable_TriggerItem, "id" | "type">): string {
  return composerCommandArgumentKey(
    isAgentComposerDirectiveType(item.type) ? "agent" : "workbench",
    item.id,
  );
}

function suggestionHasParameterFields(
  suggestion: WorkbenchComposerSuggestion | undefined,
): boolean {
  return Boolean(
    suggestion?.argsSchema &&
    composerCommandParameterFields(suggestion.argsSchema, suggestion.argsBinding).length > 0,
  );
}

function suggestionGroupLabel(
  group: WorkbenchComposerSuggestionGroup,
  t: ReturnType<typeof useI18n>["t"],
  runtimeName: string,
): string {
  switch (group) {
    case "builtin":
      return t("workbench.chat.composer.commandGroups.builtin", { runtimeName });
    case "extension":
      return t("workbench.chat.composer.commandGroups.extension");
    case "prompt":
      return t("workbench.chat.composer.commandGroups.prompt");
    case "skill":
      return t("workbench.chat.composer.commandGroups.skill");
    case "workbench":
      return t("workbench.chat.composer.commandGroups.workbench");
  }
}

function commandSourceMeta(
  command: WorkbenchAgentCommand,
  t: ReturnType<typeof useI18n>["t"],
): string | undefined {
  if (command.kind === "builtin") return undefined;
  const parts = [t(`workbench.chat.composer.commandScopes.${command.source.scope}`)];
  if (command.source.label) parts.push(command.source.label);
  if (command.kind === "skill" && !command.modelInvocable) {
    parts.push(t("workbench.chat.composer.commandScopes.manualOnly"));
  }
  return parts.join(" · ");
}

function builtinCommandPresentation(
  command: WorkbenchAgentCommand,
  t: ReturnType<typeof useI18n>["t"],
): { label: string; description: string; argumentHint?: string } | undefined {
  if (command.kind !== "builtin") return undefined;
  switch (command.name) {
    case "compact":
      return {
        label: t("workbench.chat.composer.builtinCommands.compact.label"),
        description: t("workbench.chat.composer.builtinCommands.compact.description"),
        argumentHint: t("workbench.chat.composer.builtinCommands.compact.argumentHint"),
      };
    case "reload":
      return {
        label: t("workbench.chat.composer.builtinCommands.reload.label"),
        description: t("workbench.chat.composer.builtinCommands.reload.description"),
      };
  }
  return undefined;
}

function directiveGroup(
  item: Pick<Unstable_TriggerItem, "id" | "type">,
  registry: Pick<ComposerCommandRegistry, "get">,
): string | undefined {
  if (item.type !== WORKBENCH_COMMAND_DIRECTIVE_TYPE && !isAgentComposerDirectiveType(item.type)) {
    return undefined;
  }
  const definition = registry.get(item.id);
  if (!definition) return undefined;
  return (
    definition.composer.group ??
    (definition.composer.behavior === "modifier" ? `modifier:${definition.id}` : undefined)
  );
}

function $directiveAtSelection(item: Unstable_TriggerItem): DirectiveNode | undefined {
  const selection = $getSelection();
  if ($isRangeSelection(selection) && selection.isCollapsed()) {
    const anchor = selection.anchor;
    const anchorNode = anchor.getNode();
    const candidates = [];

    if ($isElementNode(anchorNode)) {
      candidates.push(anchorNode.getChildAtIndex(anchor.offset - 1));
      candidates.push(anchorNode.getChildAtIndex(anchor.offset));
    } else if ($isTextNode(anchorNode)) {
      if (anchor.offset === 0) candidates.push(anchorNode.getPreviousSibling());
      if (anchor.offset === anchorNode.getTextContentSize()) {
        candidates.push(anchorNode.getNextSibling());
      }
    }

    for (const candidate of candidates) {
      if (!(candidate instanceof DirectiveNode)) continue;
      const directive = candidate.getDirectiveItem();
      if (directive.id === item.id && directive.type === item.type) return candidate;
    }
  }

  return $nodesOfType(DirectiveNode)
    .toReversed()
    .find((node) => {
      const directive = node.getDirectiveItem();
      return directive.id === item.id && directive.type === item.type;
    });
}

function $removeDirectiveAndBuffer(node: DirectiveNode): void {
  const next = node.getNextSibling();
  if ($isTextNode(next) && next.getTextContent().startsWith(" ")) {
    const text = next.getTextContent();
    if (text === " ") next.remove();
    else next.setTextContent(text.slice(1));
  }
  node.remove();
}

function $selectAfterDirective(node: DirectiveNode): void {
  const next = node.getNextSibling();
  if ($isTextNode(next) && next.getTextContent().startsWith(" ")) {
    next.select(1, 1);
    return;
  }

  const buffer = $createTextNode(" ");
  node.insertAfter(buffer);
  buffer.select(1, 1);
}

function CaptureLexicalEditor({
  onChange,
}: Readonly<{ onChange(editor: LexicalEditor | null): void }>) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    onChange(editor);
    return () => onChange(null);
  }, [editor, onChange]);
  return null;
}

function ComposerEditableGuard({ enabled }: Readonly<{ enabled: boolean }>) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editor.setEditable(enabled);
  }, [editor, enabled]);
  return null;
}

function ComposerAccessibilityPlugin({
  enabled,
  label,
}: Readonly<{ enabled: boolean; label: string }>) {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () =>
      editor.registerRootListener((root, previousRoot) => {
        previousRoot?.removeAttribute("aria-label");
        previousRoot?.removeAttribute("aria-disabled");
        previousRoot?.removeAttribute("aria-description");
        root?.setAttribute("aria-label", label);
        root?.setAttribute("aria-disabled", enabled ? "false" : "true");
        root?.removeAttribute("aria-description");
      }),
    [editor, enabled, label],
  );
  return null;
}

function ComposerEnterPlugin({ onSubmit }: Readonly<{ onSubmit(steer: boolean): void }>) {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () =>
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          if (!event || event.isComposing || event.shiftKey) return false;
          event.preventDefault();
          event.stopPropagation();
          if (!event.repeat) onSubmit(event.ctrlKey || event.metaKey);
          return true;
        },
        COMMAND_PRIORITY_NORMAL,
      ),
    [editor, onSubmit],
  );
  return null;
}

function WorkbenchComposerCommandMenu({
  suggestions,
}: Readonly<{ suggestions: ReadonlyMap<string, WorkbenchComposerSuggestion> }>) {
  const { open, items, highlightedIndex } = unstable_useTriggerPopoverScopeContext();
  const { t } = useI18n();
  const { runtimeName } = useWorkbenchBranding();

  return (
    <WorkbenchComposerCommandMenuView
      open={open}
      items={items}
      highlightedIndex={highlightedIndex}
      suggestions={suggestions}
      groupLabel={(group) => suggestionGroupLabel(group, t, runtimeName)}
    />
  );
}

function WorkbenchComposerContextMenu({
  hasWorkspace,
  loadError,
  visible,
}: Readonly<{ hasWorkspace: boolean; loadError: boolean; visible: boolean }>) {
  const { open, items, highlightedIndex, isLoading } = unstable_useTriggerPopoverScopeContext();
  const { t } = useI18n();

  return (
    <WorkbenchComposerContextMenuView
      open={open}
      items={items}
      highlightedIndex={highlightedIndex}
      isLoading={isLoading}
      hasWorkspace={hasWorkspace}
      loadError={loadError}
      visible={visible}
      labels={{
        conversations: t("workbench.chat.composer.contextMentions.conversations"),
        workspaceFiles: t("workbench.chat.composer.contextMentions.workspaceFiles"),
        loading: t("workbench.chat.composer.contextMentions.loading"),
        loadError: t("workbench.chat.composer.contextMentions.loadError"),
        empty: t("workbench.chat.composer.contextMentions.empty"),
      }}
    />
  );
}

function composerErrorMessage(
  error: WorkbenchAgentComposerSendError,
  t: ReturnType<typeof useI18n>["t"],
) {
  switch (error) {
    case "model-attachment-unsupported":
      return t("workbench.chat.errors.modelDoesNotSupportAttachments");
    case "attachment-too-large":
      return t("workbench.chat.errors.attachmentTooLarge");
    case "too-many-attachments":
      return t("workbench.chat.errors.tooManyAttachments");
    case "attachment-invalid":
      return t("workbench.chat.errors.invalidAttachment");
  }
}

export function WorkbenchComposer({
  forceExistingThread = false,
}: Readonly<{ forceExistingThread?: boolean }> = {}) {
  const { t, text: localize } = useI18n();
  const aui = useAui();
  const { activeWorkspace, draftWorkspace } = useWorkspaceSelection();
  const contextWorkspace = draftWorkspace ?? activeWorkspace;
  const workspaceFileSearch = useWorkbenchAgentWorkspaceFileSearch();
  const composerCommandRegistry = useComposerCommandRegistry();
  const reportExtensionError = useExtensionErrorReporter();
  const getComposerCommands = useCallback(
    () => composerCommandRegistry.getAll(),
    [composerCommandRegistry],
  );
  const registeredComposerCommands = useSyncExternalStore(
    composerCommandRegistry.subscribe,
    getComposerCommands,
    () => EMPTY_COMPOSER_COMMANDS,
  );
  const extras = useAuiState((state) => state.thread.extras);
  const composerActions = readAgentComposerExtras(extras);
  const rejectedQueueDraftActions = readAgentRejectedQueueDraft(extras);
  const composerRef = useRef<HTMLFormElement>(null);
  const [composerOverlayCount, setComposerOverlayCount] = useState(0);
  const lexicalEditorRef = useRef<LexicalEditor | null>(null);
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const isEmpty = useAuiState((state) => state.thread.composer.isEmpty);
  const composerValue = useAuiState((state) => state.thread.composer.text);
  const composerAttachments = useAuiState((state) => state.thread.composer.attachments);
  const canSend = useAuiState((state) => state.thread.composer.canSend);
  const canQueue = useAuiState((state) => state.thread.capabilities.queue);
  const mainThreadId = useAuiState((state) => state.threads.mainThreadId);
  const newThreadId = useAuiState((state) => state.threads.newThreadId);
  const threadIds = useAuiState((state) => state.threads.threadIds);
  const archivedThreadIds = useAuiState((state) => state.threads.archivedThreadIds);
  const threadItems = useAuiState((state) => state.threads.threadItems);
  const isNewThread = !forceExistingThread && mainThreadId === newThreadId;
  const composerDrafts = useRef(new Map<string, ComposerDraftSnapshot>());
  const composerDraftThreadId = useRef(mainThreadId);
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const [isComposerComposing, setIsComposerComposing] = useState(false);
  const [composerCursorPosition, setComposerCursorPosition] = useState(0);
  const [submissionBlocked, setSubmissionBlocked] = useState(false);
  const [composerCommandError, setComposerCommandError] = useState(false);
  const [workspaceFileMentionSearch, setWorkspaceFileMentionSearch] =
    useState<WorkspaceFileMentionSearchState>(EMPTY_WORKSPACE_FILE_MENTION_SEARCH);
  const [queueRestoreErrorThreadId, setQueueRestoreErrorThreadId] = useState<string>();
  const queueRestoreError = queueRestoreErrorThreadId === mainThreadId;
  const commandParametersByThreadRef = useRef(new Map<string, ComposerCommandParametersByKey>());
  const [commandParametersByKey, setCommandParametersByKey] =
    useState<ComposerCommandParametersByKey>({});
  const [activeCommandParameterKey, setActiveCommandParameterKey] = useState<string>();
  const [commandParameterValidationKey, setCommandParameterValidationKey] = useState<string>();
  const agentCommands = useWorkbenchAgentCommands();
  const handledRejectedQueueDraft = useRef("");

  useAuiEvent("composer.send", ({ threadId, messageId }) => {
    if (messageId !== undefined) return;
    // assistant-ui removes the attachments selected for this send before it emits
    // composer.send. Invalidate Workbench's per-thread draft copy at the same boundary so an
    // intermediate sending snapshot cannot restore those attachments into a later turn. A
    // rejected send is still recoverable: assistant-ui restores it into the live composer and
    // the layout effect below records that restored draft again.
    composerDrafts.current.delete(threadId);
    composerDrafts.current.delete(composerDraftThreadId.current);
  });

  useLayoutEffect(() => {
    if (composerDraftThreadId.current === mainThreadId) {
      const attachments = composerAttachments.flatMap((attachment) => {
        const restorable = restorableComposerAttachment(attachment);
        return restorable ? [restorable] : [];
      });
      if (composerValue || attachments.length > 0) {
        composerDrafts.current.set(mainThreadId, { text: composerValue, attachments });
      } else {
        composerDrafts.current.delete(mainThreadId);
      }
      return;
    }

    composerDraftThreadId.current = mainThreadId;
    const draft = composerDrafts.current.get(mainThreadId);
    if (!draft || !isEmpty) return;

    const composer = aui.thread.composer();
    composer.setText(draft.text);
    void Promise.all(
      draft.attachments.map((attachment) => composer.addAttachment(attachment)),
    ).catch((error) => console.error("[workbench] failed to restore conversation draft", error));
  }, [aui, composerAttachments, composerValue, isEmpty, mainThreadId]);

  useEffect(() => {
    const rejected = rejectedQueueDraftActions?.rejectedDraft;
    const rejectionKey = rejected ? `${mainThreadId}:${rejected.revision}` : undefined;
    if (!rejected || !rejectionKey || handledRejectedQueueDraft.current === rejectionKey) return;
    handledRejectedQueueDraft.current = rejectionKey;

    const composer = aui.thread.composer();
    const current = composer.getState();
    const rejectedText = rejected.message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n\n");
    const restoredText = [rejectedText, current.text].filter(Boolean).join("\n\n");
    if (restoredText) composer.setText(restoredText);
    if (current.isEmpty) composer.setRunConfig(rejected.message.runConfig ?? {});

    const attachments = (rejected.message.attachments ?? []).flatMap((attachment) => {
      const restorable = restorableComposerAttachment(attachment);
      return restorable ? [restorable] : [];
    });
    void Promise.all(attachments.map((attachment) => composer.addAttachment(attachment))).catch(
      (error) => console.error("[workbench] failed to restore rejected queue attachments", error),
    );
    rejectedQueueDraftActions.clearRejectedDraft(rejected.revision);
    setQueueRestoreErrorThreadId(mainThreadId);
  }, [aui, mainThreadId, rejectedQueueDraftActions]);

  const composerSuggestions = useMemo<readonly WorkbenchComposerSuggestion[]>(() => {
    const definitions = new Map(
      registeredComposerCommands.map((definition) => [definition.id, definition]),
    );
    const agentCommandIds = new Set<string>();
    const suggestions: WorkbenchComposerSuggestion[] = [];

    for (const command of agentCommands) {
      agentCommandIds.add(command.invocationName);
      const definition = definitions.get(command.invocationName);
      const builtin = builtinCommandPresentation(command, t);
      const label = definition
        ? localize(definition.label)
        : (builtin?.label ?? formatAgentCommandLabel(command.name));
      const description = definition?.description
        ? localize(definition.description)
        : (builtin?.description ?? command.description ?? command.name);
      const argsSchema = definition?.composer.argsSchema ?? command.argsSchema;
      const argsBinding = definition?.composer.argsBinding ?? command.argsBinding;
      const argumentHint = composerCommandArgumentHint({
        explicitHint: builtin?.argumentHint ?? command.argumentHint,
        argsSchema,
        argsBinding,
      });
      const type =
        command.kind === "skill"
          ? (agentSkillDirectiveType(command.source.scope) ?? AGENT_COMMAND_DIRECTIVE_TYPE)
          : AGENT_COMMAND_DIRECTIVE_TYPE;
      suggestions.push({
        item: { id: command.invocationName, type, label, description },
        command: {
          name: command.invocationName,
          label,
          description,
          meta: commandSourceMeta(command, t),
          ...(argumentHint ? { argumentHint } : {}),
        },
        group: command.kind,
        exclusive: command.exclusive,
        ...(argsSchema ? { argsSchema } : {}),
        ...(argsBinding ? { argsBinding } : {}),
        ...(definition ? { definition } : {}),
      });
    }

    for (const definition of registeredComposerCommands) {
      if (agentCommandIds.has(definition.id)) continue;
      const label = localize(definition.label);
      const description = definition.description ? localize(definition.description) : label;
      const argumentHint = composerCommandArgumentHint({
        argsSchema: definition.composer.argsSchema,
        argsBinding: definition.composer.argsBinding,
      });
      suggestions.push({
        item: {
          id: definition.id,
          type: WORKBENCH_COMMAND_DIRECTIVE_TYPE,
          label,
          description,
        },
        command: {
          name: definition.id,
          label,
          description,
          ...(argumentHint ? { argumentHint } : {}),
        },
        group: "workbench",
        exclusive: definition.composer.exclusive ?? false,
        ...(definition.composer.argsSchema ? { argsSchema: definition.composer.argsSchema } : {}),
        ...(definition.composer.argsBinding
          ? { argsBinding: definition.composer.argsBinding }
          : {}),
        definition,
      });
    }

    return suggestions;
  }, [agentCommands, localize, registeredComposerCommands, t]);
  const composerSuggestionsByKey = useMemo(
    () =>
      new Map(
        composerSuggestions.map((suggestion) => [suggestionKey(suggestion.item), suggestion]),
      ),
    [composerSuggestions],
  );
  const composerSuggestionsByCommandKey = useMemo(
    () =>
      new Map(
        composerSuggestions.map((suggestion) => [
          composerCommandArgumentKey(
            isAgentComposerDirectiveType(suggestion.item.type) ? "agent" : "workbench",
            suggestion.item.id,
          ),
          suggestion,
        ]),
      ),
    [composerSuggestions],
  );
  const activeCommandParameterSuggestion = useMemo(
    () =>
      activeCommandParameterKey === undefined
        ? undefined
        : composerSuggestions.find(
            (suggestion) =>
              suggestionHasParameterFields(suggestion) &&
              suggestionParameterKey(suggestion.item) === activeCommandParameterKey,
          ),
    [activeCommandParameterKey, composerSuggestions],
  );
  const conversationContextItems = useMemo<readonly Unstable_TriggerItem[]>(() => {
    const itemsById = new Map(threadItems.map((item) => [item.id, item]));
    return [...new Set([...threadIds, ...archivedThreadIds])].flatMap((threadId) => {
      if (threadId === mainThreadId || threadId === newThreadId) return [];
      const thread = itemsById.get(threadId);
      if (!thread) return [];
      return [
        {
          id: thread.remoteId ?? thread.externalId ?? thread.id,
          type: COMPOSER_CONVERSATION_MENTION_TYPE,
          label:
            thread.title?.trim() ||
            t("workbench.chat.composer.contextMentions.untitledConversation"),
        },
      ];
    });
  }, [archivedThreadIds, mainThreadId, newThreadId, t, threadIds, threadItems]);
  const workspaceFileContextItems = useMemo<readonly Unstable_TriggerItem[]>(
    () =>
      workspaceFileMentionSearch.workspaceId === contextWorkspace?.id
        ? workspaceFileMentionSearch.items
        : [],
    [contextWorkspace?.id, workspaceFileMentionSearch],
  );
  const contextMentionDetectionEngine = useMemo(
    () =>
      new ComposerTriggerEngine<true>([
        {
          id: "context-mention",
          character: "@",
          search: () => [true],
        },
      ]),
    [],
  );
  const contextMentionMatch = useMemo(() => {
    if (!isComposerFocused) return undefined;
    return contextMentionDetectionEngine.detect({
      value: composerValue,
      cursorPosition: composerCursorPosition,
      isComposing: isComposerComposing,
    });
  }, [
    composerCursorPosition,
    composerValue,
    contextMentionDetectionEngine,
    isComposerComposing,
    isComposerFocused,
  ]);
  const activeContextMentionQuery = contextMentionMatch?.query;
  useEffect(() => {
    if (!contextWorkspace || activeContextMentionQuery === undefined || !workspaceFileSearch) {
      setWorkspaceFileMentionSearch(EMPTY_WORKSPACE_FILE_MENTION_SEARCH);
      return;
    }

    const workspaceId = contextWorkspace.id;
    const workspaceName = contextWorkspace.name;
    const query = activeContextMentionQuery;
    const controller = new AbortController();
    setWorkspaceFileMentionSearch({
      workspaceId,
      query,
      items: [],
      loading: true,
      loadError: false,
    });
    const timeout = window.setTimeout(
      () => {
        void workspaceFileSearch
          .search({ workspaceId, query, limit: 50, signal: controller.signal })
          .then((entries) => {
            if (controller.signal.aborted) return;
            setWorkspaceFileMentionSearch({
              workspaceId,
              query,
              items: entries.map((entry) => ({
                id: composerWorkspaceFileMentionId({
                  workspaceId,
                  relativePath: entry.relativePath,
                }),
                type: COMPOSER_WORKSPACE_FILE_MENTION_TYPE,
                label: entry.relativePath,
                description: workspaceName,
              })),
              loading: false,
              loadError: false,
            });
          })
          .catch(() => {
            if (controller.signal.aborted) return;
            setWorkspaceFileMentionSearch({
              workspaceId,
              query,
              items: [],
              loading: false,
              loadError: true,
            });
          });
      },
      query ? 120 : 0,
    );
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [activeContextMentionQuery, contextWorkspace, workspaceFileSearch]);
  const contextMentionAdapter = useMemo<TriggerAdapter>(
    () => ({
      categories: () => [],
      categoryItems: () => [],
      search: (query) => {
        if (!contextMentionMatch || contextMentionMatch.query !== query) return [];
        const normalized = query.toLocaleLowerCase();
        const conversations = conversationContextItems.filter(
          (item) =>
            item.label.toLocaleLowerCase().includes(normalized) ||
            item.id.toLocaleLowerCase().includes(normalized),
        );
        const workspaceFiles =
          workspaceFileMentionSearch.query === query ? workspaceFileContextItems : [];
        return [...conversations, ...workspaceFiles];
      },
    }),
    [
      contextMentionMatch,
      conversationContextItems,
      workspaceFileContextItems,
      workspaceFileMentionSearch.query,
    ],
  );
  const slashCommandTriggerEngine = useMemo(
    () =>
      new ComposerTriggerEngine<WorkbenchComposerSuggestion>([
        {
          id: "slash-command",
          character: "/",
          isExcluded: excludeSlashPathOrCode,
          search: (query) => {
            const normalized = query.toLowerCase();
            return composerSuggestions.filter(
              ({ item }) =>
                item.id.toLowerCase().startsWith(normalized) ||
                item.label.toLowerCase().startsWith(normalized) ||
                item.description?.toLowerCase().includes(normalized),
            );
          },
        },
      ]),
    [composerSuggestions],
  );
  const slashCommandAdapter = useMemo<TriggerAdapter>(
    () => ({
      categories: () => [],
      categoryItems: () => [],
      search: (query) => {
        if (!isComposerFocused) return [];
        const match = slashCommandTriggerEngine.detect({
          value: composerValue,
          cursorPosition: composerCursorPosition,
          isComposing: isComposerComposing,
        });
        if (!match || match.query !== query) return [];
        return match.suggestions.map(({ item }) => item);
      },
    }),
    [
      composerCursorPosition,
      composerValue,
      isComposerComposing,
      isComposerFocused,
      slashCommandTriggerEngine,
    ],
  );
  const hasDraftWorkspace = draftWorkspace !== undefined;
  const canSubmit = !isNewThread || hasDraftWorkspace;
  const context = { isRunning, isEmpty, submissionBlocked };
  const setComposerOverlayVisible = useCallback((visible: boolean) => {
    setComposerOverlayCount((count) => Math.max(0, count + (visible ? 1 : -1)));
  }, []);
  const composerOverlayContext = {
    ...context,
    setOverlayVisible: setComposerOverlayVisible,
  };
  const composerOverlayVisible = composerOverlayCount > 0;
  useEffect(() => {
    if (canSubmit) setSubmissionBlocked(false);
  }, [canSubmit]);

  useEffect(() => {
    setCommandParametersByKey(commandParametersByThreadRef.current.get(mainThreadId) ?? {});
    setActiveCommandParameterKey(undefined);
    setCommandParameterValidationKey(undefined);
  }, [mainThreadId]);

  useEffect(() => {
    const commandKeys = new Set(
      parseComposerDocument(composerValue)
        .filter((node) => node.type === "command")
        .map((node) => composerCommandArgumentKey(node.source, node.commandId)),
    );

    setCommandParametersByKey((current) => {
      const entries = Object.entries(current).filter(([key]) => commandKeys.has(key));
      if (entries.length === Object.keys(current).length) return current;
      const next = Object.fromEntries(entries);
      commandParametersByThreadRef.current.set(mainThreadId, next);
      return next;
    });
    setActiveCommandParameterKey((current) =>
      current && !commandKeys.has(current) ? undefined : current,
    );
    setCommandParameterValidationKey((current) =>
      current && !commandKeys.has(current) ? undefined : current,
    );
  }, [composerValue, mainThreadId]);

  useEffect(() => {
    setComposerCommandError(false);
  }, [composerValue]);

  const reportComposerCommandError = useCallback(
    (error: unknown, commandId?: string) => {
      setComposerCommandError(true);
      reportExtensionError(error, {
        source: "composer-command",
        ...(commandId ? { commandId } : {}),
      });
    },
    [reportExtensionError],
  );

  const updateCommandParameterValues = useCallback(
    (key: string, values: ComposerCommandParameterValues) => {
      setCommandParametersByKey((current) => {
        const next = { ...current, [key]: values };
        commandParametersByThreadRef.current.set(mainThreadId, next);
        return next;
      });
    },
    [mainThreadId],
  );

  const clearCommandParameterValues = useCallback(() => {
    commandParametersByThreadRef.current.delete(mainThreadId);
    setCommandParametersByKey({});
    setActiveCommandParameterKey(undefined);
    setCommandParameterValidationKey(undefined);
  }, [mainThreadId]);

  const handleDirectiveSelect = useCallback(
    (item: Unstable_TriggerItem) => {
      const editor = lexicalEditorRef.current;
      if (!editor) return;
      const selectedSuggestion = composerSuggestionsByKey.get(suggestionKey(item));
      const parameterSelection =
        selectedSuggestion?.argsSchema && suggestionHasParameterFields(selectedSuggestion)
          ? {
              key: suggestionParameterKey(item),
              values: withComposerCommandParameterDefaults(
                selectedSuggestion.argsSchema,
                selectedSuggestion.argsBinding,
                commandParametersByKey[suggestionParameterKey(item)],
              ),
            }
          : undefined;
      let immediateSelection:
        | { document: ReturnType<typeof parseComposerDocument>; index: number }
        | undefined;

      editor.update(
        () => {
          const selected = $directiveAtSelection(item);
          if (!selected) return;

          const selectedExclusive =
            composerSuggestionsByKey.get(suggestionKey(item))?.exclusive ?? false;
          for (const node of $nodesOfType(DirectiveNode)) {
            if (node === selected) continue;
            const directive = node.getDirectiveItem();
            const existingExclusive =
              composerSuggestionsByKey.get(suggestionKey(directive))?.exclusive ?? false;
            if (selectedExclusive || existingExclusive) $removeDirectiveAndBuffer(node);
          }

          const group = directiveGroup(item, composerCommandRegistry);
          if (group) {
            for (const node of $nodesOfType(DirectiveNode)) {
              if (node === selected) continue;
              if (directiveGroup(node.getDirectiveItem(), composerCommandRegistry) === group) {
                $removeDirectiveAndBuffer(node);
              }
            }
          }

          const definition = composerCommandRegistry.get(item.id);
          if (definition?.composer.behavior === "immediate") {
            const document = parseComposerDocument(
              $getRoot().getTextContent(),
              composerCommandRegistry,
              agentCommands,
            );
            const index = document.findLastIndex(
              (node) => node.type === "command" && node.commandId === item.id,
            );
            $removeDirectiveAndBuffer(selected);
            if (index >= 0) immediateSelection = { document, index };
            return;
          }

          $selectAfterDirective(selected);
        },
        {
          tag: "history-merge",
          onUpdate: () => {
            if (immediateSelection) {
              try {
                applyImmediateComposerCommand(
                  immediateSelection.document,
                  immediateSelection.index,
                  composerCommandRegistry,
                );
              } catch (error) {
                reportComposerCommandError(error, item.id);
              }
              return;
            }

            if (!parameterSelection) return;
            updateCommandParameterValues(parameterSelection.key, parameterSelection.values);
            setCommandParameterValidationKey(undefined);
            setActiveCommandParameterKey(parameterSelection.key);
          },
        },
      );
    },
    [
      commandParametersByKey,
      composerCommandRegistry,
      composerSuggestionsByKey,
      agentCommands,
      reportComposerCommandError,
      updateCommandParameterValues,
    ],
  );

  const dispatchComposer = useCallback(
    (steer = false) => {
      const threadState = aui.thread.getState();
      const composerState = aui.thread.composer().getState();
      if (!canSubmit) {
        setSubmissionBlocked(true);
        return;
      }
      if (threadState.isRunning && !threadState.capabilities.queue) return;

      try {
        const parsedDocument = parseComposerDocument(
          composerState.text,
          composerCommandRegistry,
          agentCommands,
        );
        let normalizedParameters = commandParametersByKey;
        for (const node of parsedDocument) {
          if (node.type !== "command") continue;
          const parameterKey = composerCommandArgumentKey(node.source, node.commandId);
          const suggestion = composerSuggestionsByCommandKey.get(parameterKey);
          if (!suggestion?.argsSchema || !suggestionHasParameterFields(suggestion)) continue;
          const values = withComposerCommandParameterDefaults(
            suggestion.argsSchema,
            suggestion.argsBinding,
            commandParametersByKey[parameterKey],
          );
          const issues = composerCommandParameterIssues(
            suggestion.argsSchema,
            suggestion.argsBinding,
            values,
          );
          if (Object.keys(issues).length > 0) {
            updateCommandParameterValues(parameterKey, values);
            setCommandParameterValidationKey(parameterKey);
            setActiveCommandParameterKey(parameterKey);
            setComposerCommandError(false);
            return;
          }
          normalizedParameters = { ...normalizedParameters, [parameterKey]: values };
        }
        const document = applyComposerCommandArguments(parsedDocument, normalizedParameters);
        const commandNodes = document.filter((node) => node.type === "command");
        if (
          commandNodes.length > 1 &&
          commandNodes.some(
            (node) =>
              composerSuggestionsByCommandKey.get(
                composerCommandArgumentKey(node.source, node.commandId),
              )?.exclusive,
          )
        ) {
          throw new Error("Exclusive Composer commands must be submitted separately");
        }
        const request = compileComposerDocument(document, composerCommandRegistry, agentCommands);
        const dispatched = submitWorkbenchComposer(aui.thread, undefined, request, { steer });
        if (!dispatched) return;
        setComposerCommandError(false);
        clearCommandParameterValues();
      } catch (error) {
        reportComposerCommandError(error);
      }
    },
    [
      aui,
      canSubmit,
      clearCommandParameterValues,
      commandParametersByKey,
      composerCommandRegistry,
      composerSuggestionsByCommandKey,
      agentCommands,
      reportComposerCommandError,
      updateCommandParameterValues,
    ],
  );

  const captureLexicalEditor = useCallback((editor: LexicalEditor | null) => {
    lexicalEditorRef.current = editor;
  }, []);

  const insertComposerTrigger = useCallback((trigger: "@" | "/") => {
    const editor = lexicalEditorRef.current;
    if (!editor) return;

    editor.focus(() => {
      editor.update(
        () => {
          let selection = $getSelection();
          if (!$isRangeSelection(selection)) {
            $getRoot().selectEnd();
            selection = $getSelection();
          }
          if ($isRangeSelection(selection)) selection.insertText(trigger);
        },
        { tag: "history-merge" },
      );
    });
  }, []);

  const updateComposerMarkdown = useCallback(
    (markdown: string) => aui.thread.composer().setText(markdown),
    [aui],
  );

  const renderDirectiveChip = useCallback(
    ({ directiveId, directiveType, label }: DirectiveChipProps) => {
      if (directiveType === COMMAND_ARGUMENT_END_DIRECTIVE_TYPE) {
        return (
          <span
            data-slot="composer-command-argument-end"
            aria-hidden="true"
            className="inline-block w-0 overflow-hidden"
          />
        );
      }
      const suggestion = composerSuggestionsByKey.get(
        suggestionKey({ id: directiveId, type: directiveType }),
      );
      const parameterKey = suggestionHasParameterFields(suggestion)
        ? suggestionParameterKey({ id: directiveId, type: directiveType })
        : undefined;
      const editLabel = parameterKey
        ? t("workbench.chat.composer.commandParameters.edit", { command: label })
        : undefined;
      const TokenIcon = suggestion?.definition?.icon;
      const tokenKind: ComposerTokenKind | undefined =
        directiveType === COMPOSER_CONVERSATION_MENTION_TYPE
          ? "conversation"
          : directiveType === COMPOSER_WORKSPACE_FILE_MENTION_TYPE
            ? "workspace-file"
            : suggestion?.group;
      return (
        <ComposerCommandToken
          icon={
            TokenIcon ? (
              <TokenIcon />
            ) : tokenKind ? (
              <ComposerTokenIcon kind={tokenKind} />
            ) : undefined
          }
          label={label}
          role={parameterKey ? "button" : undefined}
          tabIndex={parameterKey ? 0 : undefined}
          title={editLabel}
          aria-label={editLabel}
          className={cn(
            "mx-0.5 align-baseline",
            parameterKey &&
              "cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          )}
          onPointerDown={
            parameterKey
              ? (event) => {
                  event.preventDefault();
                  setCommandParameterValidationKey(undefined);
                  setActiveCommandParameterKey(parameterKey);
                }
              : undefined
          }
          onKeyDown={
            parameterKey
              ? (event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  setCommandParameterValidationKey(undefined);
                  setActiveCommandParameterKey(parameterKey);
                }
              : undefined
          }
        />
      );
    },
    [composerSuggestionsByKey, t],
  );

  return (
    <div className="grid w-full min-w-0 max-w-full grid-rows-[auto_auto_auto]">
      <SlotHost
        name="composer.before"
        context={context}
        className="col-start-1 row-start-1 flex flex-col gap-2 empty:hidden [&:not(:empty)]:mb-2"
      />

      <ComposerPrimitive.Unstable_TriggerPopoverRoot>
        <ComposerPrimitive.Root
          ref={composerRef}
          inert={composerOverlayVisible}
          aria-hidden={composerOverlayVisible || undefined}
          className="group/composer relative col-start-1 row-start-2 flex w-full min-w-0 max-w-full flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (!composerOverlayVisible) dispatchComposer();
          }}
        >
          <ComposerPrimitive.Unstable_TriggerPopover
            char="@"
            adapter={contextMentionAdapter}
            isLoading={workspaceFileMentionSearch.loading}
            aria-label={t("workbench.chat.composer.contextMentions.suggestions")}
            className="contents"
          >
            <ComposerPrimitive.Unstable_TriggerPopover.Directive
              formatter={workbenchComposerDirectiveFormatter}
            />
            <WorkbenchComposerContextMenu
              hasWorkspace={contextWorkspace !== undefined}
              loadError={workspaceFileMentionSearch.loadError}
              visible={isComposerFocused}
            />
          </ComposerPrimitive.Unstable_TriggerPopover>

          <ComposerPrimitive.Unstable_TriggerPopover
            char="/"
            adapter={slashCommandAdapter}
            aria-label={t("workbench.chat.composer.commandSuggestions")}
            className="contents"
          >
            <ComposerPrimitive.Unstable_TriggerPopover.Directive
              formatter={workbenchComposerDirectiveFormatter}
            />
            <WorkbenchComposerCommandMenu suggestions={composerSuggestionsByKey} />
          </ComposerPrimitive.Unstable_TriggerPopover>

          {activeCommandParameterSuggestion?.argsSchema ? (
            <ComposerCommandParameterPanel
              key={activeCommandParameterKey}
              command={{
                label: activeCommandParameterSuggestion.item.label,
                argsSchema: activeCommandParameterSuggestion.argsSchema,
                ...(activeCommandParameterSuggestion.argsBinding
                  ? { argsBinding: activeCommandParameterSuggestion.argsBinding }
                  : {}),
              }}
              values={
                activeCommandParameterKey
                  ? (commandParametersByKey[activeCommandParameterKey] ?? {})
                  : {}
              }
              revealValidation={commandParameterValidationKey === activeCommandParameterKey}
              onChange={(values) => {
                if (activeCommandParameterKey) {
                  updateCommandParameterValues(activeCommandParameterKey, values);
                }
              }}
              onClose={() => setActiveCommandParameterKey(undefined)}
            />
          ) : null}

          <WorkbenchComposerSurfaceView
            isNewThread={isNewThread}
            headerLeft={
              <SlotHost
                name="composer.header.left"
                context={context}
                className="flex min-w-0 flex-1 items-center gap-2 empty:hidden"
              />
            }
            headerRight={
              <SlotHost
                name="composer.header.right"
                context={context}
                className="flex min-w-0 shrink-0 items-center justify-end gap-2 empty:hidden"
              />
            }
            feedback={<ComposerWorkspaceFeedback />}
            attachments={<ComposerAttachments />}
            input={
              <MarkdownComposerInput
                submitMode="none"
                formatter={workbenchComposerDirectiveFormatter}
                value={composerValue}
                onChange={updateComposerMarkdown}
                directiveChip={renderDirectiveChip}
                directivePluginProps={{ onDirectiveSelect: handleDirectiveSelect }}
                onCursorPositionChange={setComposerCursorPosition}
                placeholder={t(
                  isRunning && canQueue
                    ? "workbench.chat.composer.runningPlaceholder"
                    : "workbench.chat.composer.placeholder",
                )}
                className={cn(
                  "relative max-h-[336px] min-w-0 flex-1 overflow-y-auto bg-transparent text-base leading-6 outline-none",
                  "[&_.aui-lexical-input]:min-h-7 [&_.aui-lexical-input]:whitespace-pre-wrap [&_.aui-lexical-input]:break-words [&_.aui-lexical-input]:outline-none",
                  "[&_.aui-lexical-placeholder]:text-muted-foreground/85 [&_.aui-lexical-placeholder]:pointer-events-none [&_.aui-lexical-placeholder]:absolute [&_.aui-lexical-placeholder]:start-0 [&_.aui-lexical-placeholder]:top-0",
                  isNewThread && "min-h-10 [&_.aui-lexical-input]:min-h-10",
                )}
                onFocusCapture={() => setIsComposerFocused(true)}
                onBlurCapture={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    setIsComposerFocused(false);
                  }
                }}
                onCompositionStartCapture={() => setIsComposerComposing(true)}
                onCompositionEndCapture={() => setIsComposerComposing(false)}
                onPasteCapture={(event) => {
                  const composer = aui.thread.composer();
                  void addComposerImagesFromPaste(event, {
                    attachmentsEnabled: aui.thread.getState().capabilities.attachments,
                    addAttachment: (file) => composer.addAttachment(file),
                  });
                }}
              >
                <CaptureLexicalEditor onChange={captureLexicalEditor} />
                <ComposerEditableGuard enabled />
                <ComposerAccessibilityPlugin
                  enabled
                  label={t("workbench.chat.composer.messageInput")}
                />
                <ComposerEnterPlugin onSubmit={dispatchComposer} />
              </MarkdownComposerInput>
            }
            actionsLeft={
              <>
                <SlotHost
                  name="composer.actions.left"
                  context={context}
                  className="flex min-w-0 items-center gap-2 empty:hidden"
                />
                <ComposerAddMenuView
                  labels={{
                    open: t("workbench.chat.composer.addMenu.open"),
                    attachment: t("workbench.chat.composer.addMenu.attachment"),
                    context: t("workbench.chat.composer.addMenu.context"),
                    capability: t("workbench.chat.composer.addMenu.capability"),
                  }}
                  onInsertTrigger={insertComposerTrigger}
                />
              </>
            }
            actionsRight={
              <>
                <SlotHost
                  name="composer.actions.right"
                  context={context}
                  className="flex min-w-0 items-center justify-end gap-2 empty:hidden"
                />
                <ComposerPrimaryActionView
                  isRunning={isRunning}
                  canSend={canSend}
                  sendLabel={t("workbench.chat.composer.sendMessage")}
                  stopLabel={t("workbench.chat.composer.stopGenerating")}
                  onSend={() => dispatchComposer()}
                />
              </>
            }
          />

          {composerActions?.error || composerCommandError || queueRestoreError ? (
            <ComposerErrorAlertView
              message={
                composerActions?.error
                  ? composerErrorMessage(composerActions.error, t)
                  : queueRestoreError
                    ? t("workbench.chat.errors.queueSendFailedRestored")
                    : t("workbench.chat.errors.commandCompileFailed")
              }
              dismissLabel={t("workbench.chat.composer.dismissError")}
              onDismiss={() => {
                composerActions?.clearError();
                setComposerCommandError(false);
                setQueueRestoreErrorThreadId(undefined);
              }}
            />
          ) : null}
        </ComposerPrimitive.Root>

        <SlotHost
          name="composer.overlay"
          context={composerOverlayContext}
          className={cn(
            "relative z-10 col-start-1 row-start-2 min-w-0 empty:hidden",
            !composerOverlayVisible && "pointer-events-none",
          )}
        />
      </ComposerPrimitive.Unstable_TriggerPopoverRoot>

      <SlotHost
        name="composer.after"
        context={context}
        className="col-start-1 row-start-3 flex flex-col gap-2 empty:hidden [&:not(:empty)]:mt-2"
      />
    </div>
  );
}
