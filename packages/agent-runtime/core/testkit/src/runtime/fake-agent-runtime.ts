import type {
  ComposerSnapshot,
  ConversationNode,
  ConversationSnapshot,
} from "@workbench/agent-runtime-contracts/conversation";
import type {
  AgentRuntime,
  ConversationActions,
  ConversationSession,
  CreateThreadOptions,
  CurrentSessionSnapshot,
  HostObservable,
  ThreadListItem,
  ThreadListActions,
  ThreadListSnapshot,
} from "@workbench/agent-runtime-core";

class MutableObservable<T> implements HostObservable<T> {
  readonly #listeners = new Set<() => void>();
  private value: T;

  constructor(value: T) {
    this.value = value;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly getSnapshot = (): T => this.value;

  set(next: T): void {
    if (Object.is(next, this.value)) return;
    this.value = next;
    for (const listener of this.#listeners) listener();
  }
}

const EMPTY_ATTACHMENTS = Object.freeze([]);

const EMPTY_COMPOSER: ComposerSnapshot = Object.freeze({
  text: "",
  attachments: EMPTY_ATTACHMENTS,
  mode: "send",
  phase: "idle",
});

export interface FakeConversationSessionOptions {
  readonly snapshot?: Partial<Omit<ConversationSnapshot, "sessionId" | "composer">> & {
    readonly composer?: Partial<ComposerSnapshot>;
  };
  readonly actions?: Partial<ConversationActions>;
}

/** Small mutable Session double for adapter and React-binding tests. */
export class FakeConversationSession implements ConversationSession {
  readonly id: string;
  readonly snapshot: HostObservable<ConversationSnapshot>;
  readonly actions: ConversationActions;
  readonly #snapshotSource: MutableObservable<ConversationSnapshot>;
  readonly #nodes = new Map<string, MutableObservable<ConversationNode | undefined>>();

  constructor(id: string, options: FakeConversationSessionOptions = {}) {
    this.id = id;
    const { composer: composerPatch, ...snapshotPatch } = options.snapshot ?? {};
    const composer = Object.freeze({ ...EMPTY_COMPOSER, ...composerPatch });
    this.#snapshotSource = new MutableObservable(
      Object.freeze({
        sessionId: id,
        nodeKeys: Object.freeze([]),
        isLoading: false,
        isRunning: false,
        hasMore: false,
        ...snapshotPatch,
        composer,
      }),
    );
    this.snapshot = this.#snapshotSource;
    const actions = options.actions;
    this.actions = Object.freeze({
      send: actions?.send ?? (async () => undefined),
      setComposerText: actions?.setComposerText ?? (() => undefined),
      addComposerAttachment: actions?.addComposerAttachment ?? (async () => undefined),
      addPastedTextAttachment: actions?.addPastedTextAttachment ?? (async () => undefined),
      retryPastedTextAttachment: actions?.retryPastedTextAttachment ?? (async () => undefined),
      readPastedTextAttachment:
        actions?.readPastedTextAttachment ??
        (async () => {
          throw new Error("Pasted text attachment reading is unavailable");
        }),
      readManagedFileAttachment:
        actions?.readManagedFileAttachment ??
        (async () => {
          throw new Error("Managed file attachment reading is unavailable");
        }),
      removeComposerAttachment: actions?.removeComposerAttachment ?? (() => undefined),
      dismissComposerError: actions?.dismissComposerError ?? (() => undefined),
      cancel: actions?.cancel ?? (async () => undefined),
      queue: actions?.queue ?? (async () => undefined),
      steer: actions?.steer ?? (async () => undefined),
      retry: actions?.retry ?? (async () => undefined),
      edit: actions?.edit ?? (async () => undefined),
      fork: actions?.fork ?? (async () => `${id}:fork`),
      selectBranch: actions?.selectBranch ?? (async () => undefined),
      editQueueItem: actions?.editQueueItem ?? (() => undefined),
      mutateQueueItem: actions?.mutateQueueItem ?? (() => undefined),
      setQueuePaused: actions?.setQueuePaused ?? (() => undefined),
      loadOlder: actions?.loadOlder ?? (async () => undefined),
      resume: actions?.resume ?? (async () => undefined),
      resumeLatest: actions?.resumeLatest ?? (async () => undefined),
    });
  }

  node(key: string): HostObservable<ConversationNode | undefined> {
    return this.#nodeSource(key);
  }

  #nodeSource(key: string): MutableObservable<ConversationNode | undefined> {
    let source = this.#nodes.get(key);
    if (!source) {
      source = new MutableObservable<ConversationNode | undefined>(undefined);
      this.#nodes.set(key, source);
    }
    return source;
  }

  patchSnapshot(patch: Partial<Omit<ConversationSnapshot, "sessionId">>): void {
    this.#snapshotSource.set(Object.freeze({ ...this.#snapshotSource.getSnapshot(), ...patch }));
  }

  setNode(node: ConversationNode): void {
    const snapshot = this.#snapshotSource.getSnapshot();
    const isNew = !snapshot.nodeKeys.includes(node.key);
    this.#nodeSource(node.key).set(node);
    if (isNew) this.patchSnapshot({ nodeKeys: Object.freeze([...snapshot.nodeKeys, node.key]) });
  }

  deleteNode(key: string): void {
    const snapshot = this.#snapshotSource.getSnapshot();
    if (!snapshot.nodeKeys.includes(key)) return;
    this.#nodeSource(key).set(undefined);
    this.patchSnapshot({
      nodeKeys: Object.freeze(snapshot.nodeKeys.filter((item) => item !== key)),
    });
  }
}

const EMPTY_THREADS: ThreadListSnapshot = Object.freeze({
  threads: Object.freeze([]),
  isLoading: false,
});

const NEW_THREAD: CurrentSessionSnapshot = Object.freeze({
  sessionId: undefined,
  isNewThread: true,
});

/** Deterministic in-memory Runtime used without Pi, React, or a transport. */
export class FakeAgentRuntime implements AgentRuntime {
  readonly threads: HostObservable<ThreadListSnapshot>;
  readonly current: HostObservable<CurrentSessionSnapshot>;
  readonly threadActions: Readonly<ThreadListActions>;
  readonly #threadSource = new MutableObservable(EMPTY_THREADS);
  readonly #currentSource = new MutableObservable(NEW_THREAD);
  readonly #sessions = new Map<string, ConversationSession>();
  #nextThread = 1;

  constructor(sessions: readonly ConversationSession[] = []) {
    this.threads = this.#threadSource;
    this.current = this.#currentSource;
    this.threadActions = Object.freeze({
      rename: async (threadId, title) => this.#patchThread(threadId, { title }),
      archive: async (threadId) => this.#patchThread(threadId, { isArchived: true }),
      unarchive: async (threadId) => this.#patchThread(threadId, { isArchived: false }),
      delete: async (threadId) => this.#deleteThread(threadId),
      setPinned: async (threadId, isPinned) => this.#patchThread(threadId, { isPinned }),
      moveWithinWorkspace: async ({ workspaceId, threadId, beforeThreadId }) => {
        const snapshot = this.#threadSource.getSnapshot();
        const moving = snapshot.threads.find((thread) => thread.threadId === threadId);
        if (!moving || moving.workspace?.id !== workspaceId) return;
        const remaining = snapshot.threads.filter((thread) => thread.threadId !== threadId);
        const beforeIndex = beforeThreadId
          ? remaining.findIndex((thread) => thread.threadId === beforeThreadId)
          : -1;
        const index = beforeIndex < 0 ? remaining.length : beforeIndex;
        this.#threadSource.set(
          Object.freeze({
            ...snapshot,
            threads: Object.freeze([
              ...remaining.slice(0, index),
              moving,
              ...remaining.slice(index),
            ]),
          }),
        );
      },
    } satisfies ThreadListActions);
    for (const session of sessions) this.addSession(session);
  }

  session(id: string): ConversationSession | undefined {
    return this.#sessions.get(id);
  }

  addSession(
    session: ConversationSession,
    thread: Partial<Omit<ThreadListItem, "threadId">> = {},
  ): void {
    if (this.#sessions.has(session.id)) throw new Error(`Duplicate fake Session: ${session.id}`);
    this.#sessions.set(session.id, session);
    const item: ThreadListItem = Object.freeze({
      threadId: session.id,
      isArchived: false,
      isPinned: false,
      isRunning: false,
      isWaitingForInput: false,
      hasUnreadCompletion: false,
      ...thread,
    });
    const snapshot = this.#threadSource.getSnapshot();
    this.#threadSource.set(
      Object.freeze({ ...snapshot, threads: Object.freeze([...snapshot.threads, item]) }),
    );
  }

  async createThread(options: CreateThreadOptions = {}): Promise<string> {
    let id: string;
    do id = `fake-thread-${this.#nextThread++}`;
    while (this.#sessions.has(id));
    const session = new FakeConversationSession(id);
    this.addSession(session, {
      ...(options.workspaceId ? { workspace: { id: options.workspaceId } } : {}),
    });
    this.switchToThread(id);
    return id;
  }

  createDraft(options: CreateThreadOptions = {}): string {
    let id: string;
    do id = `fake-draft-${this.#nextThread++}`;
    while (this.#sessions.has(id));
    const session = new FakeConversationSession(id);
    this.#sessions.set(id, session);
    this.#currentSource.set(Object.freeze({ sessionId: id, isNewThread: true }));
    void options;
    return id;
  }

  switchToThread(id: string): void {
    if (!this.#sessions.has(id)) throw new Error(`Unknown fake Session: ${id}`);
    if (this.#currentSource.getSnapshot().sessionId === id) return;
    this.#currentSource.set(Object.freeze({ sessionId: id, threadId: id, isNewThread: false }));
  }

  switchToNewThread(): void {
    if (this.#currentSource.getSnapshot().isNewThread) return;
    this.createDraft();
  }

  patchThreads(patch: Partial<ThreadListSnapshot>): void {
    this.#threadSource.set(Object.freeze({ ...this.#threadSource.getSnapshot(), ...patch }));
  }

  #patchThread(threadId: string, patch: Partial<ThreadListItem>): void {
    const snapshot = this.#threadSource.getSnapshot();
    const threads = snapshot.threads.map((thread) =>
      thread.threadId === threadId ? Object.freeze({ ...thread, ...patch }) : thread,
    );
    this.#threadSource.set(Object.freeze({ ...snapshot, threads: Object.freeze(threads) }));
  }

  #deleteThread(threadId: string): void {
    const snapshot = this.#threadSource.getSnapshot();
    this.#sessions.delete(threadId);
    this.#threadSource.set(
      Object.freeze({
        ...snapshot,
        threads: Object.freeze(snapshot.threads.filter((thread) => thread.threadId !== threadId)),
      }),
    );
    if (this.#currentSource.getSnapshot().sessionId === threadId) this.createDraft();
  }
}

export function createFakeConversationSession(
  id: string,
  options?: FakeConversationSessionOptions,
): FakeConversationSession {
  return new FakeConversationSession(id, options);
}

export function createFakeAgentRuntime(
  sessions?: readonly ConversationSession[],
): FakeAgentRuntime {
  return new FakeAgentRuntime(sessions);
}
