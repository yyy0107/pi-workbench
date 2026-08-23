"use client";

import {
  ComposerPrimitive,
  QueueItemPrimitive,
  useAui,
  useAuiState,
  type CreateAttachment,
  type QueueItemState,
} from "@assistant-ui/react";
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
import { flushSync } from "react-dom";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

function queueItemText(queueItem: QueueItemState): string {
  return queueItem.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n");
}

type DropPosition = "before" | "after";

function dropPosition(event: DragEvent<HTMLElement>): DropPosition {
  const bounds = event.currentTarget.getBoundingClientRect();
  return event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
}

interface PiQueueActions {
  paused: boolean;
  steeringIds: readonly string[];
  beginEdit(id: string): QueueItemState | undefined;
  setPaused(paused: boolean): void;
}

function piQueueActions(extras: unknown): PiQueueActions | undefined {
  if (
    !extras ||
    typeof extras !== "object" ||
    !("piQueue" in extras) ||
    !extras.piQueue ||
    typeof extras.piQueue !== "object" ||
    !("paused" in extras.piQueue) ||
    typeof extras.piQueue.paused !== "boolean" ||
    !("steeringIds" in extras.piQueue) ||
    !Array.isArray(extras.piQueue.steeringIds) ||
    !extras.piQueue.steeringIds.every((id) => typeof id === "string") ||
    !("beginEdit" in extras.piQueue) ||
    typeof extras.piQueue.beginEdit !== "function" ||
    !("setPaused" in extras.piQueue) ||
    typeof extras.piQueue.setPaused !== "function"
  ) {
    return undefined;
  }
  return extras.piQueue as PiQueueActions;
}

interface ComposerQueueItemProps {
  queueItem: QueueItemState;
  dragging: boolean;
  dropPosition?: DropPosition;
  onDragStart(event: DragEvent<HTMLButtonElement>, id: string): void;
  onDragOver(event: DragEvent<HTMLLIElement>, id: string): void;
  onDragEnd(): void;
  onDrop(targetId: string, position: DropPosition): void;
  onSteer(id: string): void;
  onEdit(queueItem: QueueItemState): void;
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
  onEdit,
  canMoveDown,
  canMoveUp,
  onMoveDown,
  onMoveUp,
  queuePaused,
  onToggleQueueMode,
}: ComposerQueueItemProps) {
  const { t } = useI18n();
  const text = queueItemText(queueItem);

  return (
    <li
      onDragOver={(event) => onDragOver(event, queueItem.id)}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(queueItem.id, dropPosition(event));
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
        onDragStart={(event) => onDragStart(event, queueItem.id)}
        onDragEnd={onDragEnd}
        className="me-1 flex size-7 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground/50 hover:bg-muted hover:text-foreground active:cursor-grabbing"
      >
        <ListRestartIcon className="size-3" />
      </button>

      <QueueItemPrimitive.Text className="min-w-0 flex-1 truncate text-[13px] text-foreground/90">
        {text || t("extensions.messageQueue.messageFallback")}
      </QueueItemPrimitive.Text>

      <div className="ms-2 flex shrink-0 items-center gap-0.5">
        <QueueItemPrimitive.Steer
          onClick={(event) => {
            event.preventDefault();
            flushSync(() => onSteer(queueItem.id));
          }}
          className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground/65 transition-colors hover:bg-muted hover:text-foreground"
        >
          <CornerDownLeftIcon className="size-3" />
          <span>{t("extensions.messageQueue.steer")}</span>
        </QueueItemPrimitive.Steer>
        <QueueItemPrimitive.Remove
          aria-label={t("extensions.messageQueue.remove")}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
        >
          <Trash2Icon className="size-3" />
        </QueueItemPrimitive.Remove>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t("extensions.messageQueue.more")}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground data-popup-open:bg-muted data-popup-open:text-foreground"
          >
            <MoreHorizontalIcon className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom" sideOffset={4} className="min-w-36">
            <DropdownMenuItem onClick={() => onEdit(queueItem)} className="gap-2">
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
  const { t } = useI18n();
  const aui = useAui();
  const queue = useAuiState((state) => state.thread.composer.queue);
  const extras = useAuiState((state) => state.thread.extras);
  const queueActions = piQueueActions(extras);
  const steeringIds = new Set(queueActions?.steeringIds ?? []);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    position: DropPosition;
  } | null>(null);
  const visibleQueue = queue.filter((item) => !steeringIds.has(item.id));

  if (visibleQueue.length === 0) return null;

  const reorder = (targetId: string, position: DropPosition) => {
    if (!draggingId || draggingId === targetId) return;
    const placement = position === "after" ? { insertAfter: targetId } : { insertBefore: targetId };
    aui.thread.composer().queueItem({ id: draggingId }).move(placement);
    setDraggingId(null);
    setDropTarget(null);
  };

  const editInComposer = async (queueItem: QueueItemState) => {
    const composer = aui.thread.composer();
    const draft = queueActions?.beginEdit(queueItem.id);
    if (!draft) return;

    try {
      await composer.reset();
    } catch (error) {
      console.error("[workbench-pi] clear composer draft failed", error);
    }
    composer.setText(queueItemText(draft));
    const attachments: CreateAttachment[] = draft.parts
      .filter((part) => part.type === "file")
      .map((part) => ({
        type: part.mimeType.startsWith("image/") ? "image" : "file",
        name: part.filename ?? t("extensions.messageQueue.messageFallback"),
        contentType:
          part.mimeType === "image/*"
            ? (/^data:([^;,]+)/.exec(part.data)?.[1] ?? "image/png")
            : part.mimeType,
        content: [part],
      }));
    try {
      await Promise.all(attachments.map((attachment) => composer.addAttachment(attachment)));
    } catch (error) {
      console.error("[workbench-pi] restore queued attachments failed", error);
    }
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
        <ComposerPrimitive.Queue>
          {({ queueItem }) =>
            steeringIds.has(queueItem.id) ? null : (
              <ComposerQueueItem
                key={queueItem.id}
                queueItem={queueItem}
                dragging={draggingId === queueItem.id}
                dropPosition={dropTarget?.id === queueItem.id ? dropTarget.position : undefined}
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
                    current?.id === id && current.position === position
                      ? current
                      : { id, position },
                  );
                }}
                onDragEnd={() => {
                  setDraggingId(null);
                  setDropTarget(null);
                }}
                onDrop={reorder}
                onSteer={(id) =>
                  aui.thread.composer().queueItem({ id }).move({ lane: "steer", insertAfter: null })
                }
                onEdit={(item) => void editInComposer(item)}
                canMoveUp={visibleQueue.findIndex((item) => item.id === queueItem.id) > 0}
                canMoveDown={
                  visibleQueue.findIndex((item) => item.id === queueItem.id) <
                  visibleQueue.length - 1
                }
                onMoveUp={() => {
                  const index = visibleQueue.findIndex((item) => item.id === queueItem.id);
                  const previous = visibleQueue[index - 1];
                  if (previous) {
                    aui.thread
                      .composer()
                      .queueItem({ id: queueItem.id })
                      .move({ insertBefore: previous.id });
                  }
                }}
                onMoveDown={() => {
                  const index = visibleQueue.findIndex((item) => item.id === queueItem.id);
                  const next = visibleQueue[index + 1];
                  if (next) {
                    aui.thread
                      .composer()
                      .queueItem({ id: queueItem.id })
                      .move({ insertAfter: next.id });
                  }
                }}
                queuePaused={queueActions?.paused ?? false}
                onToggleQueueMode={() => queueActions?.setPaused(!queueActions.paused)}
              />
            )
          }
        </ComposerPrimitive.Queue>
      </ul>
    </div>
  );
}
