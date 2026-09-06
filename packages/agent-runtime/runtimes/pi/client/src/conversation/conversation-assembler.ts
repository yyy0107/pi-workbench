import type {
  ComposerSnapshot,
  ConversationAutoRetry,
  ConversationNode,
  ConversationNodeBranch,
  ConversationResumeCheckpoint,
  ConversationRunTiming,
  ConversationSnapshot,
  MessageBlock,
} from "@workbench/agent-runtime-contracts/conversation";
import { Notifier, type HostObservable } from "@workbench/agent-runtime-core";
import { conversationNodeFromPiMessage } from "./conversation-node-projection";
import type { PiConversationMessage } from "./pi-conversation-message";

export type ConversationPublication = "microtask" | "animation-frame" | "immediate";

export interface PiConversationProjection {
  readonly messages: readonly PiConversationMessage[];
  readonly isLoading: boolean;
  readonly isRunning: boolean;
  readonly hasMore?: boolean;
  readonly composer?: ComposerSnapshot;
  readonly branches?: ReadonlyMap<string, ConversationNodeBranch>;
  readonly runTiming?: ConversationRunTiming;
  readonly autoRetry?: ConversationAutoRetry;
  readonly resumeCheckpoint?: ConversationResumeCheckpoint;
}

interface CachedNode {
  readonly source: PiConversationMessage;
  readonly branch: ConversationNodeBranch | undefined;
  readonly forceRunning: boolean;
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

function publish(notifier: Notifier, publication: ConversationPublication): void {
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

  set(value: T, publication: ConversationPublication): void {
    if (Object.is(value, this.#pending)) {
      if (!Object.is(value, this.#value)) publish(this.#notifier, publication);
      return;
    }
    this.#pending = value;
    publish(this.#notifier, publication);
  }
}

function sameKeys(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function sameBranch(
  left: ConversationNodeBranch | undefined,
  right: ConversationNodeBranch | undefined,
) {
  return (
    left === right ||
    (left?.index === right?.index &&
      left?.count === right?.count &&
      left?.previousKey === right?.previousKey &&
      left?.nextKey === right?.nextKey)
  );
}

function sameResumeCheckpoint(
  left: ConversationResumeCheckpoint | undefined,
  right: ConversationResumeCheckpoint | undefined,
): boolean {
  return (
    left === right ||
    (left?.checkpointId === right?.checkpointId &&
      left?.terminalMessageId === right?.terminalMessageId &&
      left?.expectedStateId === right?.expectedStateId &&
      left?.capability === right?.capability)
  );
}

/**
 * Structure-sharing Workbench projection owned by one PiClientSession.
 *
 * The assembler consumes the Pi-owned normalized history/live state.
 */
export class PiConversationAssembler {
  readonly snapshot: HostObservable<ConversationSnapshot>;
  readonly #sessionId: string;
  readonly #snapshotValue: PublishedValue<ConversationSnapshot>;
  readonly #nodeValues = new Map<string, PublishedValue<ConversationNode | undefined>>();
  #nodes = new Map<string, CachedNode>();
  #blocks = new Map<string, CachedBlock>();
  #messages?: readonly PiConversationMessage[];
  #branches?: ReadonlyMap<string, ConversationNodeBranch>;

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

  update(
    source: PiConversationProjection,
    publication: ConversationPublication = "immediate",
  ): void {
    const previousSnapshot = this.#snapshotValue.getSnapshot();
    let nodeKeys = previousSnapshot.nodeKeys;
    if (
      source.messages !== this.#messages ||
      source.branches !== this.#branches ||
      source.isRunning !== previousSnapshot.isRunning
    ) {
      const activeMessage = source.isRunning
        ? source.messages.findLast(
            (message) => message.role === "user" || message.role === "assistant",
          )
        : undefined;
      // ponytail: retain a cheap O(n) identity scan; changed-key propagation belongs here only
      // if profiling shows the scan matters after skipping unchanged message conversion.
      const nextNodes = new Map<string, CachedNode>();
      for (const message of source.messages) {
        const branch = source.branches?.get(message.id);
        const forceRunning =
          message === activeMessage &&
          message.role === "assistant" &&
          message.status.type === "complete";
        const previous = this.#nodes.get(message.id);
        if (
          previous?.source === message &&
          previous.forceRunning === forceRunning &&
          sameBranch(previous.branch, branch)
        ) {
          nextNodes.set(message.id, previous);
          continue;
        }
        // A completed internal model/tool cycle can still belong to the running assistant turn.
        // Apply that state before projecting blocks so pending tools also remain running.
        const node = conversationNodeFromPiMessage(
          forceRunning && message.role === "assistant"
            ? { ...message, status: { type: "running" } }
            : message,
          branch,
        );
        const candidate = Object.freeze(
          "blocks" in node
            ? {
                ...node,
                blocks: Object.freeze(
                  node.blocks.map((block) => {
                    const blockSignature = JSON.stringify(block);
                    const cached = this.#blocks.get(block.key);
                    if (cached?.signature === blockSignature) return cached.value;
                    const value = Object.freeze({ ...block }) as MessageBlock;
                    this.#blocks.set(block.key, { value, signature: blockSignature });
                    return value;
                  }),
                ),
              }
            : { ...node },
        ) as ConversationNode;
        const signature = JSON.stringify(candidate);
        const value = previous?.signature === signature ? previous.value : candidate;
        if (previous && "blocks" in previous.value) {
          const keys = new Set("blocks" in value ? value.blocks.map((block) => block.key) : []);
          for (const block of previous.value.blocks)
            if (!keys.has(block.key)) this.#blocks.delete(block.key);
        }
        nextNodes.set(message.id, { source: message, branch, forceRunning, value, signature });
        this.#nodeValues.get(message.id)?.set(value, publication);
      }
      for (const [key, previous] of this.#nodes) {
        if (nextNodes.has(key)) continue;
        this.#nodeValues.get(key)?.set(undefined, publication);
        if ("blocks" in previous.value) {
          for (const block of previous.value.blocks) this.#blocks.delete(block.key);
        }
      }
      this.#nodes = nextNodes;
      this.#messages = source.messages;
      this.#branches = source.branches;
      const candidateKeys = source.messages.map((message) => message.id);
      if (!sameKeys(nodeKeys, candidateKeys)) nodeKeys = Object.freeze(candidateKeys);
    }
    const composer = source.composer ?? EMPTY_COMPOSER;
    const hasMore = source.hasMore ?? false;
    const resumeCheckpoint = sameResumeCheckpoint(
      source.resumeCheckpoint,
      previousSnapshot.resumeCheckpoint,
    )
      ? previousSnapshot.resumeCheckpoint
      : source.resumeCheckpoint;
    if (
      nodeKeys === previousSnapshot.nodeKeys &&
      source.isLoading === previousSnapshot.isLoading &&
      source.isRunning === previousSnapshot.isRunning &&
      hasMore === previousSnapshot.hasMore &&
      composer === previousSnapshot.composer &&
      source.runTiming === previousSnapshot.runTiming &&
      source.autoRetry === previousSnapshot.autoRetry &&
      resumeCheckpoint === previousSnapshot.resumeCheckpoint
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
        ...(source.runTiming === undefined ? {} : { runTiming: source.runTiming }),
        ...(source.autoRetry === undefined ? {} : { autoRetry: source.autoRetry }),
        ...(resumeCheckpoint === undefined ? {} : { resumeCheckpoint }),
      }),
      publication,
    );
  }

  dispose(): void {
    for (const value of this.#nodeValues.values()) value.set(undefined, "immediate");
    this.#nodes.clear();
    this.#blocks.clear();
    this.#nodeValues.clear();
    this.#messages = undefined;
    this.#branches = undefined;
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
