export interface ThreadListReloadCoordinator {
  request(): void;
  dispose(): void;
}

/**
 * Coalesces pull-based thread-list reloads without allowing concurrent requests.
 *
 * Same-turn invalidations share one reload. Invalidations received while that reload is pending
 * request at most one trailing reload, which then observes the latest backend snapshot.
 */
export function createThreadListReloadCoordinator(options: {
  reload(): Promise<void>;
  onError(error: unknown): void;
}): ThreadListReloadCoordinator {
  let disposed = false;
  let scheduled = false;
  let running = false;
  let dirty = false;

  const run = async () => {
    scheduled = false;
    if (disposed || running) return;

    running = true;
    try {
      do {
        dirty = false;
        try {
          await options.reload();
        } catch (error) {
          options.onError(error);
        }
      } while (!disposed && dirty);
    } finally {
      running = false;
    }
  };

  return {
    request() {
      if (disposed) return;
      if (running) {
        dirty = true;
        return;
      }
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => void run());
    },
    dispose() {
      disposed = true;
      dirty = false;
    },
  };
}
