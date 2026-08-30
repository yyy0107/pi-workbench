import type {
  AppendMessage,
  ExternalThreadQueueAdapter,
  FileMessagePart,
  QueueItemState,
  TextMessagePart,
} from "@assistant-ui/react";

import type { PiQueuedPrompt, PiQueueMode } from "@workbench/agent-runtime-pi-protocol/messages";
import type { SessionQueueAction } from "@workbench/agent-runtime-pi-protocol/rpc";
import type { QueueItem } from "@workbench/agent-runtime-pi-protocol/stream";
import { stripWorkspaceFeedbackContext } from "@workbench/agent-runtime-client/prompt-feedback";
import { appendMessageToPiPrompt } from "./messages";

interface PiMessageQueueOptions {
  isRunning(): boolean;
  run(message: AppendMessage): Promise<void>;
  createId(): string;
  enqueue(
    mode: PiQueueMode,
    prompt: PiQueuedPrompt,
    rpcId: string,
  ): Promise<{ queued: boolean; queueItemId?: string }>;
  update(itemId: string, action: SessionQueueAction): Promise<void>;
  replace(steering: readonly PiQueuedPrompt[], followUp: readonly PiQueuedPrompt[]): Promise<void>;
  setPaused(
    paused: boolean,
    steering: readonly PiQueuedPrompt[],
    followUp: readonly PiQueuedPrompt[],
  ): Promise<void>;
  onEnqueueRejected?(message: AppendMessage, error: unknown): void;
  onSteerRejected(itemId: string): void;
  onChange(): void;
}

function appendContent(
  message: AppendMessage,
  workspaceFeedbackSuffix?: string,
): SessionQueueAction & { kind: "edit" } {
  const prompt = appendMessageToPiPrompt(message);
  const text = workspaceFeedbackSuffix
    ? `${prompt.text.trimEnd()}${workspaceFeedbackSuffix}`
    : prompt.text;
  return { kind: "edit", content: [{ type: "text", text }] };
}

function queueItemRawText(item: QueueItem): string {
  return item.message.content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("");
}

function extractWorkspaceFeedbackSuffix(item: QueueItem | undefined): string | undefined {
  if (!item) return undefined;
  const text = queueItemRawText(item);
  const visibleText = stripWorkspaceFeedbackContext(text);
  if (visibleText === text || !text.startsWith(visibleText)) return undefined;
  return text.slice(visibleText.length);
}

function queueItemParts(item: QueueItem): readonly (FileMessagePart | TextMessagePart)[] {
  return item.message.content.map((part): FileMessagePart | TextMessagePart => {
    if (part.type === "text" && typeof part.text === "string") {
      return { type: "text", text: stripWorkspaceFeedbackContext(part.text) };
    }
    if (
      (part.type === "image" || part.type === "file") &&
      typeof part.data === "string" &&
      typeof part.mediaType === "string"
    ) {
      return {
        type: "file",
        data: part.data,
        mimeType: part.mediaType,
        ...(typeof part.name === "string" ? { filename: part.name } : {}),
      };
    }
    return { type: "text", text: `[${part.type}]` };
  });
}

export function queueItemAppendMessage(item: QueueItem): AppendMessage {
  return {
    role: "user",
    content: [...queueItemParts(item)],
    attachments: [],
    createdAt: new Date(),
    metadata: { custom: {} },
    parentId: null,
    runConfig: undefined,
    sourceId: null,
  };
}

function queueItemText(item: QueueItem): string {
  const text = item.message.content
    .map((part) => {
      if (part.type === "text" && typeof part.text === "string") return part.text;
      return `[${part.type}]`;
    })
    .join("");
  return stripWorkspaceFeedbackContext(text);
}

function queueItemState(item: QueueItem): QueueItemState {
  return {
    id: item.id,
    prompt: queueItemText(item),
    parts: queueItemParts(item),
  };
}

function promptFromQueueItem(item: QueueItem): PiQueuedPrompt {
  const message = item.message.content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("");
  const images = item.message.content.flatMap((part) =>
    part.type === "image" && typeof part.data === "string" && typeof part.mediaType === "string"
      ? [
          {
            type: "image" as const,
            data: part.data,
            mimeType: part.mediaType,
            ...(typeof part.name === "string" ? { name: part.name } : {}),
          },
        ]
      : [],
  );
  const documents = item.message.content.flatMap((part) =>
    part.type === "file" && typeof part.data === "string" && part.mediaType === "application/pdf"
      ? [
          {
            type: "file" as const,
            data: part.data,
            mimeType: "application/pdf" as const,
            ...(typeof part.name === "string" ? { name: part.name } : {}),
          },
        ]
      : [],
  );
  return {
    message,
    ...(images.length ? { images } : {}),
    ...(documents.length ? { documents } : {}),
  };
}

function optimisticQueueItem(id: string, mode: PiQueueMode, prompt: PiQueuedPrompt): QueueItem {
  return {
    id,
    placement: mode === "steer" ? "steering" : "queued",
    message: {
      id,
      role: "user",
      content: [
        ...(prompt.message ? [{ type: "text", text: prompt.message }] : []),
        ...(prompt.images ?? []).map((image) => ({
          type: "image",
          mediaType: image.mimeType,
          data: image.data,
          ...(image.name === undefined ? {} : { name: image.name }),
        })),
        ...(prompt.documents ?? []).map((document) => ({
          type: "file",
          mediaType: document.mimeType,
          data: document.data,
          ...(document.name === undefined ? {} : { name: document.name }),
        })),
      ],
      source: { kind: "optimistic" },
    },
  };
}

/** Client-side read model of the authoritative `session/queue` mux snapshot. */
export class PiMessageQueue {
  readonly adapter: ExternalThreadQueueAdapter;
  private readonly options: PiMessageQueueOptions;
  private authoritativeItems: readonly QueueItem[] = [];
  private items: readonly QueueItem[] = [];
  private readonly pendingEnqueues = new Map<string, QueueItem>();
  private readonly rejectedEnqueueIds = new Set<string>();
  private readonly pendingSteers = new Set<string>();
  private readonly pendingRemovals = new Set<string>();
  private pendingOrder?: readonly string[];
  private reorderRevision = 0;
  private paused = false;
  private editingId?: string;
  private editingWorkspaceFeedbackSuffix?: string;
  private transform: (message: AppendMessage) => AppendMessage = (message) => message;
  private syncTask: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(options: PiMessageQueueOptions) {
    this.options = options;
    this.adapter = {
      items: [],
      steerItems: [],
      enqueue: (message) => this.submit("followUp", message),
      steer: (message) => this.submit("steer", message),
      move: (id, placement) => {
        if (
          placement.lane === "steer" &&
          placement.insertAfter === null &&
          placement.insertBefore === undefined
        ) {
          this.mutate(id, { kind: "steer" });
          return;
        }
        this.reorder(id, placement);
      },
      edit: (id, message) =>
        this.mutate(
          id,
          appendContent(
            this.transform(message),
            extractWorkspaceFeedbackSuffix(this.items.find((item) => item.id === id)),
          ),
        ),
      remove: (id) => this.mutate(id, { kind: "remove" }),
      __internal_setDispatchTransform: (transform) => {
        if (this.disposed) return;
        this.transform = transform;
      },
      __internal_notifyCancelled: () => {
        if (this.disposed) return;
        if (!this.editingId) return;
        this.editingId = undefined;
        this.editingWorkspaceFeedbackSuffix = undefined;
        this.publish();
      },
    };
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get steeringItems(): readonly QueueItem[] {
    return this.items.filter((item) => item.placement === "steering");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.authoritativeItems = [];
    this.items = [];
    this.pendingEnqueues.clear();
    this.rejectedEnqueueIds.clear();
    this.pendingSteers.clear();
    this.pendingRemovals.clear();
    this.pendingOrder = undefined;
    this.editingId = undefined;
    this.editingWorkspaceFeedbackSuffix = undefined;
    this.transform = (message) => message;
    this.adapter.items = [];
    this.adapter.steerItems = [];
  }

  replaceAuthoritative(items: readonly QueueItem[]): void {
    if (this.disposed) return;
    const nextItems = items.map((item) => structuredClone(item));
    for (const itemId of this.rejectedEnqueueIds) {
      if (!nextItems.some((item) => item.id === itemId)) this.rejectedEnqueueIds.delete(itemId);
    }
    for (const itemId of this.pendingRemovals) {
      if (!nextItems.some((item) => item.id === itemId) && !this.pendingEnqueues.has(itemId)) {
        this.pendingRemovals.delete(itemId);
      }
    }
    this.authoritativeItems = nextItems.filter(
      (item) => !this.rejectedEnqueueIds.has(item.id) && !this.pendingRemovals.has(item.id),
    );
    for (const item of this.authoritativeItems) this.pendingEnqueues.delete(item.id);
    this.rebuildItems();
    if (this.editingId && !this.items.some((item) => item.id === this.editingId)) {
      this.editingId = undefined;
      this.editingWorkspaceFeedbackSuffix = undefined;
    }
    this.publish();
  }

  setPausedFromServer(paused: boolean): void {
    if (this.disposed) return;
    if (this.paused === paused) return;
    this.paused = paused;
    this.options.onChange();
  }

  beginEdit(id: string): QueueItemState | undefined {
    if (this.disposed) return undefined;
    if (this.editingId) {
      this.editingId = undefined;
      this.editingWorkspaceFeedbackSuffix = undefined;
    }
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || item.placement !== "queued") {
      this.publish();
      return undefined;
    }
    this.editingId = id;
    this.editingWorkspaceFeedbackSuffix = extractWorkspaceFeedbackSuffix(item);
    this.publish();
    return queueItemState(item);
  }

  setPaused(paused: boolean): void {
    if (this.disposed) return;
    if (this.paused === paused) return;
    const previous = this.paused;
    this.paused = paused;
    this.options.onChange();
    const steering = this.items
      .filter((item) => item.placement === "steering")
      .map(promptFromQueueItem);
    const followUp = this.items
      .filter((item) => item.placement === "queued")
      .map(promptFromQueueItem);
    this.syncTask = this.syncTask
      .catch(() => undefined)
      .then(() => {
        if (this.disposed) return;
        return this.options.setPaused(paused, steering, followUp);
      })
      .catch((error) => {
        if (this.disposed) return;
        if (this.paused === paused) {
          this.paused = previous;
          this.options.onChange();
        }
        console.error("[workbench-pi] queue mode update failed", error);
      });
  }

  private submit(mode: PiQueueMode, rawMessage: AppendMessage): void {
    if (this.disposed) return;
    const message = this.transform(rawMessage);
    if (this.editingId) {
      const itemId = this.editingId;
      const feedbackSuffix = this.editingWorkspaceFeedbackSuffix;
      this.editingId = undefined;
      this.editingWorkspaceFeedbackSuffix = undefined;
      this.publish();
      this.mutate(itemId, appendContent(message, feedbackSuffix));
      return;
    }
    if (!this.options.isRunning()) {
      void this.options
        .run(message)
        .catch((error) => console.error("[workbench-pi] prompt failed", error));
      return;
    }
    const prompt = appendMessageToPiPrompt(message);
    const queued: PiQueuedPrompt = {
      message: prompt.text,
      ...(prompt.images.length ? { images: prompt.images } : {}),
      ...(prompt.documents.length ? { documents: prompt.documents } : {}),
      ...(prompt.composer === undefined ? {} : { composer: prompt.composer }),
    };
    const optimisticId = this.options.createId();
    this.pendingEnqueues.set(optimisticId, optimisticQueueItem(optimisticId, mode, queued));
    this.rebuildItems();
    this.publish();
    this.syncTask = this.syncTask
      .catch(() => undefined)
      .then(() => {
        if (this.disposed) return { queued: false };
        return this.options.enqueue(mode, queued, optimisticId);
      })
      .then((admission) => this.confirmEnqueue(optimisticId, admission))
      .catch((error) => {
        if (this.disposed) return;
        this.rejectEnqueue(optimisticId);
        this.options.onEnqueueRejected?.(message, error);
        console.error(`[workbench-pi] ${mode} queue failed`, error);
      });
  }

  private mutate(itemId: string, action: SessionQueueAction): void {
    if (this.disposed) return;
    const item = this.items.find((candidate) => candidate.id === itemId);
    if (!item) return;
    if (action.kind === "remove") {
      this.pendingRemovals.add(itemId);
      this.rebuildItems();
      this.publish();
      void this.options
        .update(itemId, action)
        .then(() => {
          if (this.disposed) return;
          this.authoritativeItems = this.authoritativeItems.filter(
            (candidate) => candidate.id !== itemId,
          );
          this.pendingEnqueues.delete(itemId);
          this.rebuildItems();
          this.publish();
        })
        .catch((error) => {
          if (this.disposed) return;
          this.pendingRemovals.delete(itemId);
          this.rebuildItems();
          this.publish();
          console.error("[workbench-pi] queue remove failed", error);
        });
      return;
    }
    if (action.kind === "steer") {
      if (item.placement !== "queued" || this.pendingSteers.has(itemId)) return;
      this.pendingSteers.add(itemId);
      this.items = this.items.map((candidate) =>
        candidate.id === itemId ? { ...candidate, placement: "steering" } : candidate,
      );
      this.publish();
    }
    this.syncTask = this.syncTask
      .catch(() => undefined)
      .then(() => {
        if (this.disposed) return;
        return this.options.update(itemId, action);
      })
      .catch((error) => {
        if (this.disposed) return;
        if (action.kind === "steer") {
          this.pendingSteers.delete(itemId);
          this.items = this.withPendingSteers(this.authoritativeItems);
          this.options.onSteerRejected(itemId);
          this.publish();
        }
        if (this.editingId === itemId) {
          this.editingId = undefined;
          this.publish();
        }
        console.error("[workbench-pi] queue update failed", error);
      });
  }

  private reorder(
    itemId: string,
    placement: Parameters<ExternalThreadQueueAdapter["move"]>[1],
  ): void {
    if (this.disposed) return;
    const item = this.items.find((candidate) => candidate.id === itemId);
    if (!item || item.placement !== "queued") return;
    if (placement.lane !== undefined && placement.lane !== "queue") return;

    const queued = this.items.filter((candidate) => candidate.placement === "queued");
    const destination = queued.filter((candidate) => candidate.id !== itemId);
    const anchorIndex = (anchorId: string): number | undefined => {
      if (anchorId === itemId) return undefined;
      const index = destination.findIndex((candidate) => candidate.id === anchorId);
      return index < 0 ? undefined : index;
    };
    const { insertAfter, insertBefore } = placement;
    let index: number;
    if (insertAfter === undefined && insertBefore === undefined) return;
    if (insertAfter !== undefined && insertBefore !== undefined) {
      const afterIndex = insertAfter === null ? -1 : anchorIndex(insertAfter);
      const beforeIndex = insertBefore === null ? destination.length : anchorIndex(insertBefore);
      if (afterIndex === undefined || beforeIndex === undefined || beforeIndex !== afterIndex + 1) {
        return;
      }
      index = afterIndex + 1;
    } else if (insertAfter !== undefined) {
      const afterIndex = insertAfter === null ? -1 : anchorIndex(insertAfter);
      if (afterIndex === undefined) return;
      index = afterIndex + 1;
    } else {
      const beforeIndex = insertBefore === null ? destination.length : anchorIndex(insertBefore!);
      if (beforeIndex === undefined) return;
      index = beforeIndex;
    }

    const nextQueued = [...destination.slice(0, index), item, ...destination.slice(index)];
    if (
      nextQueued.every((candidate, candidateIndex) => candidate.id === queued[candidateIndex]?.id)
    ) {
      return;
    }

    const previousOrder = this.pendingOrder;
    const revision = ++this.reorderRevision;
    this.items = [
      ...nextQueued,
      ...this.items.filter((candidate) => candidate.placement !== "queued"),
    ];
    this.pendingOrder = this.items.map((candidate) => candidate.id);
    const desiredOrder = this.pendingOrder;
    this.publish();

    this.syncTask = this.syncTask
      .catch(() => undefined)
      .then(() => {
        if (this.disposed) return;
        if (!this.items.some((candidate) => candidate.id === itemId)) return;
        const orderedItems = this.applyOrder(this.items, desiredOrder);
        const steering = orderedItems
          .filter((candidate) => candidate.placement === "steering")
          .map(promptFromQueueItem);
        const followUp = orderedItems
          .filter((candidate) => candidate.placement === "queued")
          .map(promptFromQueueItem);
        return this.options.replace(steering, followUp);
      })
      .then(() => {
        if (this.disposed) return;
        if (this.reorderRevision !== revision) return;
        this.authoritativeItems = this.applyOrder(this.authoritativeItems, desiredOrder);
        this.pendingOrder = undefined;
        this.rebuildItems();
        this.publish();
      })
      .catch((error) => {
        if (this.disposed) return;
        if (this.reorderRevision === revision) {
          this.authoritativeItems = this.applyOrder(this.authoritativeItems, previousOrder);
          this.pendingOrder = undefined;
          this.rebuildItems();
          this.publish();
        }
        console.error("[workbench-pi] queue reorder failed", error);
      });
  }

  private applyOrder(
    items: readonly QueueItem[],
    order: readonly string[] | undefined,
  ): readonly QueueItem[] {
    if (!order) return items;
    const byId = new Map(items.map((item) => [item.id, item]));
    const ordered = order.flatMap((id) => {
      const item = byId.get(id);
      if (!item) return [];
      byId.delete(id);
      return [item];
    });
    return [...ordered, ...byId.values()];
  }

  private withPendingSteers(items: readonly QueueItem[]): readonly QueueItem[] {
    for (const itemId of this.pendingSteers) {
      const item = items.find((candidate) => candidate.id === itemId);
      if (!item || item.placement === "steering") this.pendingSteers.delete(itemId);
    }
    return items.map((item) =>
      this.pendingSteers.has(item.id) ? { ...item, placement: "steering" } : item,
    );
  }

  private confirmEnqueue(
    optimisticId: string,
    admission: { queued: boolean; queueItemId?: string },
  ): void {
    if (this.disposed) return;
    if (!admission.queued) {
      this.pendingEnqueues.delete(optimisticId);
      this.authoritativeItems = this.authoritativeItems.filter(
        (item) => item.id !== optimisticId && item.id !== admission.queueItemId,
      );
      this.rebuildItems();
      this.publish();
      return;
    }

    const queueItemId = admission.queueItemId ?? optimisticId;
    if (queueItemId !== optimisticId) {
      if (this.pendingRemovals.delete(optimisticId)) {
        this.pendingRemovals.add(queueItemId);
      }
      const pending = this.pendingEnqueues.get(optimisticId);
      this.pendingEnqueues.delete(optimisticId);
      if (pending) {
        this.pendingEnqueues.set(queueItemId, {
          ...pending,
          id: queueItemId,
          message: { ...pending.message, id: queueItemId },
        });
      }
    }
    if (this.authoritativeItems.some((item) => item.id === queueItemId)) {
      this.pendingEnqueues.delete(queueItemId);
    }
    this.rebuildItems();
    this.publish();
  }

  private rejectEnqueue(optimisticId: string): void {
    if (this.disposed) return;
    this.pendingEnqueues.delete(optimisticId);
    this.rejectedEnqueueIds.add(optimisticId);
    this.authoritativeItems = this.authoritativeItems.filter((item) => item.id !== optimisticId);
    this.rebuildItems();
    this.publish();
  }

  private rebuildItems(): void {
    if (this.disposed) return;
    const authoritativeIds = new Set(this.authoritativeItems.map((item) => item.id));
    const pending = [...this.pendingEnqueues.values()].filter(
      (item) => !authoritativeIds.has(item.id),
    );
    this.items = this.applyOrder(
      this.withPendingSteers(
        [...this.authoritativeItems, ...pending].filter(
          (item) => !this.pendingRemovals.has(item.id),
        ),
      ),
      this.pendingOrder,
    );
  }

  private publish(): void {
    if (this.disposed) return;
    this.adapter.items = this.items
      .filter((item) => item.placement === "queued" && item.id !== this.editingId)
      .map(queueItemState);
    this.adapter.steerItems = this.items
      .filter((item) => item.placement === "steering")
      .map(queueItemState);
    this.options.onChange();
  }
}
