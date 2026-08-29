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
  AlertCircleIcon,
  ArrowUpIcon,
  AtSignIcon,
  FileTextIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  MicIcon,
  PaperclipIcon,
  PlusIcon,
  SquareIcon,
  SquareSlashIcon,
  XIcon,
} from "lucide-react";
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
  type CSSProperties,
} from "react";

import { ComposerAttachments } from "@/components/assistant-ui/attachment";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import {
  type ComposerCommand,
  ComposerCommandItem,
  ComposerCommandToken,
  ComposerMenu,
} from "@/components/elements/composer";
import { ComposerWorkspaceFeedback } from "@/components/right-workspace";
import {
  COMPOSER_CONVERSATION_MENTION_TYPE,
  COMPOSER_WORKSPACE_FILE_MENTION_TYPE,
} from "@/contracts/composer";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { searchPiWorkspaceFiles } from "@/runtime/pi/client/transport/api";
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

const COMPOSER_PRIMARY_ACTION_CLASS_NAME =
  "aui-composer-primary-action rounded-[var(--button-radius)] [&:hover:not(:active)]:bg-primary! dark:[&:hover:not(:active)]:bg-primary!";
const COMPOSER_VOICE_ACTION_STYLE = {
  "--icon-frame-size-default": "var(--composer-voice-action-size)",
  "--icon-size-md": "var(--composer-voice-icon-size)",
} as CSSProperties;
const COMPOSER_PRIMARY_ACTION_STYLE = {
  "--icon-frame-size-default": "var(--composer-primary-action-size)",
  "--icon-size-md": "var(--composer-primary-icon-size)",
} as CSSProperties;

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

function suggestionHasParameterFields(
  suggestion: WorkbenchComposerSuggestion | undefined,
): boolean {
  return Boolean(
    suggestion?.argsSchema &&
    composerCommandParameterFields(suggestion.argsSchema, suggestion.argsBinding).length > 0,
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

function ComposerAddMenu({
  onInsertTrigger,
}: Readonly<{ onInsertTrigger(trigger: "@" | "/"): void }>) {
  const { t } = useI18n();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <TooltipIconButton
            tooltip={t("workbench.chat.composer.addMenu.open")}
            type="button"
            side="bottom"
            variant="ghost"
            size="icon"
            data-frame="none"
            className="aui-composer-add-menu text-muted-foreground hover:text-foreground hover:bg-muted-foreground/15 dark:border-muted-foreground/15 dark:hover:bg-muted-foreground/30 size-[var(--composer-attachment-action-size)] rounded-[var(--button-radius)] active:scale-[0.96] motion-reduce:transition-none"
            aria-label={t("workbench.chat.composer.addMenu.open")}
          >
            <PlusIcon className="aui-composer-add-menu-icon size-[var(--composer-attachment-icon-size)]" />
          </TooltipIconButton>
        }
      />
      <DropdownMenuContent align="start" side="top" sideOffset={8} className="w-64 p-1.5">
        <ComposerPrimitive.AddAttachment
          render={<DropdownMenuItem className="min-h-9 gap-2.5 px-2.5" />}
        >
          <PaperclipIcon aria-hidden="true" className="text-muted-foreground size-4" />
          <span>{t("workbench.chat.composer.addMenu.attachment")}</span>
        </ComposerPrimitive.AddAttachment>
        <DropdownMenuItem className="min-h-9 gap-2.5 px-2.5" onClick={() => onInsertTrigger("@")}>
          <AtSignIcon aria-hidden="true" className="text-muted-foreground size-4" />
          <span>{t("workbench.chat.composer.addMenu.context")}</span>
        </DropdownMenuItem>
        <DropdownMenuItem className="min-h-9 gap-2.5 px-2.5" onClick={() => onInsertTrigger("/")}>
          <SquareSlashIcon aria-hidden="true" className="text-muted-foreground size-4" />
          <span>{t("workbench.chat.composer.addMenu.capability")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
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

function contextItemIcon(type: string) {
  return type === COMPOSER_WORKSPACE_FILE_MENTION_TYPE ? FileTextIcon : MessageSquareIcon;
}

function ScrollingComposerContextItem({
  item,
  index,
  active,
}: Readonly<{ item: Unstable_TriggerItem; index: number; active: boolean }>) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const Icon = contextItemIcon(item.type);

  return (
    <ComposerPrimitive.Unstable_TriggerPopoverItem
      ref={ref}
      item={item}
      index={index}
      className={cn(
        "flex min-h-10 w-full items-center gap-2.5 rounded-[var(--button-radius)] px-3 py-2 text-start text-sm outline-none transition-colors",
        active ? "bg-muted/80 dark:bg-muted/60" : "hover:bg-muted/50 dark:hover:bg-muted/35",
      )}
      onPointerDown={(event) => event.preventDefault()}
    >
      <Icon aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate" title={item.label}>
          {item.label}
        </span>
        {item.description ? (
          <span className="text-muted-foreground truncate text-xs" title={item.description}>
            {item.description}
          </span>
        ) : null}
      </span>
    </ComposerPrimitive.Unstable_TriggerPopoverItem>
  );
}

function WorkbenchComposerContextMenu({
  hasWorkspace,
  loadError,
  visible,
}: Readonly<{ hasWorkspace: boolean; loadError: boolean; visible: boolean }>) {
  const { open, items, highlightedIndex, isLoading } = unstable_useTriggerPopoverScopeContext();
  const { t } = useI18n();
  const indexedItems = items.map((item, index) => ({ item, index }));
  const conversationItems = indexedItems.filter(
    ({ item }) => item.type === COMPOSER_CONVERSATION_MENTION_TYPE,
  );
  const workspaceFileItems = indexedItems.filter(
    ({ item }) => item.type === COMPOSER_WORKSPACE_FILE_MENTION_TYPE,
  );
  const groupLabelClassName =
    "bg-popover/95 text-muted-foreground sticky top-0 z-10 px-3 py-2 text-[11px] leading-4 font-medium backdrop-blur-sm";

  return (
    <ComposerMenu
      open={open && visible}
      className="max-h-[min(24rem,50vh)] w-full gap-2 overflow-y-auto p-1.5 pt-0 scroll-py-2"
    >
      <div role="presentation" className={groupLabelClassName}>
        {t("workbench.chat.composer.contextMentions.conversations")}
      </div>
      {conversationItems.map(({ item, index }) => (
        <ScrollingComposerContextItem
          key={suggestionKey(item)}
          item={item}
          index={index}
          active={index === highlightedIndex}
        />
      ))}
      {hasWorkspace ? (
        <>
          <div role="presentation" className={groupLabelClassName}>
            {t("workbench.chat.composer.contextMentions.workspaceFiles")}
          </div>
          {workspaceFileItems.map(({ item, index }) => (
            <ScrollingComposerContextItem
              key={suggestionKey(item)}
              item={item}
              index={index}
              active={index === highlightedIndex}
            />
          ))}
          {isLoading || loadError ? (
            <div className="text-muted-foreground flex min-h-10 items-center justify-center gap-2 px-3 py-2 text-xs">
              {isLoading ? (
                <>
                  <LoaderCircleIcon aria-hidden="true" className="size-3.5 animate-spin" />
                  <span>{t("workbench.chat.composer.contextMentions.loading")}</span>
                </>
              ) : (
                <span>{t("workbench.chat.composer.contextMentions.loadError")}</span>
              )}
            </div>
          ) : null}
        </>
      ) : null}
      {items.length === 0 && !isLoading && !loadError ? (
        <div className="text-muted-foreground flex min-h-12 items-center justify-center gap-2 px-3 py-2 text-xs">
          <span>{t("workbench.chat.composer.contextMentions.empty")}</span>
        </div>
      ) : null}
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

export function WorkbenchComposer({
  forceExistingThread = false,
}: Readonly<{ forceExistingThread?: boolean }> = {}) {
  const { t, text: localize } = useI18n();
  const aui = useAui();
  const { activeWorkspace, draftWorkspace } = useWorkspaceSelection();
  const contextWorkspace = draftWorkspace ?? activeWorkspace;
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
  const threadIds = useAuiState((state) => state.threads.threadIds);
  const archivedThreadIds = useAuiState((state) => state.threads.archivedThreadIds);
  const threadItems = useAuiState((state) => state.threads.threadItems);
  const isNewThread = !forceExistingThread && mainThreadId === newThreadId;
  const composerDrafts = useRef(new Map<string, ComposerDraftSnapshot>());
  const composerDraftThreadId = useRef(mainThreadId);
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const [isComposerComposing, setIsComposerComposing] = useState(false);
  const [composerCursorPosition, setComposerCursorPosition] = useState(0);
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
    if (!contextWorkspace || activeContextMentionQuery === undefined) {
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
        void searchPiWorkspaceFiles(
          { workspaceId, query, limit: 50 },
          { signal: controller.signal },
        )
          .then((result) => {
            if (controller.signal.aborted) return;
            setWorkspaceFileMentionSearch({
              workspaceId,
              query,
              items: result.entries.map((entry) => ({
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
  }, [activeContextMentionQuery, contextWorkspace]);
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
      if (!canSubmit) return;
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

          <div
            data-slot="workbench-composer-shell"
            className={cn(
              "relative isolate flex w-full min-w-0 max-w-full flex-col [--composer-height:104px]",
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
              <div className="flex min-h-[var(--composer-height)] flex-1 flex-col gap-2 pt-2 [--composer-action-inset:0.5rem] [padding-bottom:var(--composer-action-inset)] transition-opacity max-[360px]:[--composer-action-inset:0.375rem] [&_.aui-composer-attachments]:px-3">
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
                </div>

                <div
                  className={cn(
                    "flex h-[var(--composer-action-row-size)] shrink-0 items-center justify-between gap-2 [padding-inline:var(--composer-action-inset)] max-[360px]:gap-1",
                    "[--composer-action-row-size:32px] [--composer-attachment-action-size:32px] [--composer-attachment-icon-size:16px]",
                    "[--composer-voice-action-size:32px] [--composer-voice-icon-size:16px]",
                    "[--composer-primary-action-size:32px] [--composer-primary-icon-size:16px] [--composer-stop-icon-size:12px]",
                    "[&_.aui-composer-add-menu]:size-[var(--composer-attachment-action-size)]! [&_.aui-composer-add-menu-icon]:size-[var(--composer-attachment-icon-size)]!",
                    "[&_.aui-composer-stop-icon]:size-[var(--composer-stop-icon-size)]!",
                  )}
                >
                  <div className="flex h-full min-w-0 flex-1 items-center gap-2">
                    <SlotHost
                      name="composer.actions.left"
                      context={context}
                      className="flex min-w-0 items-center gap-2 empty:hidden"
                    />
                    <ComposerAddMenu onInsertTrigger={insertComposerTrigger} />
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
                            className="aui-composer-voice-action text-muted-foreground hover:text-foreground rounded-[var(--button-radius)] max-[360px]:hidden"
                            style={COMPOSER_VOICE_ACTION_STYLE}
                          />
                        }
                      >
                        <SquareIcon className="aui-composer-voice-icon fill-current" />
                      </ComposerPrimitive.StopDictation>
                    ) : (
                      <ComposerPrimitive.Dictate
                        render={
                          <TooltipIconButton
                            tooltip={t("workbench.chat.composer.voiceInput")}
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="aui-composer-voice-action text-muted-foreground hover:text-foreground rounded-[var(--button-radius)] max-[360px]:hidden"
                            style={COMPOSER_VOICE_ACTION_STYLE}
                          />
                        }
                      >
                        <MicIcon className="aui-composer-voice-icon" />
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
                            style={COMPOSER_PRIMARY_ACTION_STYLE}
                          />
                        }
                      >
                        <SquareIcon className="aui-composer-stop-icon fill-current" />
                      </ComposerPrimitive.Cancel>
                    ) : (
                      <TooltipIconButton
                        tooltip={t("workbench.chat.composer.sendMessage")}
                        type="button"
                        size="icon"
                        disabled={!canSubmit || !canSend}
                        variant="default"
                        className={cn(
                          COMPOSER_PRIMARY_ACTION_CLASS_NAME,
                          "disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100",
                        )}
                        style={COMPOSER_PRIMARY_ACTION_STYLE}
                        onClick={() => dispatchComposer()}
                      >
                        <ArrowUpIcon className="aui-composer-primary-icon" />
                      </TooltipIconButton>
                    )}
                  </div>
                </div>
              </div>
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
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("workbench.chat.composer.dismissError")}
                className="text-destructive -m-1 shrink-0 hover:bg-destructive/10 hover:text-destructive"
                onClick={() => {
                  composerActions?.clearError();
                  setComposerCommandError(false);
                  setQueueRestoreErrorThreadId(undefined);
                }}
              >
                <XIcon aria-hidden="true" />
              </Button>
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
