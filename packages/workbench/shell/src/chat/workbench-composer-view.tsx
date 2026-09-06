"use client";

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
import { Fragment, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";

import { TooltipIconButton } from "../ui/tooltip-icon-button";
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
import type { ComposerTriggerItem } from "./composer-directive";

const COMPOSER_PRIMARY_ACTION_CLASS_NAME =
  "aui-composer-primary-action rounded-[var(--button-radius)] hover:bg-primary";
export type WorkbenchComposerSuggestionGroup =
  | "builtin"
  | "extension"
  | "prompt"
  | "skill"
  | "workbench";

export interface WorkbenchComposerMenuSuggestion {
  readonly item: ComposerTriggerItem;
  readonly command: ComposerCommand;
  readonly group: WorkbenchComposerSuggestionGroup;
}

function suggestionKey(item: Pick<ComposerTriggerItem, "id" | "type">): string {
  return `${item.type}:${item.id}`;
}

function ScrollingComposerCommandItem({
  suggestion,
  item,
  active,
  onSelect,
}: Readonly<{
  suggestion: WorkbenchComposerMenuSuggestion;
  item: ComposerTriggerItem;
  active: boolean;
  onSelect(item: ComposerTriggerItem): void;
}>) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <ComposerCommandItem
      ref={ref}
      command={suggestion.command}
      active={active}
      role="option"
      aria-selected={active}
      className="scroll-mt-8"
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => onSelect(item)}
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
  ariaLabel,
  onSelect,
}: Readonly<{
  open: boolean;
  items: readonly ComposerTriggerItem[];
  highlightedIndex: number;
  suggestions: ReadonlyMap<string, WorkbenchComposerMenuSuggestion>;
  groupLabel(group: WorkbenchComposerSuggestionGroup): string;
  ariaLabel: string;
  onSelect(item: ComposerTriggerItem): void;
}>) {
  let previousGroup: WorkbenchComposerSuggestionGroup | undefined;

  return (
    <ComposerMenu
      open={open && items.length > 0}
      role="listbox"
      aria-label={ariaLabel}
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
              active={index === highlightedIndex}
              onSelect={onSelect}
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
  active,
  onSelect,
}: Readonly<{
  item: ComposerTriggerItem;
  active: boolean;
  onSelect(item: ComposerTriggerItem): void;
}>) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const Icon = contextItemIcon(item.type);

  return (
    <button
      type="button"
      ref={ref}
      role="option"
      aria-selected={active}
      className={cn(
        "flex min-h-10 w-full items-center gap-2.5 rounded-[var(--button-radius)] px-3 py-2 text-start text-sm outline-none transition-colors",
        active ? "bg-muted/80 dark:bg-muted/60" : "hover:bg-muted/50 dark:hover:bg-muted/35",
      )}
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => onSelect(item)}
    >
      <Icon aria-hidden="true" className="text-muted-foreground aui-composer-icon-size-default" />
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
    </button>
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
  ariaLabel,
  onSelect,
}: Readonly<{
  open: boolean;
  items: readonly ComposerTriggerItem[];
  highlightedIndex: number;
  isLoading: boolean;
  hasWorkspace: boolean;
  loadError: boolean;
  visible: boolean;
  labels: ComposerContextMenuLabels;
  ariaLabel: string;
  onSelect(item: ComposerTriggerItem): void;
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
      role="listbox"
      aria-label={ariaLabel}
      className="max-h-[min(24rem,50vh)] w-full gap-2 overflow-y-auto p-1.5 pt-0 scroll-py-2"
    >
      <div role="presentation" className={groupLabelClassName}>
        {labels.conversations}
      </div>
      {conversationItems.map(({ item, index }) => (
        <ScrollingComposerContextItem
          key={suggestionKey(item)}
          item={item}
          active={index === highlightedIndex}
          onSelect={onSelect}
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
              active={index === highlightedIndex}
              onSelect={onSelect}
            />
          ))}
          {isLoading || loadError ? (
            <div className="text-muted-foreground flex min-h-10 items-center justify-center gap-2 px-3 py-2 text-xs">
              {isLoading ? (
                <>
                  <LoaderCircleIcon
                    aria-hidden="true"
                    className="aui-composer-icon-size-default animate-spin"
                  />
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
  attachmentsEnabled,
  onInsertTrigger,
  onChooseAttachment,
}: Readonly<{
  labels: ComposerAddMenuLabels;
  attachmentsEnabled: boolean;
  onInsertTrigger(trigger: "@" | "/"): void;
  onChooseAttachment(): void;
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
            className="aui-composer-add-menu text-muted-foreground hover:text-foreground hover:bg-muted-foreground/15 dark:hover:bg-muted-foreground/30 size-[var(--composer-attachment-action-size)] rounded-[var(--button-radius)] motion-reduce:transition-none"
            aria-label={labels.open}
          >
            <PlusIcon className="aui-composer-add-menu-icon" />
          </TooltipIconButton>
        }
      />
      <DropdownMenuContent
        data-workbench-composer-popup=""
        align="start"
        side="top"
        sideOffset={8}
        className="w-64 p-1.5"
      >
        <DropdownMenuItem
          className="h-[var(--dropdown-control-height)] gap-2.5 px-2.5"
          disabled={!attachmentsEnabled}
          onClick={onChooseAttachment}
        >
          <PaperclipIcon
            aria-hidden="true"
            className="text-muted-foreground aui-composer-icon-size-default"
          />
          <span>{labels.attachment}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="h-[var(--dropdown-control-height)] gap-2.5 px-2.5"
          onClick={() => onInsertTrigger("@")}
        >
          <AtSignIcon
            aria-hidden="true"
            className="text-muted-foreground aui-composer-icon-size-default"
          />
          <span>{labels.context}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="h-[var(--dropdown-control-height)] gap-2.5 px-2.5"
          onClick={() => onInsertTrigger("/")}
        >
          <SquareSlashIcon
            aria-hidden="true"
            className="text-muted-foreground aui-composer-icon-size-default"
          />
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
  onCancel,
}: Readonly<{
  isRunning: boolean;
  canSend: boolean;
  sendLabel: string;
  stopLabel: string;
  onSend(): void;
  onCancel(): void;
}>) {
  return isRunning ? (
    <Button
      aria-label={stopLabel}
      data-frame="none"
      type="button"
      size="icon"
      variant="default"
      className={COMPOSER_PRIMARY_ACTION_CLASS_NAME}
      onClick={onCancel}
    >
      <SquareIcon className="aui-composer-stop-icon fill-current" />
    </Button>
  ) : (
    <Button
      aria-label={sendLabel}
      data-frame="none"
      type="button"
      size="icon"
      disabled={!canSend}
      variant="default"
      className={cn(
        COMPOSER_PRIMARY_ACTION_CLASS_NAME,
        "bg-primary/10 text-primary hover:bg-primary/20",
        "disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100",
      )}
      onClick={onSend}
    >
      <ArrowUpIcon className="aui-composer-primary-icon" />
    </Button>
  );
}

/** Presentation-only card; all runtime-aware content is supplied by the container. */
export function WorkbenchComposerSurfaceView({
  isNewThread,
  isRunning,
  headerLeft,
  headerRight,
  feedback,
  attachments,
  input,
  actionsLeft,
  actionsRight,
  attachmentsEnabled,
  onDropFiles,
}: Readonly<{
  isNewThread: boolean;
  isRunning: boolean;
  headerLeft: ReactNode;
  headerRight: ReactNode;
  feedback: ReactNode;
  attachments: ReactNode;
  input: ReactNode;
  actionsLeft: ReactNode;
  actionsRight: ReactNode;
  attachmentsEnabled: boolean;
  onDropFiles(files: readonly File[]): void;
}>) {
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const acceptsFiles = (event: DragEvent<HTMLElement>) =>
    attachmentsEnabled && event.dataTransfer.types.includes("Files");

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

      <div
        data-slot="workbench-composer-card"
        data-running={isRunning || undefined}
        data-dragging={dragging || undefined}
        onDragEnter={(event) => {
          if (!acceptsFiles(event)) return;
          event.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => {
          if (!acceptsFiles(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(event) => {
          if (!acceptsFiles(event)) return;
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={(event) => {
          if (!acceptsFiles(event)) return;
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          onDropFiles([...event.dataTransfer.files]);
        }}
        className={cn(
          "bg-background data-[dragging=true]:bg-accent/50 relative flex min-h-[var(--composer-height)] flex-col overflow-hidden rounded-[var(--composer-inner-radius,1.375rem)] border shadow-[0_1px_3px_rgba(0,0,0,0.08)] outline-none transition-[border-color,box-shadow,background-color] data-[dragging=true]:border-dashed",
          isNewThread && "z-10 -mt-px",
        )}
      >
        {isRunning ? <span aria-hidden="true" className="aui-composer-running-glow" /> : null}
        <div className="flex min-h-[var(--composer-height)] flex-1 flex-col gap-2 pt-2 [--composer-action-inset:0.5rem] [padding-bottom:var(--composer-action-inset)] transition-opacity max-[360px]:[--composer-action-inset:0.375rem] [&_.aui-composer-attachments]:px-3">
          {feedback}
          {attachments}
          <div className="flex min-h-0 w-full min-w-0 flex-1 items-stretch px-4 pt-0.5 pb-0">
            {input}
          </div>

          <div
            data-slot="workbench-composer-actions"
            className={cn(
              "flex h-[var(--composer-action-row-size)] shrink-0 items-center justify-between gap-2 [padding-inline:var(--composer-action-inset)] max-[360px]:gap-1",
            )}
          >
            <div className="flex h-full min-w-0 flex-1 items-center gap-2">{actionsLeft}</div>
            <div className="flex h-full min-w-0 shrink-0 items-center justify-end gap-2 max-[360px]:gap-1">
              {actionsRight}
            </div>
          </div>
        </div>
      </div>
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
      <AlertCircleIcon aria-hidden="true" className="mt-0.5 aui-composer-icon-size-default" />
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
