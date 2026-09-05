"use client";

import type { ComposerQueueItem } from "@workbench/agent-runtime-contracts/conversation";
import { useConversationSession, useSessionState } from "@workbench/agent-runtime-client";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CornerDownLeftIcon,
  ListRestartIcon,
  ListXIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { useState, type DragEvent } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../ui/dropdown-menu";
import { useI18n } from "../../../i18n";
import { cn } from "../../../utils";

type DropPosition = "before" | "after";

function dropPosition(event: DragEvent<HTMLElement>): DropPosition {
  const bounds = event.currentTarget.getBoundingClientRect();
  return event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
}

interface ComposerQueueItemProps {
  queueItem: ComposerQueueItem;
  dragging: boolean;
  dropPosition?: DropPosition;
  onDragStart(event: DragEvent<HTMLButtonElement>, id: string): void;
  onDragOver(event: DragEvent<HTMLLIElement>, id: string): void;
  onDragEnd(): void;
  onDrop(targetId: string, position: DropPosition): void;
  onSteer(id: string): void;
  onRemove(id: string): void;
  onEdit(id: string): void;
  canMoveDown: boolean;
  canMoveUp: boolean;
  onMoveDown(): void;
  onMoveUp(): void;
  queuePaused: boolean;
  onToggleQueueMode(): void;
}

function ComposerQueueItem({
  queueItem,
  dragging,
  dropPosition: targetPosition,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  onSteer,
  onRemove,
  onEdit,
  canMoveDown,
  canMoveUp,
  onMoveDown,
  onMoveUp,
  queuePaused,
  onToggleQueueMode,
}: ComposerQueueItemProps) {
  const { t } = useI18n();
  const text = queueItem.text;

  return (
    <li
      onDragOver={(event) => onDragOver(event, queueItem.key)}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(queueItem.key, dropPosition(event));
      }}
      className={cn(
        "group relative flex min-h-9 items-center px-2 transition-colors duration-100 hover:bg-muted/40",
        dragging && "bg-muted/50 opacity-40",
      )}
    >
      {targetPosition ? (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-x-2 z-10 h-0.5 rounded-full bg-blue-500 shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-blue-500)_18%,transparent)]",
            targetPosition === "before" ? "top-0" : "bottom-0",
          )}
        />
      ) : null}
      <button
        type="button"
        draggable
        aria-label={t("extensions.messageQueue.drag")}
        title={t("extensions.messageQueue.drag")}
        onDragStart={(event) => onDragStart(event, queueItem.key)}
        onDragEnd={onDragEnd}
        className="me-1 flex size-[var(--icon-frame-size-default)] shrink-0 cursor-grab items-center justify-center rounded-[var(--button-radius)] text-muted-foreground/50 hover:[background:var(--icon-frame-background-hover)] hover:text-foreground active:cursor-grabbing"
      >
        <ListRestartIcon className="size-[var(--icon-size-md)]" />
      </button>

      <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/90">
        {text || t("extensions.messageQueue.messageFallback")}
      </span>

      <div className="ms-2 flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            onSteer(queueItem.key);
          }}
          className="flex h-[var(--button-height-default)] items-center gap-1 rounded-[var(--button-radius)] px-2 text-xs text-muted-foreground/65 transition-colors hover:[background:var(--button-background-hover)] hover:text-foreground"
        >
          <CornerDownLeftIcon className="size-[var(--icon-size-md)]" />
          <span>{t("extensions.messageQueue.steer")}</span>
        </button>
        <button
          type="button"
          aria-label={t("extensions.messageQueue.remove")}
          onClick={() => onRemove(queueItem.key)}
          className="flex size-[var(--icon-frame-size-default)] items-center justify-center rounded-[var(--button-radius)] text-muted-foreground/50 transition-colors hover:[background:var(--icon-frame-background-hover)] hover:text-foreground"
        >
          <Trash2Icon className="size-[var(--icon-size-md)]" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t("extensions.messageQueue.more")}
            className="flex size-[var(--icon-frame-size-default)] items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:[background:var(--icon-frame-background-hover)] hover:text-foreground data-popup-open:[background:var(--icon-frame-background-selected)] data-popup-open:[color:var(--icon-frame-foreground-selected)]"
          >
            <MoreHorizontalIcon className="size-[var(--icon-size-sm)]" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom" sideOffset={4} className="min-w-36">
            <DropdownMenuItem onClick={() => onEdit(queueItem.key)} className="gap-2">
              <PencilIcon className="size-4" />
              <span>{t("extensions.messageQueue.edit")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canMoveUp} onClick={onMoveUp} className="gap-2">
              <ArrowUpIcon className="size-4" />
              <span>{t("extensions.messageQueue.moveUp")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canMoveDown} onClick={onMoveDown} className="gap-2">
              <ArrowDownIcon className="size-4" />
              <span>{t("extensions.messageQueue.moveDown")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onToggleQueueMode} className="gap-2">
              {queuePaused ? (
                <ListRestartIcon className="size-4" />
              ) : (
                <ListXIcon className="size-4" />
              )}
              <span>
                {queuePaused
                  ? t("extensions.messageQueue.enable")
                  : t("extensions.messageQueue.close")}
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

export function ComposerMessageQueue() {
  const session = useConversationSession();
  const queue = useSessionState((snapshot) => snapshot.composer.queue);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    position: DropPosition;
  } | null>(null);
  const visibleQueue = queue?.items ?? [];

  if (visibleQueue.length === 0) return null;

  const reorder = (targetId: string, position: DropPosition) => {
    if (!draggingId || draggingId === targetId) return;
    session.actions.mutateQueueItem?.(
      draggingId,
      position === "after"
        ? { kind: "move", afterKey: targetId }
        : { kind: "move", beforeKey: targetId },
    );
    setDraggingId(null);
    setDropTarget(null);
  };

  const editInComposer = (id: string) => {
    if (!session.actions.editQueueItem?.(id)) return;
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(
          '[data-slot="workbench-composer-card"] [contenteditable="true"]',
        )
        ?.focus();
    });
  };

  return (
    <div className="w-full overflow-hidden rounded-2xl border border-border/60 bg-background">
      <ul>
        {visibleQueue.map((queueItem) => (
          <ComposerQueueItem
            key={queueItem.key}
            queueItem={queueItem}
            dragging={draggingId === queueItem.key}
            dropPosition={dropTarget?.id === queueItem.key ? dropTarget.position : undefined}
            onDragStart={(event, id) => {
              setDraggingId(id);
              setDropTarget(null);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", id);
            }}
            onDragOver={(event, id) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              if (!draggingId || draggingId === id) {
                setDropTarget(null);
                return;
              }
              const position = dropPosition(event);
              setDropTarget((current) =>
                current?.id === id && current.position === position ? current : { id, position },
              );
            }}
            onDragEnd={() => {
              setDraggingId(null);
              setDropTarget(null);
            }}
            onDrop={reorder}
            onSteer={(id) => session.actions.mutateQueueItem?.(id, { kind: "steer" })}
            onRemove={(id) => session.actions.mutateQueueItem?.(id, { kind: "remove" })}
            onEdit={editInComposer}
            canMoveUp={visibleQueue.findIndex((item) => item.key === queueItem.key) > 0}
            canMoveDown={
              visibleQueue.findIndex((item) => item.key === queueItem.key) < visibleQueue.length - 1
            }
            onMoveUp={() => {
              const index = visibleQueue.findIndex((item) => item.key === queueItem.key);
              const previous = visibleQueue[index - 1];
              if (previous) {
                session.actions.mutateQueueItem?.(queueItem.key, {
                  kind: "move",
                  beforeKey: previous.key,
                });
              }
            }}
            onMoveDown={() => {
              const index = visibleQueue.findIndex((item) => item.key === queueItem.key);
              const next = visibleQueue[index + 1];
              if (next) {
                session.actions.mutateQueueItem?.(queueItem.key, {
                  kind: "move",
                  afterKey: next.key,
                });
              }
            }}
            queuePaused={queue?.paused ?? false}
            onToggleQueueMode={() => session.actions.setQueuePaused?.(!(queue?.paused ?? false))}
          />
        ))}
      </ul>
    </div>
  );
}
