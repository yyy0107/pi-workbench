import {
  parseManagedFileAttachment,
  parsePastedTextAttachment,
} from "@workbench/contracts/composer";
import type {
  ComposerAttachment,
  ComposerQueueItem,
} from "@workbench/agent-runtime-contracts/conversation";

import type { PiQueuedPrompt, PiQueueMode } from "@workbench/agent-runtime-pi-protocol/messages";
import type { SessionQueueAction } from "@workbench/agent-runtime-pi-protocol/rpc";
import type { QueueItem } from "@workbench/agent-runtime-pi-protocol/stream";
import { stripWorkspaceFeedbackContext } from "@workbench/agent-runtime-client/prompt-feedback";
import { deriveSessionDisplayText } from "@workbench/agent-runtime-pi-shared/sessions";
import type {
  PiComposerMessage,
  PiFileMessagePart,
  PiTextMessagePart,
} from "../conversation/pi-conversation-message";
import { appendMessageToPiPrompt } from "./messages";

interface PiMessageQueueOptions {
  isRunning(): boolean;
  run(message: PiComposerMessage): Promise<void>;
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
  onEnqueueRejected?(message: PiComposerMessage, error: unknown): void;
  onSteerRejected(itemId: string): void;
  onChange(): void;
}

function appendContent(
  message: PiComposerMessage,
  workspaceFeedbackSuffix?: string,
): SessionQueueAction & { kind: "edit" } {
  const prompt = appendMessageToPiPrompt(message);
  const text = workspaceFeedbackSuffix
    ? `${prompt.text.trimEnd()}${workspaceFeedbackSuffix}`
    : prompt.text;
  return {
    kind: "edit",
    content: [
      { type: "text", text },
      ...prompt.textAttachments.map((attachment) => ({
        type: "attachment",
        attachmentId: attachment.id,
      })),
    ],
  };
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

function queueItemParts(item: QueueItem): readonly (PiFileMessagePart | PiTextMessagePart)[] {
  return item.message.content.map((part): PiFileMessagePart | PiTextMessagePart => {
    if (part.type === "attachment") {
      const attachment = parsePastedTextAttachment(part.attachment);
      if (attachment)
        return {
          type: "file",
          data: attachment.id,
          mimeType: "text/plain",
          sourceType: "id",
          filename: attachment.name,
          textAttachment: attachment,
        };
    }
    if (part.type === "text" && typeof part.text === "string") {
      return {
        type: "text",
        text: deriveSessionDisplayText(stripWorkspaceFeedbackContext(part.text)),
      };
    }
    if (
      part.type === "image" &&
      typeof part.data === "string" &&
      typeof part.mediaType === "string"
    ) {
      const attachment = parseManagedFileAttachment(part.attachment);
      return {
        type: "file",
        data: part.data,
        mimeType: part.mediaType,
        ...(typeof part.name === "string" ? { filename: part.name } : {}),
        ...(attachment ? { fileAttachment: attachment } : {}),
      };
    }
    if (part.type === "file") {
      const attachment = parseManagedFileAttachment(part.attachment);
      if (attachment)
        return {
          type: "file",
          data: attachment.id,
          mimeType: attachment.mediaType,
          sourceType: "id",
          filename: attachment.name,
          fileAttachment: attachment,
        };
    }
    return { type: "text", text: `[${part.type}]` };
  });
}

export function queueItemAppendMessage(item: QueueItem): PiComposerMessage {
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

function composerAttachment(
  part: Extract<ReturnType<typeof queueItemParts>[number], { type: "file" }>,
  index: number,
): ComposerAttachment {
  if (part.textAttachment)
    return {
      kind: "pasted-text",
      key: part.textAttachment.id,
      name: part.textAttachment.name,
      mediaType: "text/plain",
      status: "ready",
      attachment: part.textAttachment,
    };
  const fileAttachment = part.fileAttachment ?? part.imageAttachment;
  if (fileAttachment)
    return {
      kind: "managed-file",
      key: fileAttachment.id,
      name: fileAttachment.name,
      source: part.data.startsWith("data:")
        ? part.data
        : part.sourceType === "id"
          ? ""
          : `data:${fileAttachment.mediaType};base64,${part.data}`,
      mediaType: fileAttachment.mediaType,
      status: "ready",
      attachment: fileAttachment,
    };
  const mediaType = part.mimeType === "image/*" ? "image/png" : part.mimeType;
  return {
    key: `${index}:${part.filename ?? "attachment"}`,
    name: part.filename ?? "attachment",
    source: part.data.startsWith("data:") ? part.data : `data:${mediaType};base64,${part.data}`,
    mediaType,
  };
}

function composerQueueItem(item: QueueItem): ComposerQueueItem {
  const parts = queueItemParts(item);
  return {
    key: item.id,
    text: parts
      .filter((part): part is PiTextMessagePart => part.type === "text")
      .map((part) => part.text)
      .join("\n\n"),
    attachments: parts
      .filter((part): part is PiFileMessagePart => part.type === "file")
      .map(composerAttachment),
  };
}

function promptFromQueueItem(item: QueueItem): PiQueuedPrompt {
  const message = item.message.content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("");
  const images = item.message.content.flatMap((part) => {
    if (
      part.type !== "image" ||
      typeof part.data !== "string" ||
      typeof part.mediaType !== "string"
    )
      return [];
    const attachment = parseManagedFileAttachment(part.attachment);
    return [
      {
        type: "image" as const,
        data: part.data,
        mimeType: part.mediaType,
        ...(typeof part.name === "string" ? { name: part.name } : {}),
        ...(attachment ? { attachment, attachmentId: attachment.id } : {}),
      },
    ];
  });
  const fileAttachments = item.message.content.flatMap((part) => {
    if (part.type !== "file") return [];
    const attachment = parseManagedFileAttachment(part.attachment);
    return attachment ? [attachment] : [];
  });
  return {
    message:
      typeof item.message.source.modelText === "string" ? item.message.source.modelText : message,
    ...(images.length ? { images } : {}),
    ...(fileAttachments.length
      ? {
          fileAttachments,
          fileAttachmentIds: fileAttachments.map((attachment) => attachment.id),
        }
      : {}),
    ...(item.message.source.imageDelivery === "native" ||
    item.message.source.imageDelivery === "path"
      ? { imageDelivery: item.message.source.imageDelivery }
      : {}),
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
        ...(prompt.textAttachments ?? []).map((attachment) => ({
          type: "attachment",
          attachmentId: attachment.id,
          attachment,
        })),
        ...(prompt.images ?? []).map((image) => ({
          type: "image",
          mediaType: image.mimeType,
          data: image.data,
          ...(image.name === undefined ? {} : { name: image.name }),
          ...(image.attachment === undefined ? {} : { attachment: image.attachment }),
        })),
        ...(prompt.fileAttachments ?? []).map((attachment) => ({
          type: "file",
          data: attachment.id,
          mediaType: attachment.mediaType,
          name: attachment.name,
          attachment,
        })),
      ],
      source: { kind: "optimistic" },
    },
  };
}

/** Client-side read model of the authoritative `session/queue` mux snapshot. */
export class PiMessageQueue {
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
  private syncTask: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(options: PiMessageQueueOptions) {
    this.options = options;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get steeringItems(): readonly QueueItem[] {
    return this.items.filter((item) => item.placement === "steering");
  }

  get queuedItems(): readonly ComposerQueueItem[] {
    return this.items
      .filter((item) => item.placement === "queued" && item.id !== this.editingId)
      .map(composerQueueItem);
  }

  enqueue(mode: PiQueueMode, message: PiComposerMessage): Promise<void> {
    return this.submit(mode, message);
  }

  edit(id: string): ComposerQueueItem | undefined {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || item.placement !== "queued") return undefined;
    this.beginEdit(id);
    return composerQueueItem(item);
  }

  mutateItem(
    id: string,
    mutation:
      | { readonly kind: "remove" }
      | { readonly kind: "steer" }
      | { readonly kind: "move"; readonly beforeKey?: string; readonly afterKey?: string },
  ): void {
    if (mutation.kind === "remove") this.mutate(id, { kind: "remove" });
    else if (mutation.kind === "steer") this.mutate(id, { kind: "steer" });
    else if (mutation.beforeKey !== undefined) {
      this.reorder(id, { insertBefore: mutation.beforeKey });
    } else if (mutation.afterKey !== undefined) {
      this.reorder(id, { insertAfter: mutation.afterKey });
    }
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

  private beginEdit(id: string): void {
    if (this.disposed) return undefined;
    if (this.editingId) {
      this.editingId = undefined;
      this.editingWorkspaceFeedbackSuffix = undefined;
    }
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || item.placement !== "queued") {
      this.publish();
      return;
    }
    this.editingId = id;
    this.editingWorkspaceFeedbackSuffix = extractWorkspaceFeedbackSuffix(item);
    this.publish();
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

  private submit(mode: PiQueueMode, message: PiComposerMessage): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.editingId) {
      const itemId = this.editingId;
      const feedbackSuffix = this.editingWorkspaceFeedbackSuffix;
      this.editingId = undefined;
      this.editingWorkspaceFeedbackSuffix = undefined;
      this.publish();
      const task = this.syncTask
        .catch(() => undefined)
        .then(async () => {
          if (this.disposed) return;
          try {
            await this.options.update(itemId, appendContent(message, feedbackSuffix));
          } catch (error) {
            if (!this.editingId) {
              this.editingId = itemId;
              this.editingWorkspaceFeedbackSuffix = feedbackSuffix;
              this.publish();
            }
            throw error;
          }
        });
      this.syncTask = task.catch(() => undefined);
      return task;
    }
    if (!this.options.isRunning()) {
      return this.options.run(message);
    }
    const prompt = appendMessageToPiPrompt(message);
    const queued: PiQueuedPrompt = {
      message: prompt.text,
      ...(prompt.fileAttachments.length
        ? {
            fileAttachments: prompt.fileAttachments,
            fileAttachmentIds: prompt.fileAttachments.map((attachment) => attachment.id),
          }
        : {}),
      ...(prompt.textAttachments.length
        ? {
            textAttachments: prompt.textAttachments,
            textAttachmentIds: prompt.textAttachments.map((attachment) => attachment.id),
          }
        : {}),
      ...(prompt.images.length ? { images: prompt.images } : {}),
      ...(prompt.composer === undefined ? {} : { composer: prompt.composer }),
    };
    const optimisticId = this.options.createId();
    this.pendingEnqueues.set(optimisticId, optimisticQueueItem(optimisticId, mode, queued));
    this.rebuildItems();
    this.publish();
    const task = this.syncTask
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
        throw error;
      });
    this.syncTask = task.catch(() => undefined);
    return task;
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
    placement: { readonly insertBefore?: string | null; readonly insertAfter?: string | null },
  ): void {
    if (this.disposed) return;
    const item = this.items.find((candidate) => candidate.id === itemId);
    if (!item || item.placement !== "queued") return;
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
    this.options.onChange();
  }
}
