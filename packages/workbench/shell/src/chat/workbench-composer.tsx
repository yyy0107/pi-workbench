"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $nodesOfType,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_NORMAL,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  type LexicalEditor,
} from "lexical";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

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
import type { WorkbenchAgentCommand } from "@workbench/agent-runtime-contracts/commands";
import {
  WORKBENCH_COMPOSER_ATTACHMENT_ACCEPT,
  composerAttachmentFromFile,
  useAgentRuntime,
  useConversationSession,
  useCurrentSession,
  useSessionState,
  useThreadList,
} from "@workbench/agent-runtime-client";
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
import { sortComposerSuggestions } from "./composer-command-group-order";
import { ComposerCommandParameterPanel } from "./composer-command-parameter-panel";
import {
  COMPOSER_COMMAND_TOKEN_ICON_ACCENT_CLASS_NAME,
  composerCommandIconColorMap,
} from "./composer-command-icon-color";
import {
  composerCommandParameterFields,
  composerCommandParameterIssues,
  withComposerCommandParameterDefaults,
} from "./composer-command-parameters";
import { addComposerImagesFromPaste } from "./composer-image-paste";
import { canRestorePastedText } from "@workbench/agent-runtime-contracts/composer-attachments";
import { addComposerTextFromPaste } from "./composer-text-paste";
import { ComposerAttachments } from "./composer-attachments";
import { ComposerHistoryKeyboardPlugin } from "./composer-history-keyboard-plugin";
import { getComposerInputHistory } from "./composer-input-history";
import {
  $insertDirectiveAtSelection,
  DirectiveNode,
  type ComposerTriggerItem,
  type DirectiveChipProps,
} from "./composer-directive";
import {
  ComposerCommandIcon,
  ComposerTokenIcon,
  type ComposerTokenKind,
} from "./composer-token-icon";
import { MarkdownComposerInput } from "./markdown-composer-input";
import {
  canSubmitWorkbenchComposer,
  runningComposerMode,
  submitWorkbenchComposer,
} from "./composer-submit";
import { useConversationPreferences } from "./conversation-preferences";
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

interface WorkspaceFileMentionSearchState {
  readonly workspaceId?: string;
  readonly query: string;
  readonly items: readonly ComposerTriggerItem[];
  readonly loading: boolean;
  readonly loadError: boolean;
}

const EMPTY_WORKSPACE_FILE_MENTION_SEARCH: WorkspaceFileMentionSearchState = {
  query: "",
  items: [],
  loading: false,
  loadError: false,
};

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

function suggestionKey(item: Pick<ComposerTriggerItem, "id" | "type">): string {
  return `${item.type}:${item.id}`;
}

function suggestionParameterKey(item: Pick<ComposerTriggerItem, "id" | "type">): string {
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
  count: number,
): string {
  switch (group) {
    case "builtin":
      return t("workbench.chat.composer.commandGroups.builtin", { runtimeName, count });
    case "extension":
      return t("workbench.chat.composer.commandGroups.extension", { count });
    case "prompt":
      return t("workbench.chat.composer.commandGroups.prompt", { count });
    case "skill":
      return t("workbench.chat.composer.commandGroups.skill", { count });
    case "workbench":
      return t("workbench.chat.composer.commandGroups.workbench", { count });
  }
}

function commandSourceMeta(
  command: WorkbenchAgentCommand,
  t: ReturnType<typeof useI18n>["t"],
): string | undefined {
  if (command.kind === "builtin") return undefined;
  return t(`workbench.chat.composer.commandScopes.${command.source.scope}`);
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
  item: Pick<ComposerTriggerItem, "id" | "type">,
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

function ComposerEnterPlugin({ onSubmit }: Readonly<{ onSubmit(invertMode?: boolean): void }>) {
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

function ComposerSuggestionKeyboardPlugin({
  active,
  items,
  highlightedIndex,
  onHighlightedIndexChange,
  onSelect,
  onDismiss,
}: Readonly<{
  active: boolean;
  items: readonly ComposerTriggerItem[];
  highlightedIndex: number;
  onHighlightedIndexChange(index: number): void;
  onSelect(item: ComposerTriggerItem): void;
  onDismiss(): void;
}>) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const move = (offset: number) => {
      if (!active || items.length === 0) return false;
      onHighlightedIndexChange((highlightedIndex + offset + items.length) % items.length);
      return true;
    };
    const unregister = [
      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        (event) => {
          if (!move(1)) return false;
          event?.preventDefault();
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        (event) => {
          if (!move(-1)) return false;
          event?.preventDefault();
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          const item = active ? items[highlightedIndex] : undefined;
          if (!item || event?.shiftKey) return false;
          event?.preventDefault();
          event?.stopPropagation();
          queueMicrotask(() => onSelect(item));
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        (event) => {
          if (!active) return false;
          event?.preventDefault();
          onDismiss();
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    ];
    return () => unregister.forEach((cleanup) => cleanup());
  }, [active, editor, highlightedIndex, items, onDismiss, onHighlightedIndexChange, onSelect]);
  return null;
}

function composerErrorMessage(error: string, t: ReturnType<typeof useI18n>["t"]): string {
  switch (error) {
    case "model-attachment-unsupported":
      return t("workbench.chat.errors.modelDoesNotSupportAttachments");
    case "attachment-too-large":
      return t("workbench.chat.errors.attachmentTooLarge");
    case "too-many-attachments":
      return t("workbench.chat.errors.tooManyAttachments");
    case "attachment-invalid":
      return t("workbench.chat.errors.invalidAttachment");
    default:
      return t("workbench.chat.errors.queueSendFailedRestored");
  }
}

export function WorkbenchComposer({
  forceExistingThread = false,
}: Readonly<{ forceExistingThread?: boolean }> = {}) {
  const { t, text: localize } = useI18n();
  const { runtimeName } = useWorkbenchBranding();
  const runtime = useAgentRuntime();
  const session = useConversationSession();
  const currentSession = useCurrentSession();
  const composer = useSessionState((snapshot) => snapshot.composer);
  const isRunning = useSessionState((snapshot) => snapshot.isRunning);
  const threads = useThreadList((snapshot) => snapshot.threads);
  const composerValue = composer.text;
  const composerAttachments = composer.attachments;
  const isEmpty = !composerValue.trim() && composerAttachments.length === 0;
  const preferredRunningMode = useConversationPreferences(
    (state) => state.preferences.runningMessageMode,
  );
  const runningMode = runningComposerMode(session.actions, preferredRunningMode);
  const canSendWhileRunning = session.actions[runningMode] !== undefined;
  const canSend =
    composer.phase !== "submitting" &&
    !isEmpty &&
    !composerAttachments.some((item) => item.kind === "pasted-text" && item.status !== "ready");
  const attachmentsEnabled = session.actions.addComposerAttachment !== undefined;
  const mainThreadId = session.id;
  const isNewThread =
    !forceExistingThread && currentSession.sessionId === mainThreadId && currentSession.isNewThread;
  const { activeWorkspace, draftWorkspace } = useWorkspaceSelection();
  const inputHistory = getComposerInputHistory(runtime, session, draftWorkspace?.id);
  const navigateInputHistory = useCallback(
    (direction: "previous" | "next") => inputHistory.navigate(session, direction),
    [inputHistory, session],
  );
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
  const composerRef = useRef<HTMLFormElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [composerOverlayCount, setComposerOverlayCount] = useState(0);
  const lexicalEditorRef = useRef<LexicalEditor | null>(null);
  const activeSessionRef = useRef(session);
  activeSessionRef.current = session;
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const [isComposerComposing, setIsComposerComposing] = useState(false);
  const [composerCursorPosition, setComposerCursorPosition] = useState(0);
  const [contextHighlightedIndex, setContextHighlightedIndex] = useState(0);
  const [commandHighlightedIndex, setCommandHighlightedIndex] = useState(0);
  const [suppressedMatchKey, setSuppressedMatchKey] = useState<string>();
  const [submissionBlocked, setSubmissionBlocked] = useState(false);
  const submissionGuards = useRef(new Set<() => boolean>());
  const registerSubmissionGuard = useCallback((guard: () => boolean) => {
    submissionGuards.current.add(guard);
    return () => {
      submissionGuards.current.delete(guard);
    };
  }, []);
  const [composerCommandError, setComposerCommandError] = useState(false);
  const [workspaceFileMentionSearch, setWorkspaceFileMentionSearch] =
    useState<WorkspaceFileMentionSearchState>(EMPTY_WORKSPACE_FILE_MENTION_SEARCH);
  const commandParametersByThreadRef = useRef(new Map<string, ComposerCommandParametersByKey>());
  const [commandParametersByKey, setCommandParametersByKey] =
    useState<ComposerCommandParametersByKey>({});
  const [activeCommandParameterKey, setActiveCommandParameterKey] = useState<string>();
  const [commandParameterValidationKey, setCommandParameterValidationKey] = useState<string>();
  const agentCommands = useWorkbenchAgentCommands();

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

    return sortComposerSuggestions(suggestions);
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
  const conversationContextItems = useMemo<readonly ComposerTriggerItem[]>(
    () =>
      threads.flatMap((thread) =>
        thread.threadId === mainThreadId
          ? []
          : [
              {
                id: thread.threadId,
                type: COMPOSER_CONVERSATION_MENTION_TYPE,
                label:
                  thread.title?.trim() ||
                  t("workbench.chat.composer.contextMentions.untitledConversation"),
              },
            ],
      ),
    [mainThreadId, t, threads],
  );
  const workspaceFileContextItems = useMemo<readonly ComposerTriggerItem[]>(
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
  const contextMentionItems = useMemo<readonly ComposerTriggerItem[]>(() => {
    const query = contextMentionMatch?.query;
    if (query === undefined) return [];
    const normalized = query.toLocaleLowerCase();
    const conversations = conversationContextItems.filter(
      (item) =>
        item.label.toLocaleLowerCase().includes(normalized) ||
        item.id.toLocaleLowerCase().includes(normalized),
    );
    const workspaceFiles =
      workspaceFileMentionSearch.query === query ? workspaceFileContextItems : [];
    return [...conversations, ...workspaceFiles];
  }, [
    contextMentionMatch?.query,
    conversationContextItems,
    workspaceFileContextItems,
    workspaceFileMentionSearch.query,
  ]);
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
  const slashCommandMatch = useMemo(
    () =>
      isComposerFocused
        ? slashCommandTriggerEngine.detect({
            value: composerValue,
            cursorPosition: composerCursorPosition,
            isComposing: isComposerComposing,
          })
        : undefined,
    [
      composerCursorPosition,
      composerValue,
      isComposerComposing,
      isComposerFocused,
      slashCommandTriggerEngine,
    ],
  );
  const slashCommandItems = useMemo(
    () => slashCommandMatch?.suggestions.map(({ item }) => item) ?? [],
    [slashCommandMatch],
  );
  const commandIconColorBySuggestionKey = useMemo(
    () => composerCommandIconColorMap(slashCommandItems),
    [slashCommandItems],
  );
  const contextMenuOpen =
    contextMentionMatch !== undefined && suppressedMatchKey !== contextMentionMatch.key;
  const commandMenuOpen =
    slashCommandMatch !== undefined && suppressedMatchKey !== slashCommandMatch.key;
  useEffect(() => setContextHighlightedIndex(0), [contextMentionMatch?.key]);
  useEffect(() => setCommandHighlightedIndex(0), [slashCommandMatch?.key]);
  const hasDraftWorkspace = draftWorkspace !== undefined;
  const canSubmit = !isNewThread || hasDraftWorkspace;
  const context = { isRunning, isEmpty, submissionBlocked, registerSubmissionGuard };
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
    lexicalEditorRef.current?.focus();
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
    (item: ComposerTriggerItem, trigger: "@" | "/") => {
      const editor = lexicalEditorRef.current;
      if (!editor) return;
      setSuppressedMatchKey(undefined);
      const selectedSuggestionKey = suggestionKey(item);
      const selectedSuggestion = composerSuggestionsByKey.get(selectedSuggestionKey);
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
          const selected = $insertDirectiveAtSelection(
            trigger,
            item,
            workbenchComposerDirectiveFormatter,
          );
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
    (invertMode = false) => {
      const steer =
        runningComposerMode(session.actions, preferredRunningMode, invertMode) === "steer";
      const snapshot = session.snapshot.getSnapshot();
      if (
        snapshot.composer.phase === "submitting" ||
        snapshot.composer.attachments.some(
          (item) => item.kind === "pasted-text" && item.status !== "ready",
        )
      )
        return;
      if (!canSubmitWorkbenchComposer(canSubmit, submissionGuards.current)) {
        setSubmissionBlocked(true);
        return;
      }
      if (
        snapshot.isRunning &&
        (steer ? session.actions.steer === undefined : session.actions.queue === undefined)
      ) {
        return;
      }

      try {
        const parsedDocument = parseComposerDocument(
          snapshot.composer.text,
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
        lexicalEditorRef.current?.focus();
        void submitWorkbenchComposer(session, request, { steer }).then(
          (dispatched) => {
            if (!dispatched) return;
            inputHistory.record(session, snapshot.composer.text);
            setComposerCommandError(false);
            clearCommandParameterValues();
          },
          () => undefined,
        );
      } catch (error) {
        reportComposerCommandError(error);
      }
    },
    [
      canSubmit,
      clearCommandParameterValues,
      commandParametersByKey,
      composerCommandRegistry,
      composerSuggestionsByCommandKey,
      agentCommands,
      inputHistory,
      reportComposerCommandError,
      preferredRunningMode,
      session,
      updateCommandParameterValues,
    ],
  );

  const captureLexicalEditor = useCallback((editor: LexicalEditor | null) => {
    lexicalEditorRef.current = editor;
  }, []);

  const focusComposerInput = useCallback(() => {
    lexicalEditorRef.current?.focus();
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

  const restorePastedText = useCallback(
    async (key: string) => {
      const item = session.snapshot
        .getSnapshot()
        .composer.attachments.find((entry) => entry.key === key);
      const editor = lexicalEditorRef.current;
      const read = session.actions.readPastedTextAttachment;
      if (
        !editor ||
        !read ||
        item?.kind !== "pasted-text" ||
        item.status !== "ready" ||
        !canRestorePastedText(item.attachment.characterCount)
      )
        throw new Error("Text attachment cannot be restored");
      const page = await read({ id: item.attachment.id });
      if (
        page.nextOffset !== undefined ||
        !canRestorePastedText(page.text.length) ||
        page.text.length !== item.attachment.characterCount
      )
        throw new Error("Incomplete text attachment");
      if (
        activeSessionRef.current !== session ||
        lexicalEditorRef.current !== editor ||
        !session.snapshot.getSnapshot().composer.attachments.includes(item)
      )
        throw new Error("Composer changed");
      await new Promise<void>((resolve, reject) =>
        editor.focus(() => {
          if (
            activeSessionRef.current !== session ||
            lexicalEditorRef.current !== editor ||
            !session.snapshot.getSnapshot().composer.attachments.includes(item)
          ) {
            reject(new Error("Composer changed"));
            return;
          }
          let inserted = false;
          editor.update(
            () => {
              let selection = $getSelection();
              if (!$isRangeSelection(selection)) {
                $getRoot().selectEnd();
                selection = $getSelection();
              }
              if ($isRangeSelection(selection)) {
                selection.insertRawText(page.text);
                inserted = true;
              }
            },
            {
              discrete: true,
              tag: "history-push",
              onUpdate: () => {
                if (!inserted) {
                  reject(new Error("Editor selection unavailable"));
                  return;
                }
                session.actions.removeComposerAttachment?.(key);
                resolve();
              },
            },
          );
        }),
      );
    },
    [session],
  );

  const updateComposerMarkdown = useCallback(
    (markdown: string) => session.actions.setComposerText?.(markdown),
    [session],
  );

  const addComposerFiles = useCallback(
    async (files: readonly File[]) => {
      const addAttachment = session.actions.addComposerAttachment;
      if (!addAttachment) return;
      try {
        await Promise.all(
          files.map(async (file) => addAttachment(await composerAttachmentFromFile(file))),
        );
      } catch (error) {
        console.error("[workbench] add composer attachment failed", error);
      }
    },
    [session],
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
      const directiveSuggestionKey = suggestionKey({ id: directiveId, type: directiveType });
      const suggestion = composerSuggestionsByKey.get(directiveSuggestionKey);
      const parameterKey = suggestionHasParameterFields(suggestion)
        ? suggestionParameterKey({ id: directiveId, type: directiveType })
        : undefined;
      const editLabel = parameterKey
        ? t("workbench.chat.composer.commandParameters.edit", { command: label })
        : undefined;
      const tokenKind: ComposerTokenKind | undefined =
        directiveType === COMPOSER_CONVERSATION_MENTION_TYPE
          ? "conversation"
          : directiveType === COMPOSER_WORKSPACE_FILE_MENTION_TYPE
            ? "workspace-file"
            : suggestion?.group;
      return (
        <ComposerCommandToken
          icon={
            suggestion ? (
              <ComposerCommandIcon kind={suggestion.group} />
            ) : tokenKind ? (
              <ComposerTokenIcon kind={tokenKind} />
            ) : undefined
          }
          iconClassName={suggestion ? COMPOSER_COMMAND_TOKEN_ICON_ACCENT_CLASS_NAME : undefined}
          iconSize="md-lg"
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

      <form
        ref={composerRef}
        inert={composerOverlayVisible}
        aria-hidden={composerOverlayVisible || undefined}
        className="group/composer relative col-start-1 row-start-2 flex w-full min-w-0 max-w-full flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          if (!composerOverlayVisible) dispatchComposer();
        }}
      >
        <WorkbenchComposerContextMenuView
          open={contextMenuOpen}
          items={contextMentionItems}
          highlightedIndex={contextHighlightedIndex}
          isLoading={workspaceFileMentionSearch.loading}
          hasWorkspace={contextWorkspace !== undefined}
          loadError={workspaceFileMentionSearch.loadError}
          visible={isComposerFocused}
          ariaLabel={t("workbench.chat.composer.contextMentions.suggestions")}
          labels={{
            conversations: t("workbench.chat.composer.contextMentions.conversations"),
            workspaceFiles: t("workbench.chat.composer.contextMentions.workspaceFiles"),
            loading: t("workbench.chat.composer.contextMentions.loading"),
            loadError: t("workbench.chat.composer.contextMentions.loadError"),
            empty: t("workbench.chat.composer.contextMentions.empty"),
          }}
          onSelect={(item) => handleDirectiveSelect(item, "@")}
        />
        <WorkbenchComposerCommandMenuView
          open={commandMenuOpen}
          items={slashCommandItems}
          highlightedIndex={commandHighlightedIndex}
          suggestions={composerSuggestionsByKey}
          iconColorBySuggestionKey={commandIconColorBySuggestionKey}
          groupLabel={(group, count) => suggestionGroupLabel(group, t, runtimeName, count)}
          ariaLabel={t("workbench.chat.composer.commandSuggestions")}
          onSelect={(item) => handleDirectiveSelect(item, "/")}
        />

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
          isRunning={isRunning}
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
          attachments={
            <ComposerAttachments
              attachments={composerAttachments}
              onRemove={(key) => session.actions.removeComposerAttachment?.(key)}
              onRetry={(key) => {
                void session.actions.retryPastedTextAttachment?.(key);
              }}
              onRestore={restorePastedText}
            />
          }
          input={
            <MarkdownComposerInput
              autoFocus={composer.phase === "submitting"}
              formatter={workbenchComposerDirectiveFormatter}
              value={composerValue}
              onChange={updateComposerMarkdown}
              directiveChip={renderDirectiveChip}
              onCursorPositionChange={setComposerCursorPosition}
              placeholder={t(
                isRunning && canSendWhileRunning
                  ? runningMode === "steer"
                    ? "workbench.chat.composer.runningSteerPlaceholder"
                    : "workbench.chat.composer.runningPlaceholder"
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
                if (addComposerTextFromPaste(event, session.actions.addPastedTextAttachment))
                  return;
                void addComposerImagesFromPaste(event, {
                  attachmentsEnabled,
                  addAttachment: async (file) => addComposerFiles([file]),
                });
              }}
            >
              <CaptureLexicalEditor onChange={captureLexicalEditor} />
              <ComposerAccessibilityPlugin
                enabled
                label={t("workbench.chat.composer.messageInput")}
              />
              <ComposerSuggestionKeyboardPlugin
                active={contextMenuOpen}
                items={contextMentionItems}
                highlightedIndex={contextHighlightedIndex}
                onHighlightedIndexChange={setContextHighlightedIndex}
                onSelect={(item) => handleDirectiveSelect(item, "@")}
                onDismiss={() => setSuppressedMatchKey(contextMentionMatch?.key)}
              />
              <ComposerSuggestionKeyboardPlugin
                active={commandMenuOpen}
                items={slashCommandItems}
                highlightedIndex={commandHighlightedIndex}
                onHighlightedIndexChange={setCommandHighlightedIndex}
                onSelect={(item) => handleDirectiveSelect(item, "/")}
                onDismiss={() => setSuppressedMatchKey(slashCommandMatch?.key)}
              />
              <ComposerEnterPlugin onSubmit={dispatchComposer} />
              <ComposerHistoryKeyboardPlugin
                enabled={
                  !isComposerComposing &&
                  !contextMenuOpen &&
                  !commandMenuOpen &&
                  !composerOverlayVisible &&
                  composer.phase !== "submitting"
                }
                onNavigate={navigateInputHistory}
              />
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
                attachmentsEnabled={attachmentsEnabled}
                labels={{
                  open: t("workbench.chat.composer.addMenu.open"),
                  attachment: t("workbench.chat.composer.addMenu.attachment"),
                  context: t("workbench.chat.composer.addMenu.context"),
                  capability: t("workbench.chat.composer.addMenu.capability"),
                }}
                onInsertTrigger={insertComposerTrigger}
                onChooseAttachment={() => attachmentInputRef.current?.click()}
              />
              <input
                ref={attachmentInputRef}
                type="file"
                multiple
                accept={WORKBENCH_COMPOSER_ATTACHMENT_ACCEPT}
                tabIndex={-1}
                className="sr-only"
                onChange={(event) => {
                  void addComposerFiles(Array.from(event.currentTarget.files ?? []));
                  event.currentTarget.value = "";
                }}
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
                sendLabel={t(
                  isRunning
                    ? runningMode === "steer"
                      ? "workbench.chat.composer.steerMessage"
                      : "workbench.chat.composer.queueFollowUp"
                    : "workbench.chat.composer.sendMessage",
                )}
                stopLabel={t("workbench.chat.composer.stopGenerating")}
                onSend={() => dispatchComposer()}
                onCancel={() => void session.actions.cancel?.().catch(console.error)}
              />
            </>
          }
          attachmentsEnabled={attachmentsEnabled}
          onDropFiles={(files) => void addComposerFiles(files)}
          onCardClick={focusComposerInput}
        />

        {composer.error || composerCommandError ? (
          <ComposerErrorAlertView
            message={
              composer.error
                ? composerErrorMessage(composer.error.code, t)
                : t("workbench.chat.errors.commandCompileFailed")
            }
            dismissLabel={t("workbench.chat.composer.dismissError")}
            onDismiss={() => {
              session.actions.dismissComposerError?.();
              setComposerCommandError(false);
            }}
          />
        ) : null}
      </form>

      <SlotHost
        name="composer.overlay"
        context={composerOverlayContext}
        className={cn(
          "relative z-10 col-start-1 row-start-2 min-w-0 empty:hidden",
          !composerOverlayVisible && "pointer-events-none",
        )}
      />

      <SlotHost
        name="composer.after"
        context={context}
        className="col-start-1 row-start-3 flex flex-col gap-2 empty:hidden [&:not(:empty)]:mt-2"
      />
    </div>
  );
}
