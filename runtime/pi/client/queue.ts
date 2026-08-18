import type {
  AppendMessage,
  ExternalThreadQueueAdapter,
  FileMessagePart,
  QueueItemState,
  TextMessagePart,
} from "@assistant-ui/react";

import type { PiQueuedPrompt, PiQueueMode } from "../contracts";
import { appendMessageToPiPrompt } from "./messages";

type QueueLane = "steer" | "followUp";

interface QueueEntry {
  id: string;
  item: QueueItemState;
  prompt: PiQueuedPrompt;
  message?: AppendMessage;
  announced?: boolean;
}

interface QueueEditReservation {
  entry: QueueEntry;
  lane: QueueLane;
  index: number;
  previousId?: string;
  nextId?: string;
}

interface PiMessageQueueOptions {
  isRunning(): boolean;
  run(message: AppendMessage): Promise<void>;
  queue(mode: PiQueueMode, prompt: PiQueuedPrompt): Promise<void>;
  replace(steering: readonly PiQueuedPrompt[], followUp: readonly PiQueuedPrompt[]): Promise<void>;
  steerQueued(
    prompt: PiQueuedPrompt,
    steering: readonly PiQueuedPrompt[],
    followUp: readonly PiQueuedPrompt[],
  ): Promise<void>;
  setPaused(
    paused: boolean,
    steering: readonly PiQueuedPrompt[],
    followUp: readonly PiQueuedPrompt[],
  ): Promise<void>;
  onConsumed(message: AppendMessage): void | (() => void);
  onChange(): void;
}

function createQueueId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `pi-queue-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function queueItemParts(message: AppendMessage): readonly (FileMessagePart | TextMessagePart)[] {
  const parts: (FileMessagePart | TextMessagePart)[] = [];
  const source = [
    ...message.content,
    ...(message.attachments ?? []).flatMap((attachment) =>
      attachment.content.filter((part) => part.type !== "text"),
    ),
  ];

  for (const part of source) {
    if (part.type === "text" || part.type === "file") {
      parts.push(part);
    } else if (part.type === "image") {
      parts.push({
        type: "file",
        data: part.image,
        mimeType: "image/*",
        ...(part.filename === undefined ? {} : { filename: part.filename }),
      });
    }
  }
  return parts;
}

function entryFromMessage(message: AppendMessage): QueueEntry {
  const prompt = appendMessageToPiPrompt(message);
  const id = createQueueId();
  return {
    id,
    message,
    prompt: {
      message: prompt.text,
      ...(prompt.images.length ? { images: prompt.images } : {}),
    },
    item: {
      id,
      prompt: prompt.text,
      parts: queueItemParts(message),
    },
  };
}

function entryFromEditedMessage(id: string, message: AppendMessage): QueueEntry {
  const replacement = entryFromMessage(message);
  return { ...replacement, id, item: { ...replacement.item, id } };
}

function entryFromServer(message: string): QueueEntry {
  const id = createQueueId();
  return {
    id,
    prompt: { message },
    item: {
      id,
      prompt: message,
      parts: [{ type: "text", text: message }],
    },
  };
}

function messageFromEntry(entry: QueueEntry): AppendMessage {
  if (entry.message) return entry.message;
  return {
    role: "user",
    content: [...entry.item.parts],
    attachments: [],
    createdAt: new Date(),
    metadata: { custom: {} },
    parentId: null,
    runConfig: undefined,
    sourceId: null,
  };
}

export class PiMessageQueue {
  readonly adapter: ExternalThreadQueueAdapter;
  private readonly options: PiMessageQueueOptions;
  private steering: readonly QueueEntry[] = [];
  private followUp: readonly QueueEntry[] = [];
  private paused = false;
  private editReservation?: QueueEditReservation;
  private transform: (message: AppendMessage) => AppendMessage = (message) => message;
  private syncTask: Promise<void> = Promise.resolve();

  constructor(options: PiMessageQueueOptions) {
    this.options = options;
    this.adapter = {
      items: [],
      steerItems: [],
      enqueue: (message) => this.submit("followUp", message),
      steer: (message) => this.submit("steer", message),
      move: (id, placement) => this.move(id, placement),
      edit: (id, message) => this.edit(id, message),
      remove: (id) => this.remove(id),
      __internal_setDispatchTransform: (transform) => {
        this.transform = transform;
      },
      __internal_notifyCancelled: () => undefined,
    };
  }

  get isPaused(): boolean {
    return this.paused;
  }

  reconcile(steering: readonly string[], followUp: readonly string[], paused = false): void {
    const nextSteering = this.reconcileLane(this.steering, steering);
    const nextFollowUp = this.reconcileLane(this.followUp, followUp);
    this.steering = nextSteering.entries;
    this.followUp = nextFollowUp.entries;
    this.paused = paused;
    this.publish();
    for (const entry of [...nextSteering.removed, ...nextFollowUp.removed]) {
      if (entry.message && !entry.announced) this.options.onConsumed(entry.message);
    }
  }

  beginEdit(id: string): QueueItemState | undefined {
    if (this.editReservation) {
      this.insertReservedEntry(this.editReservation, this.editReservation.entry, false);
      this.editReservation = undefined;
    }
    const lane = this.laneOf(id);
    if (!lane) return undefined;

    const entries = this.getLane(lane);
    const index = entries.findIndex((entry) => entry.id === id);
    const entry = entries[index];
    if (!entry) return undefined;

    this.editReservation = {
      entry,
      lane,
      index,
      previousId: entries[index - 1]?.id,
      nextId: entries[index + 1]?.id,
    };
    this.setLane(
      lane,
      entries.filter((candidate) => candidate.id !== id),
    );
    this.persist();
    return entry.item;
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.publish();
    const steering = this.steering.map((entry) => entry.prompt);
    const followUp = this.followUp.map((entry) => entry.prompt);
    this.syncTask = this.syncTask
      .catch(() => undefined)
      .then(() => this.options.setPaused(paused, steering, followUp))
      .catch((error) => {
        if (this.paused === paused) {
          this.paused = !paused;
          this.publish();
        }
        console.error("[workbench-pi] queue mode update failed", error);
      });
  }

  private reconcileLane(
    current: readonly QueueEntry[],
    messages: readonly string[],
  ): { entries: readonly QueueEntry[]; removed: readonly QueueEntry[] } {
    const unused = [...current];
    const entries = messages.map((message, index) => {
      let matchIndex = unused.findIndex((entry) => entry.prompt.message === message);
      if (matchIndex === -1 && current.length === messages.length) {
        matchIndex = Math.min(index, unused.length - 1);
      }
      if (matchIndex < 0) return entryFromServer(message);
      const [entry] = unused.splice(matchIndex, 1);
      return entry ?? entryFromServer(message);
    });
    return { entries, removed: unused };
  }

  private submit(lane: QueueLane, rawMessage: AppendMessage): void {
    const message = this.transform(rawMessage);
    if (this.editReservation) {
      const reservation = this.editReservation;
      this.editReservation = undefined;
      const entry = entryFromEditedMessage(reservation.entry.id, message);
      this.insertReservedEntry(reservation, entry);
      this.persist();
      return;
    }

    if (!this.options.isRunning()) {
      void this.options
        .run(message)
        .catch((error) => console.error("[workbench-pi] prompt failed", error));
      return;
    }

    const entry = entryFromMessage(message);
    this.setLane(lane, [...this.getLane(lane), entry]);
    if (this.paused) {
      this.persist();
      return;
    }
    this.syncTask = this.syncTask
      .catch(() => undefined)
      .then(() => this.options.queue(lane, entry.prompt))
      .catch((error) => {
        if (this.getLane(lane).some((candidate) => candidate.id === entry.id)) {
          this.setLane(
            lane,
            this.getLane(lane).filter((candidate) => candidate.id !== entry.id),
          );
        }
        console.error(`[workbench-pi] ${lane} queue failed`, error);
      });
  }

  private insertReservedEntry(
    reservation: QueueEditReservation,
    entry: QueueEntry,
    publish = true,
  ): void {
    const destination = [...this.getLane(reservation.lane)];
    let index = Math.min(reservation.index, destination.length);
    const previousIndex = reservation.previousId
      ? destination.findIndex((candidate) => candidate.id === reservation.previousId)
      : -1;
    const nextIndex = reservation.nextId
      ? destination.findIndex((candidate) => candidate.id === reservation.nextId)
      : -1;
    if (previousIndex >= 0) index = previousIndex + 1;
    else if (nextIndex >= 0) index = nextIndex;
    destination.splice(index, 0, entry);
    this.setLane(reservation.lane, destination, publish);
  }

  private move(id: string, placement: Parameters<ExternalThreadQueueAdapter["move"]>[1]): void {
    if (
      placement.lane === "steer" &&
      placement.insertAfter === null &&
      placement.insertBefore === undefined
    ) {
      this.steerNow(id);
      return;
    }

    const fromLane = this.laneOf(id);
    if (!fromLane) return;
    const toLane = placement.lane === "queue" ? "followUp" : (placement.lane ?? fromLane);
    const entry = this.getLane(fromLane).find((candidate) => candidate.id === id);
    if (!entry) return;

    const destination = this.getLane(toLane).filter((candidate) => candidate.id !== id);
    const anchorIndex = (anchorId: string) =>
      destination.findIndex((candidate) => candidate.id === anchorId);
    let index = destination.length;
    if (placement.insertAfter !== undefined) {
      if (placement.insertAfter === null) index = 0;
      else {
        const anchor = anchorIndex(placement.insertAfter);
        if (anchor < 0) return;
        index = anchor + 1;
      }
    } else if (placement.insertBefore !== undefined) {
      if (placement.insertBefore === null) index = destination.length;
      else {
        const anchor = anchorIndex(placement.insertBefore);
        if (anchor < 0) return;
        index = anchor;
      }
    } else if (toLane === fromLane) {
      index = this.getLane(fromLane).findIndex((candidate) => candidate.id === id);
    }
    index = Math.max(0, Math.min(index, destination.length));

    const nextDestination = [...destination.slice(0, index), entry, ...destination.slice(index)];
    if (toLane === fromLane) {
      this.setLane(toLane, nextDestination, false);
    } else {
      this.setLane(
        fromLane,
        this.getLane(fromLane).filter((candidate) => candidate.id !== id),
        false,
      );
      this.setLane(toLane, nextDestination, false);
    }
    this.publish();
    this.persist();
  }

  private steerNow(id: string): void {
    const lane = this.laneOf(id);
    if (!lane) return;
    const entries = this.getLane(lane);
    const index = entries.findIndex((entry) => entry.id === id);
    const entry = entries[index];
    if (!entry) return;
    const reservation: QueueEditReservation = {
      entry,
      lane,
      index,
      previousId: entries[index - 1]?.id,
      nextId: entries[index + 1]?.id,
    };

    this.setLane(
      lane,
      entries.filter((candidate) => candidate.id !== id),
      false,
    );
    const rollbackMessage = this.options.onConsumed(messageFromEntry(entry));
    this.steering = [
      { ...entry, announced: true },
      ...this.steering.filter((candidate) => candidate.id !== id),
    ];
    this.publish();

    const remainingSteering = this.steering
      .filter((candidate) => candidate.id !== id)
      .map((candidate) => candidate.prompt);
    const remainingFollowUp = this.followUp.map((candidate) => candidate.prompt);
    this.syncTask = this.syncTask
      .catch(() => undefined)
      .then(() => this.options.steerQueued(entry.prompt, remainingSteering, remainingFollowUp))
      .catch(async (error) => {
        rollbackMessage?.();
        this.steering = this.steering.filter((candidate) => candidate.id !== id);
        this.insertReservedEntry(reservation, entry, false);
        this.publish();
        try {
          await this.options.replace(
            this.steering.map((candidate) => candidate.prompt),
            this.followUp.map((candidate) => candidate.prompt),
          );
        } catch (restoreError) {
          console.error("[workbench-pi] restore queue after steer failed", restoreError);
        }
        console.error("[workbench-pi] queued steer failed", error);
      });
  }

  private edit(id: string, message: AppendMessage): void {
    const lane = this.laneOf(id);
    if (!lane) return;
    const entry = entryFromEditedMessage(id, this.transform(message));
    this.setLane(
      lane,
      this.getLane(lane).map((candidate) => (candidate.id === id ? entry : candidate)),
    );
    this.persist();
  }

  private remove(id: string): void {
    const lane = this.laneOf(id);
    if (!lane) return;
    this.setLane(
      lane,
      this.getLane(lane).filter((candidate) => candidate.id !== id),
    );
    this.persist();
  }

  private persist(): void {
    const steering = this.steering.map((entry) => entry.prompt);
    const followUp = this.followUp.map((entry) => entry.prompt);
    this.syncTask = this.syncTask
      .catch(() => undefined)
      .then(() => this.options.replace(steering, followUp))
      .catch((error) => console.error("[workbench-pi] queue update failed", error));
  }

  private laneOf(id: string): QueueLane | undefined {
    if (this.steering.some((entry) => entry.id === id)) return "steer";
    if (this.followUp.some((entry) => entry.id === id)) return "followUp";
    return undefined;
  }

  private getLane(lane: QueueLane): readonly QueueEntry[] {
    return lane === "steer" ? this.steering : this.followUp;
  }

  private setLane(lane: QueueLane, entries: readonly QueueEntry[], publish = true): void {
    if (lane === "steer") this.steering = entries;
    else this.followUp = entries;
    if (publish) this.publish();
  }

  private publish(): void {
    this.adapter.steerItems = [];
    this.adapter.items = this.followUp.map((entry) => entry.item);
    this.options.onChange();
  }
}
