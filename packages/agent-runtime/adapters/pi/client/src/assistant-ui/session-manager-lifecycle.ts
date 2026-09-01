interface MutableRef<T> {
  current: T;
}

export interface PiSessionManagerLifecycleTarget {
  start(): Promise<void>;
  dispose(): void;
}

/**
 * Start an owned Pi manager and defer disposal across React's Strict Effects replay.
 *
 * A replacement setup increments the lifecycle generation before the queued cleanup runs, so the
 * same manager is retained. A real unmount, or a Fast Refresh replacement with a new manager,
 * disposes the old owner exactly once.
 */
export function beginPiSessionManagerLifecycle<T extends PiSessionManagerLifecycleTarget>(
  manager: T,
  currentManager: MutableRef<T | null>,
  lifecycleGeneration: MutableRef<number>,
  onStartError: (error: unknown) => void,
): () => void {
  const lifecycle = ++lifecycleGeneration.current;
  void manager.start().catch(onStartError);

  return () => {
    queueMicrotask(() => {
      if (currentManager.current !== manager || lifecycleGeneration.current === lifecycle) {
        manager.dispose();
      }
    });
  };
}
