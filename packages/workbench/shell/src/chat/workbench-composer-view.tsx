"use client";

import { ComposerPrimitive, type Unstable_TriggerItem } from "@assistant-ui/react";
import {
  AlertCircleIcon,
  ArrowUpIcon,
  AtSignIcon,
  FileTextIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  PaperclipIcon,
  PlusIcon,
  SquareIcon,
  SquareSlashIcon,
  XIcon,
} from "lucide-react";
import { Fragment, useEffect, useRef, type CSSProperties, type ReactNode } from "react";

import { TooltipIconButton } from "../assistant-ui/tooltip-icon-button";
import { type ComposerCommand, ComposerCommandItem, ComposerMenu } from "../elements/composer";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { cn } from "../utils";
import {
  COMPOSER_CONVERSATION_MENTION_TYPE,
  COMPOSER_WORKSPACE_FILE_MENTION_TYPE,
} from "@workbench/contracts/composer";

const COMPOSER_PRIMARY_ACTION_CLASS_NAME =
  "aui-composer-primary-action rounded-[var(--button-radius)] [&:hover:not(:active)]:bg-primary! dark:[&:hover:not(:active)]:bg-primary!";
const COMPOSER_PRIMARY_ACTION_STYLE = {
  "--icon-frame-size-default": "var(--composer-primary-action-size)",
  "--icon-size-md": "var(--composer-primary-icon-size)",
} as CSSProperties;

export type WorkbenchComposerSuggestionGroup =
  | "builtin"
  | "extension"
  | "prompt"
  | "skill"
  | "workbench";

export interface WorkbenchComposerMenuSuggestion {
  readonly item: Unstable_TriggerItem;
  readonly command: ComposerCommand;
  readonly group: WorkbenchComposerSuggestionGroup;
}

function suggestionKey(item: Pick<Unstable_TriggerItem, "id" | "type">): string {
  return `${item.type}:${item.id}`;
}

function ScrollingComposerCommandItem({
  suggestion,
  item,
  index,
  active,
}: Readonly<{
  suggestion: WorkbenchComposerMenuSuggestion;
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

/** Stateless command-menu rendering fed by the trigger-scope container. */
export function WorkbenchComposerCommandMenuView({
  open,
  items,
  highlightedIndex,
  suggestions,
  groupLabel,
}: Readonly<{
  open: boolean;
  items: readonly Unstable_TriggerItem[];
  highlightedIndex: number;
  suggestions: ReadonlyMap<string, WorkbenchComposerMenuSuggestion>;
  groupLabel(group: WorkbenchComposerSuggestionGroup): string;
}>) {
  let previousGroup: WorkbenchComposerSuggestionGroup | undefined;

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
            {showGroupLabel ? (
              <div
                role="presentation"
                className="bg-popover/95 text-muted-foreground sticky top-0 z-10 px-3 py-2 text-[11px] leading-4 font-medium backdrop-blur-sm"
              >
                {groupLabel(suggestion.group)}
              </div>
            ) : null}
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

export interface ComposerContextMenuLabels {
  readonly conversations: string;
  readonly workspaceFiles: string;
  readonly loading: string;
  readonly loadError: string;
  readonly empty: string;
}

/** Stateless context-menu rendering fed by the trigger-scope container. */
export function WorkbenchComposerContextMenuView({
  open,
  items,
  highlightedIndex,
  isLoading,
  hasWorkspace,
  loadError,
  visible,
  labels,
}: Readonly<{
  open: boolean;
  items: readonly Unstable_TriggerItem[];
  highlightedIndex: number;
  isLoading: boolean;
  hasWorkspace: boolean;
  loadError: boolean;
  visible: boolean;
  labels: ComposerContextMenuLabels;
}>) {
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
        {labels.conversations}
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
            {labels.workspaceFiles}
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
                  <span>{labels.loading}</span>
                </>
              ) : (
                <span>{labels.loadError}</span>
              )}
            </div>
          ) : null}
        </>
      ) : null}
      {items.length === 0 && !isLoading && !loadError ? (
        <div className="text-muted-foreground flex min-h-12 items-center justify-center gap-2 px-3 py-2 text-xs">
          <span>{labels.empty}</span>
        </div>
      ) : null}
    </ComposerMenu>
  );
}

export interface ComposerAddMenuLabels {
  readonly open: string;
  readonly attachment: string;
  readonly context: string;
  readonly capability: string;
}

export function ComposerAddMenuView({
  labels,
  onInsertTrigger,
}: Readonly<{
  labels: ComposerAddMenuLabels;
  onInsertTrigger(trigger: "@" | "/"): void;
}>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <TooltipIconButton
            tooltip={labels.open}
            type="button"
            side="bottom"
            variant="ghost"
            size="icon"
            data-frame="none"
            className="aui-composer-add-menu text-muted-foreground hover:text-foreground hover:bg-muted-foreground/15 dark:hover:bg-muted-foreground/30 size-[var(--composer-attachment-action-size)] rounded-[var(--button-radius)] active:scale-[0.96] motion-reduce:transition-none"
            aria-label={labels.open}
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
          <span>{labels.attachment}</span>
        </ComposerPrimitive.AddAttachment>
        <DropdownMenuItem className="min-h-9 gap-2.5 px-2.5" onClick={() => onInsertTrigger("@")}>
          <AtSignIcon aria-hidden="true" className="text-muted-foreground size-4" />
          <span>{labels.context}</span>
        </DropdownMenuItem>
        <DropdownMenuItem className="min-h-9 gap-2.5 px-2.5" onClick={() => onInsertTrigger("/")}>
          <SquareSlashIcon aria-hidden="true" className="text-muted-foreground size-4" />
          <span>{labels.capability}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ComposerPrimaryActionView({
  isRunning,
  canSend,
  sendLabel,
  stopLabel,
  onSend,
}: Readonly<{
  isRunning: boolean;
  canSend: boolean;
  sendLabel: string;
  stopLabel: string;
  onSend(): void;
}>) {
  return isRunning ? (
    <ComposerPrimitive.Cancel
      render={
        <TooltipIconButton
          tooltip={stopLabel}
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
      tooltip={sendLabel}
      type="button"
      size="icon"
      disabled={!canSend}
      variant="default"
      className={cn(
        COMPOSER_PRIMARY_ACTION_CLASS_NAME,
        "disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100",
      )}
      style={COMPOSER_PRIMARY_ACTION_STYLE}
      onClick={onSend}
    >
      <ArrowUpIcon className="aui-composer-primary-icon" />
    </TooltipIconButton>
  );
}

/** Presentation-only card; all runtime-aware content is supplied by the container. */
export function WorkbenchComposerSurfaceView({
  isNewThread,
  headerLeft,
  headerRight,
  feedback,
  attachments,
  input,
  actionsLeft,
  actionsRight,
}: Readonly<{
  isNewThread: boolean;
  headerLeft: ReactNode;
  headerRight: ReactNode;
  feedback: ReactNode;
  attachments: ReactNode;
  input: ReactNode;
  actionsLeft: ReactNode;
  actionsRight: ReactNode;
}>) {
  return (
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
          {headerLeft}
          {headerRight}
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
          {feedback}
          {attachments}
          <div className="flex min-h-0 w-full min-w-0 flex-1 items-stretch px-4 pt-0.5 pb-0">
            {input}
          </div>

          <div
            className={cn(
              "flex h-[var(--composer-action-row-size)] shrink-0 items-center justify-between gap-2 [padding-inline:var(--composer-action-inset)] max-[360px]:gap-1",
              "[--composer-action-row-size:32px] [--composer-attachment-action-size:32px] [--composer-attachment-icon-size:16px]",
              "[--composer-primary-action-size:32px] [--composer-primary-icon-size:16px] [--composer-stop-icon-size:12px]",
              "[&_.aui-composer-add-menu]:size-[var(--composer-attachment-action-size)]! [&_.aui-composer-add-menu-icon]:size-[var(--composer-attachment-icon-size)]!",
              "[&_.aui-composer-stop-icon]:size-[var(--composer-stop-icon-size)]!",
            )}
          >
            <div className="flex h-full min-w-0 flex-1 items-center gap-2">{actionsLeft}</div>
            <div className="flex h-full min-w-0 shrink-0 items-center justify-end gap-2 max-[360px]:gap-1">
              {actionsRight}
            </div>
          </div>
        </div>
      </ComposerPrimitive.AttachmentDropzone>
    </div>
  );
}

export function ComposerErrorAlertView({
  message,
  dismissLabel,
  onDismiss,
}: Readonly<{ message: string; dismissLabel: string; onDismiss(): void }>) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className="border-destructive/25 bg-destructive/8 text-destructive mt-2 flex items-start gap-2 rounded-xl border px-3 py-2 text-sm"
    >
      <AlertCircleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 flex-1">{message}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={dismissLabel}
        className="text-destructive -m-1 shrink-0 hover:bg-destructive/10 hover:text-destructive"
        onClick={onDismiss}
      >
        <XIcon aria-hidden="true" />
      </Button>
    </div>
  );
}
