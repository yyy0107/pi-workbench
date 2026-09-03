import type {
  ComposerSnapshot,
  ConversationNode,
  ConversationSnapshot,
  MessageBlock,
} from "@workbench/agent-runtime-contracts/conversation";
import { Notifier, type HostObservable } from "@workbench/agent-runtime-core";
import { conversationNodesFromPiConversation } from "./conversation-node-projection";
import type { PiConversationMessage } from "./pi-conversation-message";

export type ConversationPublication = "microtask" | "animation-frame" | "immediate";

export interface PiConversationProjection {
  readonly messages: readonly PiConversationMessage[];
  readonly isLoading: boolean;
  readonly isRunning: boolean;
  readonly hasMore?: boolean;
  readonly composer?: ComposerSnapshot;
}

interface CachedNode {
  readonly source: ConversationNode;
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

/**
 * Structure-sharing Workbench projection owned by one PiClientSession.
 *
 * The assembler consumes the Pi-owned normalized history/live state. The temporary assistant-ui
 * compatibility projection stays outside this headless publication layer.
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

  update(
    source: PiConversationProjection,
    publication: ConversationPublication = "immediate",
  ): void {
    const nodes = conversationNodesFromPiConversation(source.messages);
    // ponytail: this identity scan is O(n); pass changed node keys when long-session profiling
    // shows the scan matters.
    const nextNodes = new Map<string, CachedNode>();
    for (const node of nodes) {
      const previous = this.#nodes.get(node.key);
      let value: ConversationNode;
      let signature: string;
      if (previous?.source === node) {
        ({ value, signature } = previous);
      } else {
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
        signature = JSON.stringify(candidate);
        value = previous?.signature === signature ? previous.value : candidate;
      }
      nextNodes.set(node.key, { source: node, value, signature });
      this.#nodeValues.get(node.key)?.set(value, publication);
    }

    for (const [key, value] of this.#nodeValues) {
      if (!nextNodes.has(key)) value.set(undefined, publication);
    }
    this.#nodes = nextNodes;

    const previousSnapshot = this.#snapshotValue.getSnapshot();
    const candidateKeys = nodes.map((node) => node.key);
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
