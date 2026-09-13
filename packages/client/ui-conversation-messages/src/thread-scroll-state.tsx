"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

const MAX_SAVED_THREAD_SCROLL_POSITIONS = 50;

export interface ThreadReadingPosition {
  readonly messageId: string;
  readonly offsetTop: number;
}

interface ThreadScrollPosition {
  readonly scrollTop: number;
  readonly atBottom: boolean;
  readonly anchor?: ThreadReadingPosition;
}

function readingPosition(value: unknown): ThreadReadingPosition | undefined {
  if (
    !value ||
    typeof value !== "object" ||
    !("messageId" in value) ||
    typeof value.messageId !== "string" ||
    value.messageId.length === 0 ||
    !("offsetTop" in value) ||
    typeof value.offsetTop !== "number" ||
    !Number.isFinite(value.offsetTop)
  ) {
    return undefined;
  }
  return Object.freeze({ messageId: value.messageId, offsetTop: value.offsetTop });
}

/**
 * Optional persistence owned by the application installation. The port deliberately exchanges one
 * opaque serialized value so Shell never chooses a browser storage area or a cross-app namespace.
 */
export interface ThreadScrollPersistencePort {
  read(): string | null;
  write(serialized: string): void;
}

interface ThreadScrollState {
  get(threadId: string): ThreadScrollPosition | undefined;
  save(threadId: string, position: ThreadScrollPosition): void;
  dispose(): void;
}

function snapshotPersistencePort(
  persistence: ThreadScrollPersistencePort | undefined,
): ThreadScrollPersistencePort | undefined {
  if (!persistence) return undefined;
  const read = persistence.read.bind(persistence);
  const write = persistence.write.bind(persistence);
  return Object.freeze({
    read: () => read(),
    write: (serialized: string) => write(serialized),
  });
}

function parseThreadScrollPositions(serialized: string | null): Map<string, ThreadScrollPosition> {
  const positions = new Map<string, ThreadScrollPosition>();
  if (!serialized) return positions;

  try {
    const entries: unknown = JSON.parse(serialized);
    if (!Array.isArray(entries)) return positions;

    for (const entry of entries.slice(-MAX_SAVED_THREAD_SCROLL_POSITIONS)) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [threadId, position] = entry;
      if (
        typeof threadId !== "string" ||
        !position ||
        typeof position !== "object" ||
        !("scrollTop" in position) ||
        !("atBottom" in position) ||
        typeof position.scrollTop !== "number" ||
        !Number.isFinite(position.scrollTop) ||
        typeof position.atBottom !== "boolean"
      ) {
        continue;
      }
      const anchor =
        !position.atBottom && "anchor" in position ? readingPosition(position.anchor) : undefined;
      positions.set(
        threadId,
        Object.freeze({
          scrollTop: Math.max(0, position.scrollTop),
          atBottom: position.atBottom,
          ...(anchor ? { anchor } : {}),
        }),
      );
    }
  } catch {
    // Scroll restoration is an enhancement; malformed app persistence starts with an empty cache.
  }
  return positions;
}

export function createThreadScrollState(
  persistenceInput?: ThreadScrollPersistencePort,
): ThreadScrollState {
  const persistence = snapshotPersistencePort(persistenceInput);
  let positions = new Map<string, ThreadScrollPosition>();
  let loaded = false;
  let disposed = false;
  let persistenceFrame: number | null = null;

  const load = () => {
    if (loaded || disposed) return;
    loaded = true;
    if (!persistence) return;
    try {
      positions = parseThreadScrollPositions(persistence.read());
    } catch {
      // An unavailable application persistence port falls back to this installation's memory.
    }
  };
  const persist = () => {
    if (disposed || !persistence) return;
    try {
      persistence.write(JSON.stringify(Array.from(positions.entries())));
    } catch {
      // The installation-local cache remains useful when persistence is unavailable.
    }
  };

  return Object.freeze({
    get(threadId: string): ThreadScrollPosition | undefined {
      if (disposed) return undefined;
      load();
      return positions.get(threadId);
    },
    save(threadId: string, position: ThreadScrollPosition): void {
      if (disposed) return;
      load();
      positions.delete(threadId);
      const anchor = !position.atBottom ? readingPosition(position.anchor) : undefined;
      positions.set(
        threadId,
        Object.freeze({
          scrollTop: Math.max(0, position.scrollTop),
          atBottom: position.atBottom,
          ...(anchor ? { anchor } : {}),
        }),
      );

      while (positions.size > MAX_SAVED_THREAD_SCROLL_POSITIONS) {
        const oldestThreadId = positions.keys().next().value;
        if (oldestThreadId === undefined) break;
        positions.delete(oldestThreadId);
      }

      if (!persistence || persistenceFrame !== null) return;
      if (typeof window.requestAnimationFrame !== "function") {
        persist();
        return;
      }
      persistenceFrame = window.requestAnimationFrame(() => {
        persistenceFrame = null;
        persist();
      });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (persistenceFrame !== null && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(persistenceFrame);
      }
      persistenceFrame = null;
      positions.clear();
    },
  });
}

const ThreadScrollStateContext = createContext<ThreadScrollState | undefined>(undefined);

/** Owns one immutable thread-scroll cache for exactly one WorkbenchShell installation. */
export function ThreadScrollStateProvider({
  children,
  persistence,
}: Readonly<{
  children: ReactNode;
  persistence?: ThreadScrollPersistencePort;
}>) {
  const installedPersistence = useRef(persistence);
  if (installedPersistence.current !== persistence) {
    throw new Error(
      "WorkbenchShell threadScrollPersistence cannot change after the Shell is mounted; remount it with a new React key",
    );
  }
  const [state] = useState(() => createThreadScrollState(installedPersistence.current));
  const lifecycleGeneration = useRef(0);

  useEffect(() => {
    const generation = ++lifecycleGeneration.current;
    return () => {
      queueMicrotask(() => {
        // Strict Effects immediately installs a newer generation. Only a true unmount owns the
        // cache, pending animation frame, and application persistence port teardown boundary.
        if (lifecycleGeneration.current === generation) state.dispose();
      });
    };
  }, [state]);

  return (
    <ThreadScrollStateContext.Provider value={state}>{children}</ThreadScrollStateContext.Provider>
  );
}

export function useThreadScrollState(): ThreadScrollState {
  const state = useContext(ThreadScrollStateContext);
  if (!state) {
    throw new Error(
      "WorkbenchConversation must be rendered within its WorkbenchShell installation",
    );
  }
  return state;
}
