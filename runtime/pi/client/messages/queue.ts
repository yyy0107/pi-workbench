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

interface PiMessageQueueOptions {
  isRunning(): boolean;
  run(message: AppendMessage): Promise<void>;
  enqueue(mode: PiQueueMode, prompt: PiQueuedPrompt): Promise<void>;
  update(itemId: string, action: SessionQueueAction): Promise<void>;
  setPaused(
    paused: boolean,
    steering: readonly PiQueuedPrompt[],
    followUp: readonly PiQueuedPrompt[],
  ): Promise<void>;
  onChange(): void;
}

function appendContent(message: AppendMessage): SessionQueueAction & { kind: "edit" } {
  const prompt = appendMessageToPiPrompt(message);
  return { kind: "edit", content: [{ type: "text", text: prompt.text }] };
}

function queueItemParts(item: QueueItem): readonly (FileMessagePart | TextMessagePart)[] {
  return item.message.content.map((part): FileMessagePart | TextMessagePart => {
    if (part.type === "text" && typeof part.text === "string") {
      return { type: "text", text: part.text };
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

function queueItemText(item: QueueItem): string {
  return item.message.content
    .map((part) => {
      if (part.type === "text" && typeof part.text === "string") return part.text;
      return `[${part.type}]`;
    })
    .join("");
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

/** Client-side read model of the authoritative `session/queue` mux snapshot. */
export class PiMessageQueue {
  readonly adapter: ExternalThreadQueueAdapter;
  private readonly options: PiMessageQueueOptions;
  private items: readonly QueueItem[] = [];
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

  replaceAuthoritative(items: readonly QueueItem[]): void {
    this.items = items.map((item) => structuredClone(item));
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
    this.syncTask = this.syncTask
      .catch(() => undefined)
      .then(() => this.options.enqueue(mode, queued))
      .catch((error) => console.error(`[workbench-pi] ${mode} queue failed`, error));
  }

  private mutate(itemId: string, action: SessionQueueAction): void {
    if (!this.items.some((item) => item.id === itemId)) return;
    this.syncTask = this.syncTask
      .catch(() => undefined)
      .then(() => this.options.update(itemId, action))
      .catch((error) => {
        if (this.editingId === itemId) {
          this.editingId = undefined;
          this.publish();
        }
        console.error("[workbench-pi] queue update failed", error);
      });
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
