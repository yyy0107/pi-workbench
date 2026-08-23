"use client";

import {
  type AppendMessage,
  ComposerPrimitive,
  type Attachment,
  type CreateAttachment,
  type Unstable_TriggerItem,
  unstable_useTriggerPopoverScopeContext,
  useAui,
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
  AlertCircleIcon,
  ArrowUpIcon,
  CuboidIcon,
  MicIcon,
  PlusIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
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
  SlotHost,
  useComposerCommandRegistry,
  useExtensionErrorReporter,
} from "@/platform/extensions";
import { useExtensionManager } from "@/platform/extensions/internal";
import { usePiCommands } from "@/runtime/pi/client/runtime/command-context";
import type { CommandView } from "@/runtime/pi/rpc-contracts";
import type { PiComposerSendError } from "@/runtime/pi/client/runtime/send-error";
import { useWorkspaceSelection } from "@/services/workspace-selection-service";

import {
  applyComposerCommandArguments,
  applyImmediateComposerCommand,
  COMMAND_ARGUMENT_END_DIRECTIVE_TYPE,
  compileComposerDocument,
  composerCommandArgumentKey,
  parseComposerDocument,
  PI_COMMAND_DIRECTIVE_TYPE,
  WORKBENCH_COMMAND_DIRECTIVE_TYPE,
  workbenchComposerDirectiveFormatter,
} from "./composer-document";
import { composerCommandArgumentHint } from "./composer-command-argument-hint";
import { ComposerCommandParameterPanel } from "./composer-command-parameter-panel";
import { addComposerImagesFromPaste } from "./composer-image-paste";
import { MarkdownComposerInput } from "./markdown-composer-input";
import { submitWorkbenchComposer } from "./composer-submit";
import { ComposerTriggerEngine, excludeSlashPathOrCode } from "./composer-trigger-engine";
import { formatPiCommandLabel } from "./pi-command";

const COMPOSER_PRIMARY_ACTION_CLASS_NAME =
  "rounded-full [&:hover:not(:active)]:bg-primary! dark:[&:hover:not(:active)]:bg-primary!";

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

interface PiComposerActions {
  error?: PiComposerSendError;
  clearError(): void;
}

interface PiRejectedQueueDraftActions {
  rejectedDraft: {
    revision: number;
    message: AppendMessage;
  };
  clearRejectedDraft(revision: number): void;
}

function piRejectedQueueDraftActions(extras: unknown): PiRejectedQueueDraftActions | undefined {
  if (
    !extras ||
    typeof extras !== "object" ||
    !("piQueue" in extras) ||
    !extras.piQueue ||
    typeof extras.piQueue !== "object" ||
    !("rejectedDraft" in extras.piQueue) ||
    !extras.piQueue.rejectedDraft ||
    typeof extras.piQueue.rejectedDraft !== "object" ||
    !("revision" in extras.piQueue.rejectedDraft) ||
    typeof extras.piQueue.rejectedDraft.revision !== "number" ||
    !("message" in extras.piQueue.rejectedDraft) ||
    !("clearRejectedDraft" in extras.piQueue) ||
    typeof extras.piQueue.clearRejectedDraft !== "function"
  ) {
    return undefined;
  }
  return extras.piQueue as unknown as PiRejectedQueueDraftActions;
}

interface WorkbenchComposerSuggestion {
  readonly item: Unstable_TriggerItem;
  readonly command: ComposerCommand;
  readonly group: CommandView["kind"] | "workbench";
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
    item.type === PI_COMMAND_DIRECTIVE_TYPE ? "pi" : "workbench",
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

function builtinCommandPresentation(
  command: CommandView,
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
  if (item.type !== WORKBENCH_COMMAND_DIRECTIVE_TYPE && item.type !== PI_COMMAND_DIRECTIVE_TYPE) {
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
    <ComposerMenu open={open && items.length > 0} className="max-h-72 w-full overflow-y-auto pt-0">
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
                className="bg-popover/95 text-muted-foreground sticky top-0 z-10 px-2.5 py-1.5 text-[11px] font-medium backdrop-blur-sm"
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

function piComposerActions(extras: unknown): PiComposerActions | undefined {
  if (
    !extras ||
    typeof extras !== "object" ||
    !("piComposer" in extras) ||
    !extras.piComposer ||
    typeof extras.piComposer !== "object" ||
    !("clearError" in extras.piComposer) ||
    typeof extras.piComposer.clearError !== "function"
  ) {
    return undefined;
  }
  return extras.piComposer as PiComposerActions;
}

function composerErrorMessage(error: PiComposerSendError, t: ReturnType<typeof useI18n>["t"]) {
  switch (error) {
    case "model-image-unsupported":
      return t("workbench.chat.errors.modelDoesNotSupportImages");
    case "image-too-large":
      return t("workbench.chat.errors.imageTooLarge");
    case "too-many-images":
      return t("workbench.chat.errors.tooManyImages");
    case "image-invalid":
      return t("workbench.chat.errors.invalidImage");
  }
}

function ComposerDrawerStats({ contextCount }: Readonly<{ contextCount: number }>) {
  const { t } = useI18n();
  const extensionManager = useExtensionManager();
  const getExtensionCount = useCallback(
    () => extensionManager.getExtensions().length,
    [extensionManager],
  );
  const extensionCount = useSyncExternalStore(
    extensionManager.subscribe,
    getExtensionCount,
    () => 0,
  );

  return (
    <div className="flex shrink-0 items-center gap-1">
      <span className="bg-muted/55 text-muted-foreground inline-flex h-6 items-center rounded-lg px-2 text-[11px] whitespace-nowrap">
        {t("workbench.chat.composer.contextCount", { count: contextCount })}
      </span>
      <span className="bg-muted/55 text-muted-foreground inline-flex h-6 items-center rounded-lg px-2 text-[11px] whitespace-nowrap">
        {t("workbench.chat.composer.extensionsCount", { count: extensionCount })}
      </span>
    </div>
  );
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
  const composerActions = piComposerActions(extras);
  const rejectedQueueDraftActions = piRejectedQueueDraftActions(extras);
  const drawerId = useId();
  const composerRef = useRef<HTMLFormElement>(null);
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
  const [isDrawerOpen, setIsDrawerOpen] = useState(isNewThread);
  const [isComposerSelected, setIsComposerSelected] = useState(false);
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
  const piCommands = usePiCommands();
  const handledRejectedQueueDraft = useRef("");

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
    const piIds = new Set<string>();
    const suggestions: WorkbenchComposerSuggestion[] = [];

    for (const command of piCommands) {
      piIds.add(command.invocationName);
      const definition = definitions.get(command.invocationName);
      const builtin = builtinCommandPresentation(command, t);
      const label = definition
        ? localize(definition.label)
        : (builtin?.label ?? formatPiCommandLabel(command.name));
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
      const type = PI_COMMAND_DIRECTIVE_TYPE;
      suggestions.push({
        item: { id: command.invocationName, type, label, description },
        command: {
          name: command.invocationName,
          description,
          ...(argumentHint ? { argumentHint } : {}),
          icon: definition?.icon ?? CuboidIcon,
        },
        group: command.kind,
        exclusive: command.exclusive,
        ...(argsSchema ? { argsSchema } : {}),
        ...(argsBinding ? { argsBinding } : {}),
        ...(definition ? { definition } : {}),
      });
    }

    for (const definition of registeredComposerCommands) {
      if (piIds.has(definition.id)) continue;
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
          description,
          ...(argumentHint ? { argumentHint } : {}),
          icon: definition.icon ?? CuboidIcon,
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
  }, [localize, piCommands, registeredComposerCommands, t]);
  const composerSuggestionsByKey = useMemo(
    () =>
      new Map(
        composerSuggestions.map((suggestion) => [suggestionKey(suggestion.item), suggestion]),
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
  const showWorkspacePrompt = !canCompose && isComposerSelected;
  const contextCount = useAuiState(
    (state) => state.thread.messages.length + state.thread.composer.attachments.length,
  );
  const context = { isRunning, isEmpty };
  const drawerContext = {
    ...context,
    closeDrawer: () => setIsDrawerOpen(false),
  };

  useEffect(() => {
    setIsDrawerOpen(isNewThread);
    setIsComposerSelected(false);
  }, [hasDraftWorkspace, isNewThread, mainThreadId]);

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
    if (!showWorkspacePrompt) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && composerRef.current?.contains(target)) return;
      setIsComposerSelected(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [showWorkspacePrompt]);

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
              piCommands,
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
      piCommands,
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
          parseComposerDocument(composerState.text, composerCommandRegistry, piCommands),
          commandParametersByKey,
        );
        const commandNodes = document.filter((node) => node.type === "command");
        if (
          commandNodes.length > 1 &&
          commandNodes.some(
            (node) =>
              composerSuggestionsByKey.get(
                suggestionKey({
                  id: node.commandId,
                  type:
                    node.source === "pi"
                      ? PI_COMMAND_DIRECTIVE_TYPE
                      : WORKBENCH_COMMAND_DIRECTIVE_TYPE,
                }),
              )?.exclusive,
          )
        ) {
          throw new Error("Exclusive Composer commands must be submitted separately");
        }
        const request = compileComposerDocument(document, composerCommandRegistry, piCommands);
        const dispatched = submitWorkbenchComposer(aui.thread, undefined, request, { steer });
        if (!dispatched) return;
        setComposerCommandError(false);
        setIsDrawerOpen(false);
        setIsComposerSelected(false);
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
      composerSuggestionsByKey,
      piCommands,
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
          icon={suggestion?.command.icon ?? CuboidIcon}
          role={parameterKey ? "button" : undefined}
          tabIndex={parameterKey ? 0 : undefined}
          title={editLabel}
          aria-label={editLabel}
          className={cn(
            "mx-0.5 align-baseline",
            parameterKey &&
              "cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30",
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
    <div className="flex w-full flex-col gap-2">
      <SlotHost name="composer.before" context={context} className="flex flex-col gap-2" />

      <ComposerPrimitive.Unstable_TriggerPopoverRoot>
        <ComposerPrimitive.Root
          ref={composerRef}
          className="group/composer relative flex w-full flex-col"
          data-selected={showWorkspacePrompt ? "true" : undefined}
          onPointerDownCapture={() => {
            if (!canCompose) setIsComposerSelected(true);
          }}
          onSubmit={(event) => {
            event.preventDefault();
            dispatchComposer();
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
                icon: activeCommandParameterSuggestion.command.icon,
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

          <ComposerPrimitive.AttachmentDropzone
            data-slot="workbench-composer-card"
            className={cn(
              "bg-background data-[dragging=true]:bg-accent/50 flex w-full flex-col overflow-hidden rounded-[22px] border shadow-[0_1px_3px_rgba(0,0,0,0.08)] outline-none transition-[border-color,box-shadow,background-color] focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 data-[dragging=true]:border-dashed",
              showWorkspacePrompt &&
                "border-dashed border-muted-foreground/40 dark:border-muted-foreground/50",
            )}
          >
            <fieldset
              disabled={!canCompose}
              className={cn(
                "flex flex-col gap-3 pt-2.5 transition-opacity [&>.aui-composer-attachments]:px-3",
                showWorkspacePrompt ? "opacity-60" : !canCompose && "[&_:disabled]:opacity-100",
              )}
            >
              <ComposerWorkspaceFeedback />
              <ComposerAttachments />
              <div className="flex w-full min-w-0 items-start px-4 pt-1 pb-0">
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
                    isNewThread && "min-h-[52px] [&_.aui-lexical-input]:min-h-[52px]",
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

              <div className="flex min-h-[42px] items-center justify-between gap-2 px-2 py-1 max-[360px]:gap-1 max-[360px]:px-1.5">
                <div className="flex h-[34px] min-w-0 flex-1 items-center gap-2">
                  <TooltipIconButton
                    type="button"
                    size="icon"
                    tooltip={
                      isDrawerOpen
                        ? t("workbench.chat.composer.closeDrawer")
                        : t("workbench.chat.composer.openDrawer")
                    }
                    aria-label={
                      isDrawerOpen
                        ? t("workbench.chat.composer.closeDrawer")
                        : t("workbench.chat.composer.openDrawer")
                    }
                    aria-expanded={isDrawerOpen}
                    aria-controls={drawerId}
                    variant="ghost"
                    className="text-muted-foreground hover:text-foreground size-8 rounded-full"
                    onClick={() => setIsDrawerOpen((open) => !open)}
                  >
                    {isDrawerOpen ? <XIcon className="size-4" /> : <PlusIcon className="size-4" />}
                  </TooltipIconButton>
                  <SlotHost
                    name="composer.actions.left"
                    context={context}
                    className="flex min-w-0 items-center gap-2 empty:hidden"
                  />
                  <ComposerAddAttachment />
                </div>

                <div className="flex h-[34px] min-w-0 shrink-0 items-center justify-end gap-2 max-[360px]:gap-1">
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
                          className="text-muted-foreground hover:text-foreground size-8 rounded-full max-[360px]:hidden"
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
                          className="text-muted-foreground hover:text-foreground size-8 rounded-full max-[360px]:hidden"
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
                          className={COMPOSER_PRIMARY_ACTION_CLASS_NAME}
                        />
                      }
                    >
                      <SquareIcon className="size-4 fill-current" />
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
            </fieldset>

            {isDrawerOpen ? (
              <div
                id={drawerId}
                role="region"
                aria-label={t("workbench.chat.composer.drawer")}
                data-slot="workbench-composer-drawer"
                className="animate-in fade-in slide-in-from-top-1 flex min-h-7 items-center justify-between gap-2 overflow-x-auto px-4 py-0.5 duration-150"
              >
                <SlotHost
                  name="composer.drawer.left"
                  context={drawerContext}
                  className="flex min-w-0 flex-1 items-center gap-1.5 empty:hidden"
                />
                <div className="ms-auto flex shrink-0 items-center gap-1.5">
                  <ComposerDrawerStats contextCount={contextCount} />
                  <fieldset
                    disabled={!canCompose}
                    className={cn(
                      "flex shrink-0 items-center transition-opacity",
                      showWorkspacePrompt
                        ? "opacity-60"
                        : !canCompose && "[&_:disabled]:opacity-100",
                    )}
                  >
                    <SlotHost
                      name="composer.drawer.right"
                      context={drawerContext}
                      className="flex shrink-0 items-center gap-1.5 empty:hidden"
                    />
                  </fieldset>
                </div>
              </div>
            ) : null}
          </ComposerPrimitive.AttachmentDropzone>

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
      </ComposerPrimitive.Unstable_TriggerPopoverRoot>

      <SlotHost name="composer.after" context={context} className="flex flex-col gap-2" />
    </div>
  );
}
