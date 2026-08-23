import { randomUUID } from "node:crypto";

import type { PiQueuedPrompt } from "../../contracts";
import type { QueueItem } from "../../stream-contracts";

export type SessionQueueLane = "steering" | "followUp";

export interface TrackedSessionQueueItem {
  readonly id: string;
  readonly lane: SessionQueueLane;
  readonly prompt: PiQueuedPrompt;
}

export interface SessionQueueProjectionOptions {
  createId?: () => string;
}

function copyPrompt(prompt: PiQueuedPrompt): PiQueuedPrompt {
  return {
    message: prompt.message,
    ...(prompt.images?.length ? { images: prompt.images.map((image) => ({ ...image })) } : {}),
  };
}

function promptFingerprint(prompt: PiQueuedPrompt): string {
  return JSON.stringify([
    prompt.message,
    ...(prompt.images ?? []).map((image) => [image.mimeType, image.data, image.name ?? null]),
  ]);
}

function promptMatches(left: PiQueuedPrompt, right: PiQueuedPrompt): boolean {
  if (promptFingerprint(left) === promptFingerprint(right)) return true;
  // Native Pi queue events contain text only. Match those snapshots back to the
  // full prompt retained by the workbench so image content is not discarded.
  return left.message === right.message && (!left.images?.length || !right.images?.length);
}

function queueContent(prompt: PiQueuedPrompt): QueueItem["message"]["content"] {
  return [
    ...(prompt.message ? [{ type: "text", text: prompt.message }] : []),
    ...(prompt.images ?? []).map((image) => ({
      type: "image",
      mediaType: image.mimeType,
      data: image.data,
      ...(image.name === undefined ? {} : { name: image.name }),
    })),
  ];
}

/**
 * Identity-preserving projection over Pi's value-only steering/follow-up queues.
 *
 * Pi currently reports queue snapshots as strings. This mirror assigns an id to
 * each occurrence and reconciles subsequent value snapshots without confusing
 * duplicate messages or replacing ids merely because an item was edited.
 */
export class SessionQueueProjection {
  private readonly createId: () => string;
  private steering: TrackedSessionQueueItem[] = [];
  private followUp: TrackedSessionQueueItem[] = [];

  constructor(options: SessionQueueProjectionOptions = {}) {
    this.createId = options.createId ?? randomUUID;
  }

  reconcile(steering: readonly PiQueuedPrompt[], followUp: readonly PiQueuedPrompt[]): void {
    const previous = [...this.steering, ...this.followUp];
    const unused = new Set(previous);

    const reconcileLane = (
      lane: SessionQueueLane,
      prompts: readonly PiQueuedPrompt[],
      priorLane: readonly TrackedSessionQueueItem[],
    ): TrackedSessionQueueItem[] =>
      prompts.map((rawPrompt, index) => {
        const prompt = copyPrompt(rawPrompt);
        const sameLane = previous.find(
          (item) => unused.has(item) && item.lane === lane && promptMatches(item.prompt, prompt),
        );
        const moved = previous.find(
          (item) => unused.has(item) && promptMatches(item.prompt, prompt),
        );
        // A same-length value snapshot with one changed slot is the only signal
        // Pi exposes for an external edit. Preserve that occurrence's identity.
        const positional =
          priorLane.length === prompts.length && unused.has(priorLane[index]!)
            ? priorLane[index]
            : undefined;
        const retained = sameLane ?? moved ?? positional;
        if (retained) unused.delete(retained);
        return {
          id: retained?.id ?? this.createId(),
          lane,
          prompt:
            retained?.prompt.images?.length && !prompt.images?.length
              ? { ...prompt, images: retained.prompt.images.map((image) => ({ ...image })) }
              : prompt,
        };
      });

    const nextSteering = reconcileLane("steering", steering, this.steering);
    const nextFollowUp = reconcileLane("followUp", followUp, this.followUp);
    this.steering = nextSteering;
    this.followUp = nextFollowUp;
  }

  append(
    lane: SessionQueueLane,
    prompt: PiQueuedPrompt,
    requestedId?: string,
  ): TrackedSessionQueueItem {
    const id = requestedId && !this.find(requestedId) ? requestedId : this.createId();
    const item = { id, lane, prompt: copyPrompt(prompt) };
    if (lane === "steering") this.steering.push(item);
    else this.followUp.push(item);
    return item;
  }

  find(itemId: string): TrackedSessionQueueItem | undefined {
    return [...this.steering, ...this.followUp].find((item) => item.id === itemId);
  }

  edit(itemId: string, prompt: PiQueuedPrompt): boolean {
    const replace = (items: TrackedSessionQueueItem[]) => {
      const index = items.findIndex((item) => item.id === itemId);
      if (index < 0) return false;
      const current = items[index]!;
      items[index] = { ...current, prompt: copyPrompt(prompt) };
      return true;
    };
    return replace(this.steering) || replace(this.followUp);
  }

  remove(itemId: string): TrackedSessionQueueItem | undefined {
    for (const items of [this.steering, this.followUp]) {
      const index = items.findIndex((item) => item.id === itemId);
      if (index < 0) continue;
      return items.splice(index, 1)[0];
    }
    return undefined;
  }

  moveToSteering(itemId: string): TrackedSessionQueueItem | undefined {
    const item = this.remove(itemId);
    if (!item) return undefined;
    const moved = { ...item, lane: "steering" as const };
    this.steering.unshift(moved);
    return moved;
  }

  prompts(): { steering: PiQueuedPrompt[]; followUp: PiQueuedPrompt[] } {
    return {
      steering: this.steering.map((item) => copyPrompt(item.prompt)),
      followUp: this.followUp.map((item) => copyPrompt(item.prompt)),
    };
  }

  items(): QueueItem[] {
    return [...this.followUp, ...this.steering].map((item) => ({
      id: item.id,
      placement: item.lane === "steering" ? "steering" : "queued",
      message: {
        id: item.id,
        role: "user",
        content: queueContent(item.prompt),
        source: { kind: "user" },
      },
    }));
  }
}
