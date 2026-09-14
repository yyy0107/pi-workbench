import type {
  ConversationNode,
  ConversationSnapshot,
} from "@workbench/agent-runtime-contracts/conversation";
import type {
  AgentRuntime,
  ConversationSession,
  CurrentSessionSnapshot,
  HostObservable,
  ThreadListSnapshot,
} from "@workbench/agent-runtime-core";

class MutableObservable<T> implements HostObservable<T> {
  readonly #listeners = new Set<() => void>();
  #value: T;

  constructor(value: T) {
    this.#value = value;
  }

  getSnapshot = (): T => this.#value;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  replace(value: T): void {
    if (Object.is(this.#value, value)) return;
    this.#value = value;
    for (const listener of this.#listeners) listener();
  }
}

const EMPTY_COMPOSER = Object.freeze({
  text: "",
  attachments: Object.freeze([]),
  mode: "send" as const,
  phase: "idle" as const,
});

class RemoteConversationSession implements ConversationSession {
  readonly actions = Object.freeze({});
  readonly snapshot: MutableObservable<ConversationSnapshot>;
  readonly #nodes = new Map<string, MutableObservable<ConversationNode | undefined>>();

  constructor(readonly id: string) {
    this.snapshot = new MutableObservable<ConversationSnapshot>({
      sessionId: id,
      nodeKeys: Object.freeze([]),
      isLoading: true,
      isRunning: false,
      hasMore: false,
      composer: EMPTY_COMPOSER,
    });
  }

  node(key: string): HostObservable<ConversationNode | undefined> {
    let observable = this.#nodes.get(key);
    if (!observable) {
      observable = new MutableObservable<ConversationNode | undefined>(undefined);
      this.#nodes.set(key, observable);
    }
    return observable;
  }

  replace(input: {
    readonly nodes: readonly ConversationNode[];
    readonly loading: boolean;
    readonly hasMore: boolean;
  }): void {
    const keys = new Set(input.nodes.map((node) => node.key));
    for (const [key, observable] of this.#nodes) {
      if (!keys.has(key)) observable.replace(undefined);
    }
    for (const node of input.nodes) {
      const observable = this.node(node.key) as MutableObservable<ConversationNode | undefined>;
      observable.replace(node);
    }
    this.snapshot.replace({
      sessionId: this.id,
      nodeKeys: Object.freeze(input.nodes.map((node) => node.key)),
      isLoading: input.loading,
      isRunning: input.nodes.some((node) => node.kind === "assistant" && node.status === "running"),
      hasMore: input.hasMore,
      composer: EMPTY_COMPOSER,
    });
  }
}

/** One-session Headless Runtime adapter used only to install the canonical desktop renderer. */
export class RemoteConversationAgentRuntime implements AgentRuntime {
  readonly threads = new MutableObservable<ThreadListSnapshot>({
    threads: Object.freeze([]),
    isLoading: false,
  });
  readonly current: MutableObservable<CurrentSessionSnapshot>;
  readonly threadActions = Object.freeze({});
  readonly #session: RemoteConversationSession;

  constructor(readonly sessionId: string) {
    this.#session = new RemoteConversationSession(sessionId);
    this.current = new MutableObservable<CurrentSessionSnapshot>({
      sessionId,
      threadId: sessionId,
      isNewThread: false,
    });
  }

  session(id: string): ConversationSession | undefined {
    return id === this.sessionId ? this.#session : undefined;
  }

  replace(input: Parameters<RemoteConversationSession["replace"]>[0]): void {
    this.#session.replace(input);
  }

  async createThread(): Promise<string> {
    throw new Error("Remote conversation runtime cannot create threads");
  }

  createDraft(): string {
    throw new Error("Remote conversation runtime cannot create drafts");
  }

  switchToThread(): void {}

  switchToNewThread(): void {}
}
