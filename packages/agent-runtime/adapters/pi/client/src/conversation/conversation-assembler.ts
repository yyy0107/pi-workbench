import type { ThreadAssistantMessage, ThreadMessage } from "@assistant-ui/react";

import type {
  AssistantMessageNode,
  ComposerSnapshot,
  ConversationData,
  ConversationError,
  ConversationNode,
  ConversationSnapshot,
  MessageBlock,
  ToolCallBlock,
} from "@workbench/agent-runtime-contracts/conversation";
import { Notifier, type HostObservable } from "@workbench/agent-runtime-core";
import { isComposerJsonValue } from "@workbench/contracts/composer";
import { parseWorkbenchComposerCommandResponseDetails } from "@workbench/contracts/composer/request";

import { parsePiConversationEvent } from "../messages/conversation-events";

type Publication = "microtask" | "animation-frame" | "immediate";

export interface PiConversationProjection {
  readonly messages: readonly ThreadMessage[];
  readonly isLoading: boolean;
  readonly isRunning: boolean;
  readonly hasMore?: boolean;
  readonly composer?: ComposerSnapshot;
}

interface CachedNode {
  readonly source: ThreadMessage;
  readonly value: ConversationNode;
  readonly signature: string;
}

interface CachedBlock {
  readonly value: MessageBlock;
  readonly signature: string;
}

const EMPTY_ATTACHMENTS = Object.freeze([]);
const EMPTY_COMPOSER: ComposerSnapshot = Object.freeze({
  text: "",
  attachments: EMPTY_ATTACHMENTS,
  mode: "send",
  phase: "idle",
});

function publish(notifier: Notifier, publication: Publication): void {
  if (publication === "immediate") notifier.notifyNow();
  else if (publication === "animation-frame") notifier.markFrameDirty();
  else notifier.markDirty();
}

class PublishedValue<T> implements HostObservable<T> {
  readonly #notifier: Notifier;
  #value: T;
  #pending: T;

  constructor(value: T) {
    this.#value = value;
    this.#pending = value;
    this.#notifier = new Notifier(() => {
      this.#value = this.#pending;
    });
  }

  readonly getSnapshot = (): T => {
    this.#notifier.ensureFresh();
    return this.#value;
  };

  readonly subscribe = (listener: () => void): (() => void) => this.#notifier.subscribe(listener);

  set(value: T, publication: Publication): void {
    if (Object.is(value, this.#pending)) return;
    this.#pending = value;
    publish(this.#notifier, publication);
  }
}

function createdAt(message: ThreadMessage): number | undefined {
  const value = message.createdAt.getTime();
  return Number.isFinite(value) ? value : undefined;
}

function serializable(value: unknown): ConversationData {
  if (isComposerJsonValue(value)) return value;
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : (JSON.parse(json) as ConversationData);
  } catch {
    return String(value);
  }
}

function error(code: string, value: unknown): ConversationError {
  return Object.freeze({
    code,
    message: typeof value === "string" ? value : JSON.stringify(serializable(value)),
  });
}

function mediaType(source: string, fallback?: string): string | undefined {
  return fallback ?? /^data:([^;,]+)/.exec(source)?.[1];
}

function toolStatus(
  part: Extract<ThreadAssistantMessage["content"][number], { type: "tool-call" }>,
  message: ThreadAssistantMessage,
): ToolCallBlock["status"] {
  if (
    part.interrupt ||
    (part.approval &&
      part.approval.approved === undefined &&
      part.approval.resolution === undefined)
  ) {
    return "requires-action";
  }
  if (part.result !== undefined) return part.isError ? "error" : "complete";
  return message.status.type === "running" ? "running" : "incomplete";
}

function assistantStatus(message: ThreadAssistantMessage): AssistantMessageNode["status"] {
  if (message.status.type === "running" || message.status.type === "requires-action") {
    return "running";
  }
  if (message.status.type === "complete") return "complete";
  return message.status.reason === "error" ? "error" : "incomplete";
}

function blockCandidates(message: ThreadMessage): MessageBlock[] {
  const counts = new Map<string, number>();
  const key = (kind: string, identity?: string): string => {
    const stem = `${message.id}:${kind}${identity ? `:${encodeURIComponent(identity)}` : ""}`;
    const count = counts.get(stem) ?? 0;
    counts.set(stem, count + 1);
    return count === 0 ? stem : `${stem}:${count}`;
  };
  const blocks: MessageBlock[] = [];

  for (const part of message.content) {
    switch (part.type) {
      case "text":
        blocks.push({ key: key("text"), kind: "text", text: part.text });
        break;
      case "reasoning":
        blocks.push({ key: key("reasoning"), kind: "reasoning", text: part.text });
        break;
      case "tool-call": {
        if (message.role !== "assistant") break;
        const status = toolStatus(part, message);
        blocks.push({
          key: key("tool", part.toolCallId),
          kind: "tool-call",
          callId: part.toolCallId,
          toolName: part.toolName,
          argumentsText: part.argsText,
          status,
          ...(part.result === undefined ? {} : { result: serializable(part.result) }),
          ...(status !== "error" ? {} : { error: error("tool-error", part.result) }),
        });
        break;
      }
      case "data":
        blocks.push({
          key: key("data", part.name),
          kind: "data",
          name: part.name,
          data: serializable(part.data),
        });
        break;
      case "image": {
        const imageMediaType = mediaType(part.image);
        blocks.push({
          key: key("file", part.filename),
          kind: "file",
          name: part.filename ?? "image",
          source: part.image,
          ...(imageMediaType ? { mediaType: imageMediaType } : {}),
        });
        break;
      }
      case "file":
        blocks.push({
          key: key("file", part.filename),
          kind: "file",
          name: part.filename ?? "file",
          source: part.data,
          mediaType: part.mimeType,
        });
        break;
      case "source":
        if (part.sourceType === "url") {
          blocks.push({
            key: key("source", part.id),
            kind: "source",
            url: part.url,
            ...(part.title ? { title: part.title } : {}),
          });
        } else {
          blocks.push({
            key: key("file", part.id),
            kind: "file",
            name: part.filename ?? part.title,
            source: "",
            mediaType: part.mediaType,
          });
        }
        break;
      case "audio":
        blocks.push({
          key: key("file"),
          kind: "file",
          name: "audio",
          source: part.audio.data,
          mediaType: `audio/${part.audio.format}`,
        });
        break;
      case "generative-ui":
        blocks.push({
          key: key("data", part.id ?? "generative-ui"),
          kind: "data",
          name: "generative-ui",
          data: serializable(part.spec),
        });
        break;
    }
  }

  if (
    message.role === "assistant" &&
    message.status.type === "incomplete" &&
    message.status.reason === "error" &&
    !blocks.some((block) => block.kind === "error")
  ) {
    blocks.push({
      key: key("error"),
      kind: "error",
      error: error("assistant-error", message.status.error ?? "Assistant response failed"),
    });
  }
  return blocks;
}

function nodeCandidate(message: ThreadMessage, blocks: readonly MessageBlock[]): ConversationNode {
  const timestamp = createdAt(message);
  if (message.role === "user") {
    return {
      key: message.id,
      kind: "user",
      blocks,
      ...(timestamp === undefined ? {} : { createdAt: timestamp }),
    };
  }
  if (message.role === "assistant") {
    return {
      key: message.id,
      kind: "assistant",
      blocks,
      status: assistantStatus(message),
      ...(timestamp === undefined ? {} : { createdAt: timestamp }),
    };
  }

  const command = parseWorkbenchComposerCommandResponseDetails(
    message.metadata.custom.workbenchComposerCommandResponse,
  );
  if (command) {
    return {
      key: message.id,
      kind: "command",
      name: command.label || command.commandId,
      ...(command.args === undefined ? {} : { input: JSON.stringify(command.args) }),
      ...(command.failureReason === undefined ? {} : { output: command.failureReason }),
      status:
        command.status === "running"
          ? "running"
          : command.status === "success"
            ? "complete"
            : "error",
      ...(timestamp === undefined ? {} : { createdAt: timestamp }),
    };
  }

  const event = parsePiConversationEvent(message.metadata.custom.piConversationEvent);
  if (event?.kind === "compaction") {
    return {
      key: message.id,
      kind: "compaction",
      summary: event.reason,
      ...(timestamp === undefined ? {} : { createdAt: timestamp }),
    };
  }
  return {
    key: message.id,
    kind: "system",
    blocks,
    ...(timestamp === undefined ? {} : { createdAt: timestamp }),
  };
}

function sameKeys(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

/**
 * Structure-sharing Workbench projection owned by one PiClientSession.
 *
 * ponytail: the input remains the existing assistant-ui compatibility projection until the UI
 * migration removes it; keeping one Session publication path avoids a second event reducer now.
 */
export class PiConversationAssembler {
  readonly snapshot: HostObservable<ConversationSnapshot>;
  readonly #sessionId: string;
  readonly #snapshotValue: PublishedValue<ConversationSnapshot>;
  readonly #nodeValues = new Map<string, PublishedValue<ConversationNode | undefined>>();
  #nodes = new Map<string, CachedNode>();
  #blocks = new Map<string, CachedBlock>();

  constructor(sessionId: string) {
    this.#sessionId = sessionId;
    this.#snapshotValue = new PublishedValue(
      Object.freeze({
        sessionId,
        nodeKeys: Object.freeze([]),
        isLoading: false,
        isRunning: false,
        hasMore: false,
        composer: EMPTY_COMPOSER,
      }),
    );
    this.snapshot = this.#snapshotValue;
  }

  node(key: string): HostObservable<ConversationNode | undefined> {
    let value = this.#nodeValues.get(key);
    if (!value) {
      value = new PublishedValue(this.#nodes.get(key)?.value);
      this.#nodeValues.set(key, value);
    }
    return value;
  }

  update(source: PiConversationProjection, publication: Publication = "immediate"): void {
    // ponytail: this identity scan is O(n); pass changed message keys when long-session profiling
    // shows the scan matters.
    const nextNodes = new Map<string, CachedNode>();
    for (const message of source.messages) {
      const previous = this.#nodes.get(message.id);
      let value: ConversationNode;
      let signature: string;
      if (previous?.source === message) {
        ({ value, signature } = previous);
      } else {
        const blocks = blockCandidates(message).map((candidate) => {
          const candidateSignature = JSON.stringify(candidate);
          const cached = this.#blocks.get(candidate.key);
          if (cached?.signature === candidateSignature) return cached.value;
          const value = Object.freeze(candidate);
          this.#blocks.set(candidate.key, { value, signature: candidateSignature });
          return value;
        });
        const candidate = Object.freeze(
          nodeCandidate(message, Object.freeze(blocks)),
        ) as ConversationNode;
        signature = JSON.stringify(candidate);
        value = previous?.signature === signature ? previous.value : candidate;
      }
      nextNodes.set(message.id, { source: message, value, signature });
      if (value !== previous?.value) this.#nodeValues.get(message.id)?.set(value, publication);
    }

    for (const [key] of this.#nodes) {
      if (!nextNodes.has(key)) this.#nodeValues.get(key)?.set(undefined, publication);
    }
    this.#nodes = nextNodes;

    const previousSnapshot = this.#snapshotValue.getSnapshot();
    const candidateKeys = source.messages.map((message) => message.id);
    const nodeKeys = sameKeys(previousSnapshot.nodeKeys, candidateKeys)
      ? previousSnapshot.nodeKeys
      : Object.freeze(candidateKeys);
    const composer = source.composer ?? EMPTY_COMPOSER;
    const hasMore = source.hasMore ?? false;
    if (
      nodeKeys === previousSnapshot.nodeKeys &&
      source.isLoading === previousSnapshot.isLoading &&
      source.isRunning === previousSnapshot.isRunning &&
      hasMore === previousSnapshot.hasMore &&
      composer === previousSnapshot.composer
    ) {
      return;
    }
    this.#snapshotValue.set(
      Object.freeze({
        sessionId: this.#sessionId,
        nodeKeys,
        isLoading: source.isLoading,
        isRunning: source.isRunning,
        hasMore,
        composer,
      }),
      publication,
    );
  }

  dispose(): void {
    for (const value of this.#nodeValues.values()) value.set(undefined, "immediate");
    this.#nodes.clear();
    this.#blocks.clear();
    this.#snapshotValue.set(
      Object.freeze({
        sessionId: this.#sessionId,
        nodeKeys: Object.freeze([]),
        isLoading: false,
        isRunning: false,
        hasMore: false,
        composer: EMPTY_COMPOSER,
      }),
      "immediate",
    );
  }
}
