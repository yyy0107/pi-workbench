import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import type { PiRunTiming, PiSessionSummary } from "@workbench/pi-rpc-contracts/messages";

export interface LiveSessionStateHost {
  readonly id: string;
  readonly isAlive: boolean;
  readonly isRunning: boolean;
  readonly runTiming?: PiRunTiming;
  shutdown(): Promise<void>;
}

export type RunningSessionListener = (sessionIds: string[]) => void;

/** Process-retained ownership for live SDK sessions and their start locks. */
export class LiveSessionRegistryState<Host extends LiveSessionStateHost> {
  readonly sessions: Map<string, Host>;
  readonly startLocks: Map<string, Promise<Host>>;
  readonly runningListeners: Set<RunningSessionListener>;
  lastRunningKey: string;

  constructor(
    sessions = new Map<string, Host>(),
    startLocks = new Map<string, Promise<Host>>(),
    runningListeners = new Set<RunningSessionListener>(),
    lastRunningKey = "",
  ) {
    this.sessions = sessions;
    this.startLocks = startLocks;
    this.runningListeners = runningListeners;
    this.lastRunningKey = lastRunningKey;
  }

  attach(host: Host): void {
    this.sessions.set(host.id, host);
  }

  get(id: string): Host | undefined {
    return this.sessions.get(id);
  }

  getStart(id: string): Promise<Host> | undefined {
    return this.startLocks.get(id);
  }

  trackStart(id: string, task: Promise<Host>): Promise<Host> {
    this.startLocks.set(id, task);
    void task
      .finally(() => {
        if (this.startLocks.get(id) === task) this.startLocks.delete(id);
      })
      .catch(() => undefined);
    return task;
  }

  loaded(): readonly Host[] {
    return [...this.sessions.values()].filter((host) => host.isAlive);
  }

  runningIds(): string[] {
    return this.loaded()
      .filter((host) => host.isRunning)
      .map((host) => host.id)
      .sort();
  }

  subscribeRunning(listener: RunningSessionListener): () => void {
    this.runningListeners.add(listener);
    return () => this.runningListeners.delete(listener);
  }

  detach(host: Host): boolean {
    if (this.sessions.get(host.id) !== host) return false;
    this.sessions.delete(host.id);
    return true;
  }
}

/** Process-retained ownership for the cold Pi JSONL directory cache. */
export class PersistedSessionRegistryState {
  readonly sessions: Map<string, SessionInfo>;
  readonly summaries: Map<string, PiSessionSummary>;
  readonly fingerprints: Map<string, string>;
  cacheKey: string;
  cacheReady: boolean;
  cacheTask?: Promise<void>;

  constructor(
    sessions = new Map<string, SessionInfo>(),
    summaries = new Map<string, PiSessionSummary>(),
    fingerprints = new Map<string, string>(),
    cacheKey = "",
    cacheReady = false,
    cacheTask?: Promise<void>,
  ) {
    this.sessions = sessions;
    this.summaries = summaries;
    this.fingerprints = fingerprints;
    this.cacheKey = cacheKey;
    this.cacheReady = cacheReady;
    this.cacheTask = cacheTask;
  }

  remove(id: string): SessionInfo | undefined {
    const info = this.sessions.get(id);
    this.sessions.delete(id);
    this.summaries.delete(id);
    if (info?.path) this.fingerprints.delete(info.path);
    return info;
  }
}

export interface ScratchSessionStateRecord {
  readonly id: string;
  readonly sourceSessionId: string;
  readonly workspaceId?: string;
  readonly cwd: string;
  readonly filePath: string;
  readonly createdAt: number;
  expiresAt: number;
  expiryTimer?: ReturnType<typeof setTimeout>;
}

/** Process-retained ownership for temporary sessions and their cleanup timers. */
export class ScratchSessionRegistryState {
  readonly sessions: Map<string, ScratchSessionStateRecord>;
  directory?: string;

  constructor(sessions = new Map<string, ScratchSessionStateRecord>(), directory?: string) {
    this.sessions = sessions;
    this.directory = directory;
  }

  get(id: string): ScratchSessionStateRecord | undefined {
    return this.sessions.get(id);
  }

  set(record: ScratchSessionStateRecord): void {
    this.sessions.set(record.id, record);
  }

  delete(id: string): boolean {
    return this.sessions.delete(id);
  }
}

/** Serializes fork file creation without sharing the rest of registry state. */
export class SessionForkSerializer {
  tail: Promise<void>;

  constructor(tail: Promise<void> = Promise.resolve()) {
    this.tail = tail;
  }

  async run<Value>(operation: () => Promise<Value>): Promise<Value> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

export interface PiSessionRegistryState<Host extends LiveSessionStateHost> {
  readonly live: LiveSessionRegistryState<Host>;
  readonly persisted: PersistedSessionRegistryState;
  readonly scratch: ScratchSessionRegistryState;
  readonly forks: SessionForkSerializer;
}

interface LegacyRegistryState<Host extends LiveSessionStateHost> {
  sessions: Map<string, Host>;
  startLocks: Map<string, Promise<Host>>;
  scratchSessions?: Map<string, ScratchSessionStateRecord>;
  scratchDirectory?: string;
  persistedSessions?: Map<string, SessionInfo>;
  persistedSessionSummaries?: Map<string, PiSessionSummary>;
  persistedSessionFingerprints?: Map<string, string>;
  persistedSessionCacheKey?: string;
  persistedSessionCacheReady?: boolean;
  persistedSessionCacheTask?: Promise<void>;
  runningListeners: Set<RunningSessionListener>;
  lastRunningKey: string;
  forkTail?: Promise<void>;
}

/** Keeps one authoritative state graph across server composition and development HMR. */
export function processPiSessionRegistryState<
  Host extends LiveSessionStateHost,
>(): PiSessionRegistryState<Host> {
  const processGlobal = globalThis as typeof globalThis & {
    __workbenchPiRegistry?:
      | PiSessionRegistryState<LiveSessionStateHost>
      | LegacyRegistryState<LiveSessionStateHost>;
  };
  const retained = processGlobal.__workbenchPiRegistry;
  if (!retained || !("live" in retained)) {
    const live = new LiveSessionRegistryState<LiveSessionStateHost>(
      retained?.sessions,
      retained?.startLocks,
      retained?.runningListeners,
      retained?.lastRunningKey,
    );
    const persisted = new PersistedSessionRegistryState(
      retained?.persistedSessions,
      retained?.persistedSessionSummaries,
      retained?.persistedSessionFingerprints,
      retained?.persistedSessionCacheKey,
      retained?.persistedSessionCacheReady,
      retained?.persistedSessionCacheTask,
    );
    const scratch = new ScratchSessionRegistryState(
      retained?.scratchSessions,
      retained?.scratchDirectory,
    );
    const forks = new SessionForkSerializer(retained?.forkTail);
    const state = (retained ?? {}) as PiSessionRegistryState<LiveSessionStateHost>;
    Object.assign(state, { live, persisted, scratch, forks });
    if (retained) {
      // Old module-generation closures retain this object. Redirect their scalar writes and map
      // reads to the new owners until those closures finish; new code only uses the composed fields.
      Object.defineProperties(state, {
        sessions: { get: () => live.sessions },
        startLocks: { get: () => live.startLocks },
        runningListeners: { get: () => live.runningListeners },
        lastRunningKey: {
          get: () => live.lastRunningKey,
          set: (value) => (live.lastRunningKey = value),
        },
        persistedSessions: { get: () => persisted.sessions },
        persistedSessionSummaries: { get: () => persisted.summaries },
        persistedSessionFingerprints: { get: () => persisted.fingerprints },
        persistedSessionCacheKey: {
          get: () => persisted.cacheKey,
          set: (value) => (persisted.cacheKey = value),
        },
        persistedSessionCacheReady: {
          get: () => persisted.cacheReady,
          set: (value) => (persisted.cacheReady = value),
        },
        persistedSessionCacheTask: {
          get: () => persisted.cacheTask,
          set: (value) => (persisted.cacheTask = value),
        },
        scratchSessions: { get: () => scratch.sessions },
        scratchDirectory: {
          get: () => scratch.directory,
          set: (value) => (scratch.directory = value),
        },
        forkTail: { get: () => forks.tail, set: (value) => (forks.tail = value) },
      });
    }
    processGlobal.__workbenchPiRegistry = state;
  }
  return processGlobal.__workbenchPiRegistry as PiSessionRegistryState<Host>;
}
