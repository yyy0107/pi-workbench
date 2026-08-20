import type {
  AppendMessage,
  ExternalThreadQueueAdapter,
  FileMessagePart,
  QueueItemState,
  TextMessagePart,
} from "@assistant-ui/react";

import type { PiQueuedPrompt, PiQueueMode } from "../../contracts";
import type { SessionQueueAction } from "../../rpc-contracts";
import type { QueueItem } from "../../stream-contracts";
import { appendMessageToPiPrompt } from "./messages";
import { stripWorkspaceFeedbackContext } from "../../../../components/right-workspace/feedback/feedback-adapter";

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
  setPaused(
    paused: boolean,
    steering: readonly PiQueuedPrompt[],
    followUp: readonly PiQueuedPrompt[],
  ): Promise<void>;
  onSteerRejected(itemId: string): void;
  onChange(): void;
}

function appendContent(message: AppendMessage): SessionQueueAction & { kind: "edit" } {
  const prompt = appendMessageToPiPrompt(message);
  return { kind: "edit", content: [{ type: "text", text: prompt.text }] };
}

function queueItemParts(item: QueueItem): readonly (FileMessagePart | TextMessagePart)[] {
  return item.message.content.map((part): FileMessagePart | TextMessagePart => {
    if (part.type === "text" && typeof part.text === "string") {
      return { type: "text", text: stripWorkspaceFeedbackContext(part.text) };
    }
    if (
      part.type === "image" &&
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
      ? [{ type: "image" as const, data: part.data, mimeType: part.mediaType }]
      : [],
  );
  return { message, ...(images.length ? { images } : {}) };
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
  private paused = false;
  private editingId?: string;
  private transform: (message: AppendMessage) => AppendMessage = (message) => message;
  private syncTask: Promise<void> = Promise.resolve();

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
        }
      },
      edit: (id, message) => this.mutate(id, appendContent(this.transform(message))),
      remove: (id) => this.mutate(id, { kind: "remove" }),
      __internal_setDispatchTransform: (transform) => {
        this.transform = transform;
      },
      __internal_notifyCancelled: () => {
        if (!this.editingId) return;
        this.editingId = undefined;
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

  replaceAuthoritative(items: readonly QueueItem[]): void {
    const nextItems = items.map((item) => structuredClone(item));
    for (const itemId of this.rejectedEnqueueIds) {
      if (!nextItems.some((item) => item.id === itemId)) this.rejectedEnqueueIds.delete(itemId);
    }
    this.authoritativeItems = nextItems.filter((item) => !this.rejectedEnqueueIds.has(item.id));
    for (const item of this.authoritativeItems) this.pendingEnqueues.delete(item.id);
    this.rebuildItems();
    if (this.editingId && !this.items.some((item) => item.id === this.editingId)) {
      this.editingId = undefined;
    }
    this.publish();
  }

  setPausedFromServer(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.options.onChange();
  }

  beginEdit(id: string): QueueItemState | undefined {
    if (this.editingId) this.editingId = undefined;
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || item.placement !== "queued") {
      this.publish();
      return undefined;
    }
    this.editingId = id;
    this.publish();
    return queueItemState(item);
  }

  setPaused(paused: boolean): void {
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
      .then(() => this.options.setPaused(paused, steering, followUp))
      .catch((error) => {
        if (this.paused === paused) {
          this.paused = previous;
          this.options.onChange();
        }
        console.error("[workbench-pi] queue mode update failed", error);
      });
  }

  private submit(mode: PiQueueMode, rawMessage: AppendMessage): void {
    const message = this.transform(rawMessage);
    if (this.editingId) {
      const itemId = this.editingId;
      this.editingId = undefined;
      this.publish();
      this.mutate(itemId, appendContent(message));
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
    };
    const optimisticId = this.options.createId();
    this.pendingEnqueues.set(optimisticId, optimisticQueueItem(optimisticId, mode, queued));
    this.rebuildItems();
    this.publish();
    this.syncTask = this.syncTask
      .catch(() => undefined)
      .then(() => this.options.enqueue(mode, queued, optimisticId))
      .then((admission) => this.confirmEnqueue(optimisticId, admission))
      .catch((error) => {
        this.rejectEnqueue(optimisticId);
        console.error(`[workbench-pi] ${mode} queue failed`, error);
      });
  }

  private mutate(itemId: string, action: SessionQueueAction): void {
    const item = this.items.find((candidate) => candidate.id === itemId);
    if (!item) return;
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
      .then(() => this.options.update(itemId, action))
      .catch((error) => {
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
    this.pendingEnqueues.delete(optimisticId);
    this.rejectedEnqueueIds.add(optimisticId);
    this.authoritativeItems = this.authoritativeItems.filter((item) => item.id !== optimisticId);
    this.rebuildItems();
    this.publish();
  }

  private rebuildItems(): void {
    const authoritativeIds = new Set(this.authoritativeItems.map((item) => item.id));
    const pending = [...this.pendingEnqueues.values()].filter(
      (item) => !authoritativeIds.has(item.id),
    );
    this.items = this.withPendingSteers([...this.authoritativeItems, ...pending]);
  }

  private publish(): void {
    this.adapter.items = this.items
      .filter((item) => item.placement === "queued" && item.id !== this.editingId)
      .map(queueItemState);
    this.adapter.steerItems = this.items
      .filter((item) => item.placement === "steering")
      .map(queueItemState);
    this.options.onChange();
  }
}
