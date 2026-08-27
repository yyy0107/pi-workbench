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
import { AlertCircleIcon, ArrowUpIcon, MicIcon, SquareIcon, XIcon } from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
} from "react";

import { ComposerAddAttachment, ComposerAttachments } from "@/components/assistant-ui/attachment";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import {
  type ComposerCommand,
  ComposerCommandItem,
  ComposerCommandToken,
  ComposerMenu,
} from "@/components/elements/composer";
import { ComposerWorkspaceFeedback } from "@/components/right-workspace";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  type ComposerCommandArgsSchema,
  type ComposerCommandDefinition,
  type ComposerCommandArgsBinding,
  type ComposerJsonValue,
  type ComposerCommandRegistry,
  useComposerCommandRegistry,
  useExtensionErrorReporter,
} from "@/platform/extensions";
import { SlotHost } from "@/platform/extensions/hosts/slot-host";
import type { WorkbenchAgentComposerSendError } from "@/runtime/assistant-ui/agent-runtime-adapter";
import type { WorkbenchAgentCommand } from "@/runtime/shared/agent-command/catalog";
import {
  readAgentComposerExtras,
  readAgentRejectedQueueDraft,
} from "@/runtime/assistant-ui/agent-runtime-extras";
import { useWorkbenchAgentCommands } from "@/runtime/assistant-ui/agent-runtime-context";
import { useWorkspaceSelection } from "@/services/workspace-selection-service";

import {
  applyComposerCommandArguments,
  applyImmediateComposerCommand,
  AGENT_COMMAND_DIRECTIVE_TYPE,
  agentSkillDirectiveType,
  COMMAND_ARGUMENT_END_DIRECTIVE_TYPE,
  compileComposerDocument,
  composerCommandArgumentKey,
  isAgentComposerDirectiveType,
  parseComposerDocument,
  WORKBENCH_COMMAND_DIRECTIVE_TYPE,
  workbenchComposerDirectiveFormatter,
} from "./composer-document";
import { composerCommandArgumentHint } from "./composer-command-argument-hint";
import { ComposerCommandParameterPanel } from "./composer-command-parameter-panel";
import { addComposerImagesFromPaste } from "./composer-image-paste";
import { MarkdownComposerInput } from "./markdown-composer-input";
import { submitWorkbenchComposer } from "./composer-submit";
import { ComposerTriggerEngine, excludeSlashPathOrCode } from "./composer-trigger-engine";
import { formatAgentCommandLabel } from "./agent-command";

const COMPOSER_PRIMARY_ACTION_CLASS_NAME =
  "rounded-[var(--button-radius)] [&:hover:not(:active)]:bg-primary! dark:[&:hover:not(:active)]:bg-primary!";

interface ComposerDraftSnapshot {
  text: string;
  attachments: readonly (File | CreateAttachment)[];
}

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

interface WorkbenchComposerSuggestion {
  readonly item: Unstable_TriggerItem;
  readonly command: ComposerCommand;
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

function suggestionGroupLabel(
  group: WorkbenchComposerSuggestion["group"],
  t: ReturnType<typeof useI18n>["t"],
): string {
  switch (group) {
    case "builtin":
      return t("workbench.chat.composer.commandGroups.builtin");
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

function ScrollingComposerCommandItem({
  suggestion,
  item,
  index,
  active,
}: Readonly<{
  suggestion: WorkbenchComposerSuggestion;
  item: Unstable_TriggerItem;
  index: number;
  active: boolean;
}>) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <ComposerPrimitive.Unstable_TriggerPopoverItem
      ref={ref}
      item={item}
      index={index}
      className="scroll-mt-8"
      render={<ComposerCommandItem command={suggestion.command} active={active} />}
      onPointerDown={(event) => event.preventDefault()}
    />
  );
}

function WorkbenchComposerCommandMenu({
  suggestions,
}: Readonly<{ suggestions: ReadonlyMap<string, WorkbenchComposerSuggestion> }>) {
  const { open, items, highlightedIndex } = unstable_useTriggerPopoverScopeContext();
  const { t } = useI18n();
  let previousGroup: WorkbenchComposerSuggestion["group"] | undefined;

  return (
    <ComposerMenu
      open={open && items.length > 0}
      className="max-h-[min(24rem,50vh)] w-full gap-2 overflow-y-auto p-1.5 pt-0 scroll-py-2"
    >
      {items.map((item, index) => {
        const suggestion = suggestions.get(suggestionKey(item));
        if (!suggestion) return null;
        const showGroupLabel = suggestion.group !== previousGroup;
        previousGroup = suggestion.group;
        return (
          <Fragment key={suggestionKey(item)}>
            {showGroupLabel && (
              <div
                role="presentation"
                className="bg-popover/95 text-muted-foreground sticky top-0 z-10 px-3 py-2 text-[11px] leading-4 font-medium backdrop-blur-sm"
              >
                {suggestionGroupLabel(suggestion.group, t)}
              </div>
            )}
            <ScrollingComposerCommandItem
              suggestion={suggestion}
              item={item}
              index={index}
              active={index === highlightedIndex}
            />
          </Fragment>
        );
      })}
    </ComposerMenu>
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

export function WorkbenchComposer() {
  const { t, text: localize } = useI18n();
  const aui = useAui();
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
  const isDictating = useAuiState((state) => state.thread.composer.dictation != null);
  const mainThreadId = useAuiState((state) => state.threads.mainThreadId);
  const newThreadId = useAuiState((state) => state.threads.newThreadId);
  const isNewThread = mainThreadId === newThreadId;
  const composerDrafts = useRef(new Map<string, ComposerDraftSnapshot>());
  const composerDraftThreadId = useRef(mainThreadId);
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const [isComposerComposing, setIsComposerComposing] = useState(false);
  const [composerCursorPosition, setComposerCursorPosition] = useState(0);
  const [composerCommandError, setComposerCommandError] = useState(false);
  const [queueRestoreErrorThreadId, setQueueRestoreErrorThreadId] = useState<string>();
  const queueRestoreError = queueRestoreErrorThreadId === mainThreadId;
  const commandParametersByThreadRef = useRef(new Map<string, ComposerCommandParametersByKey>());
  const [commandParametersByKey, setCommandParametersByKey] =
    useState<ComposerCommandParametersByKey>({});
  const [activeCommandParameterKey, setActiveCommandParameterKey] = useState<string>();
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
              suggestion.argsSchema &&
              suggestionParameterKey(suggestion.item) === activeCommandParameterKey,
          ),
    [activeCommandParameterKey, composerSuggestions],
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
  const hasDraftWorkspace = useWorkspaceSelection().draftWorkspace !== undefined;
  const canCompose = !isNewThread || hasDraftWorkspace;
  const context = { isRunning, isEmpty };
  const setComposerOverlayVisible = useCallback((visible: boolean) => {
    setComposerOverlayCount((count) => Math.max(0, count + (visible ? 1 : -1)));
  }, []);
  const composerOverlayContext = {
    ...context,
    setOverlayVisible: setComposerOverlayVisible,
  };
  const composerOverlayVisible = composerOverlayCount > 0;
  useEffect(() => {
    setCommandParametersByKey(commandParametersByThreadRef.current.get(mainThreadId) ?? {});
    setActiveCommandParameterKey(undefined);
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
  }, [mainThreadId]);

  const handleDirectiveSelect = useCallback(
    (item: Unstable_TriggerItem) => {
      const editor = lexicalEditorRef.current;
      if (!editor) return;
      const selectedSuggestion = composerSuggestionsByKey.get(suggestionKey(item));
      const parameterSelection = selectedSuggestion?.argsSchema
        ? {
            key: suggestionParameterKey(item),
            values: commandParametersByKey[suggestionParameterKey(item)] ?? {},
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
      if (!canCompose) return;
      if (threadState.isRunning && !threadState.capabilities.queue) return;

      try {
        const document = applyComposerCommandArguments(
          parseComposerDocument(composerState.text, composerCommandRegistry, agentCommands),
          commandParametersByKey,
        );
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
      canCompose,
      clearCommandParameterValues,
      commandParametersByKey,
      composerCommandRegistry,
      composerSuggestionsByCommandKey,
      agentCommands,
      reportComposerCommandError,
    ],
  );

  const captureLexicalEditor = useCallback((editor: LexicalEditor | null) => {
    lexicalEditorRef.current = editor;
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
      const parameterKey = suggestion?.argsSchema
        ? suggestionParameterKey({ id: directiveId, type: directiveType })
        : undefined;
      const editLabel = parameterKey
        ? t("workbench.chat.composer.commandParameters.edit", { command: label })
        : undefined;
      return (
        <ComposerCommandToken
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
                  setActiveCommandParameterKey(parameterKey);
                }
              : undefined
          }
          onKeyDown={
            parameterKey
              ? (event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
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
    <div className="grid w-full grid-rows-[auto_auto_auto]">
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
          className="group/composer relative col-start-1 row-start-2 flex w-full flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (!composerOverlayVisible) dispatchComposer();
          }}
        >
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

          {canCompose && activeCommandParameterSuggestion?.argsSchema ? (
            <ComposerCommandParameterPanel
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
              onChange={(values) => {
                if (activeCommandParameterKey) {
                  updateCommandParameterValues(activeCommandParameterKey, values);
                }
              }}
              onClose={() => setActiveCommandParameterKey(undefined)}
            />
          ) : null}

          <div
            data-slot="workbench-composer-shell"
            className={cn(
              "relative isolate flex w-full flex-col [--composer-height:104px]",
              isNewThread &&
                "bg-muted/45 overflow-hidden rounded-[var(--composer-radius,1.5rem)] border border-border/70 shadow-[0_2px_8px_rgba(0,0,0,0.06)] [--protruding-height:40px]",
            )}
          >
            {isNewThread ? (
              <div
                data-slot="workbench-composer-header"
                className="flex h-[var(--protruding-height)] min-w-0 shrink-0 items-center justify-between gap-2 px-3 py-1.5"
              >
                <SlotHost
                  name="composer.header.left"
                  context={context}
                  className="flex min-w-0 flex-1 items-center gap-2 empty:hidden"
                />
                <SlotHost
                  name="composer.header.right"
                  context={context}
                  className="flex min-w-0 shrink-0 items-center justify-end gap-2 empty:hidden"
                />
              </div>
            ) : null}

            <ComposerPrimitive.AttachmentDropzone
              data-slot="workbench-composer-card"
              className={cn(
                "bg-background data-[dragging=true]:bg-accent/50 flex min-h-[var(--composer-height)] flex-col overflow-hidden rounded-[var(--composer-inner-radius,1.375rem)] border shadow-[0_1px_3px_rgba(0,0,0,0.08)] outline-none transition-[border-color,box-shadow,background-color] data-[dragging=true]:border-dashed",
                isNewThread && "relative z-10 -mt-px",
              )}
            >
              <fieldset disabled={!canCompose} className="contents">
                <div className="flex min-h-[var(--composer-height)] flex-1 flex-col gap-2 pt-2 [--composer-action-inset:0.5rem] [padding-bottom:var(--composer-action-inset)] transition-opacity max-[360px]:[--composer-action-inset:0.375rem] [&>.aui-composer-attachments]:px-3">
                  <ComposerWorkspaceFeedback />
                  <ComposerAttachments />
                  <div className="flex min-h-0 w-full min-w-0 flex-1 items-stretch px-4 pt-0.5 pb-0">
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
                        !canCompose && "cursor-not-allowed text-muted-foreground",
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
                        if (!canCompose) return;
                        const composer = aui.thread.composer();
                        void addComposerImagesFromPaste(event, {
                          attachmentsEnabled: aui.thread.getState().capabilities.attachments,
                          addAttachment: (file) => composer.addAttachment(file),
                        });
                      }}
                    >
                      <CaptureLexicalEditor onChange={captureLexicalEditor} />
                      <ComposerEditableGuard enabled={canCompose} />
                      <ComposerAccessibilityPlugin
                        enabled={canCompose}
                        label={t("workbench.chat.composer.messageInput")}
                      />
                      <ComposerEnterPlugin onSubmit={dispatchComposer} />
                    </MarkdownComposerInput>
                  </div>

                  <div className="flex h-[var(--icon-frame-size-default)] shrink-0 items-center justify-between gap-2 [padding-inline:var(--composer-action-inset)] max-[360px]:gap-1">
                    <div className="flex h-full min-w-0 flex-1 items-center gap-2">
                      <SlotHost
                        name="composer.actions.left"
                        context={context}
                        className="flex min-w-0 items-center gap-2 empty:hidden"
                      />
                      <ComposerAddAttachment />
                    </div>

                    <div className="flex h-full min-w-0 shrink-0 items-center justify-end gap-2 max-[360px]:gap-1">
                      <SlotHost
                        name="composer.actions.right"
                        context={context}
                        className="flex min-w-0 items-center justify-end gap-2 empty:hidden"
                      />
                      {isDictating ? (
                        <ComposerPrimitive.StopDictation
                          render={
                            <TooltipIconButton
                              tooltip={t("workbench.chat.composer.stopVoiceInput")}
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="text-muted-foreground hover:text-foreground size-8 rounded-[var(--button-radius)] max-[360px]:hidden"
                            />
                          }
                        >
                          <SquareIcon className="size-4 fill-current" />
                        </ComposerPrimitive.StopDictation>
                      ) : (
                        <ComposerPrimitive.Dictate
                          render={
                            <TooltipIconButton
                              tooltip={t("workbench.chat.composer.voiceInput")}
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="text-muted-foreground hover:text-foreground size-8 rounded-[var(--button-radius)] max-[360px]:hidden"
                            />
                          }
                        >
                          <MicIcon className="size-4" />
                        </ComposerPrimitive.Dictate>
                      )}
                      {isRunning ? (
                        <ComposerPrimitive.Cancel
                          render={
                            <TooltipIconButton
                              tooltip={t("workbench.chat.composer.stopGenerating")}
                              type="button"
                              size="icon"
                              variant="default"
                              className={cn(COMPOSER_PRIMARY_ACTION_CLASS_NAME, "[&_svg]:size-3!")}
                            />
                          }
                        >
                          <SquareIcon className="size-3 fill-current" />
                        </ComposerPrimitive.Cancel>
                      ) : (
                        <TooltipIconButton
                          tooltip={t("workbench.chat.composer.sendMessage")}
                          type="button"
                          size="icon"
                          disabled={!canCompose || !canSend}
                          variant="default"
                          className={cn(
                            COMPOSER_PRIMARY_ACTION_CLASS_NAME,
                            "disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100",
                          )}
                          onClick={() => dispatchComposer()}
                        >
                          <ArrowUpIcon className="size-4" />
                        </TooltipIconButton>
                      )}
                    </div>
                  </div>
                </div>
              </fieldset>
            </ComposerPrimitive.AttachmentDropzone>
          </div>

          {composerActions?.error || composerCommandError || queueRestoreError ? (
            <div
              role="alert"
              aria-live="polite"
              className="border-destructive/25 bg-destructive/8 text-destructive mt-2 flex items-start gap-2 rounded-xl border px-3 py-2 text-sm"
            >
              <AlertCircleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                {composerActions?.error
                  ? composerErrorMessage(composerActions.error, t)
                  : queueRestoreError
                    ? t("workbench.chat.errors.queueSendFailedRestored")
                    : t("workbench.chat.errors.commandCompileFailed")}
              </span>
              <button
                type="button"
                aria-label={t("workbench.chat.composer.dismissError")}
                className="hover:bg-destructive/10 -m-1 rounded-md p-1"
                onClick={() => {
                  composerActions?.clearError();
                  setComposerCommandError(false);
                  setQueueRestoreErrorThreadId(undefined);
                }}
              >
                <XIcon aria-hidden="true" className="size-3.5" />
              </button>
            </div>
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
