export interface TerminalWriteTarget {
  write(data: string, callback?: () => void): void;
}

export interface TerminalFrameScheduler {
  requestFrame(callback: () => void): number;
  cancelFrame(frame: number): void;
}

export interface TerminalFrameWriter {
  enqueue(data: string, afterWrite?: () => void): void;
  flush(): void;
  dispose(): void;
}

const browserFrameScheduler: TerminalFrameScheduler = {
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (frame) => cancelAnimationFrame(frame),
};

export function createTerminalFrameWriter(
  target: TerminalWriteTarget,
  scheduler: TerminalFrameScheduler = browserFrameScheduler,
): TerminalFrameWriter {
  let disposed = false;
  let scheduledFrame: number | undefined;
  let chunks: string[] = [];
  let callbacks = new Set<() => void>();

  const writePending = () => {
    if (disposed || chunks.length === 0) return;
    const data = chunks.join("");
    const afterWrite = [...callbacks];
    chunks = [];
    callbacks = new Set();
    target.write(
      data,
      afterWrite.length > 0
        ? () => {
            if (disposed) return;
            for (const callback of afterWrite) callback();
          }
        : undefined,
    );
  };

  const flush = () => {
    if (disposed) return;
    if (scheduledFrame !== undefined) {
      scheduler.cancelFrame(scheduledFrame);
      scheduledFrame = undefined;
    }
    writePending();
  };

  return {
    enqueue(data, afterWrite) {
      if (disposed || !data) return;
      chunks.push(data);
      if (afterWrite) callbacks.add(afterWrite);
      if (scheduledFrame !== undefined) return;
      scheduledFrame = scheduler.requestFrame(() => {
        scheduledFrame = undefined;
        writePending();
      });
    },
    flush,
    dispose() {
      if (disposed) return;
      if (scheduledFrame !== undefined) scheduler.cancelFrame(scheduledFrame);
      disposed = true;
      scheduledFrame = undefined;
      chunks = [];
      callbacks.clear();
    },
  };
}
