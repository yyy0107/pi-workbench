type ScheduledPublication = "none" | "microtask" | "animation-frame";

type FrameScheduler = (callback: () => void) => unknown;

function requestFrame(callback: () => void): void {
  const runtimeGlobal = globalThis as { requestAnimationFrame?: FrameScheduler };
  if (runtimeGlobal.requestAnimationFrame) runtimeGlobal.requestAnimationFrame(callback);
  else queueMicrotask(callback);
}

/** Rebuild-before-notify primitive with microtask, animation-frame, and immediate publication. */
export class Notifier {
  readonly #listeners = new Set<() => void>();
  readonly #rebuildSnapshot: () => void;
  #dirty = false;
  #notificationPending = false;
  #scheduled: ScheduledPublication = "none";
  #generation = 0;

  constructor(rebuildSnapshot: () => void) {
    this.#rebuildSnapshot = rebuildSnapshot;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Batch ordinary state changes at the next microtask boundary. */
  markDirty(): void {
    this.#markChanged();
    if (this.#scheduled === "microtask") return;
    this.#schedule("microtask");
  }

  /** Batch high-frequency visible changes at most once per animation frame. */
  markFrameDirty(): void {
    this.#markChanged();
    if (this.#scheduled !== "none") return;
    this.#schedule("animation-frame");
  }

  /** Publish synchronously, for example when echoing a controlled Composer input. */
  notifyNow(): void {
    this.#markChanged();
    this.#generation += 1;
    this.#scheduled = "none";
    this.#flush();
  }

  /** Rebuild a dirty cache for pull readers without consuming a pending push notification. */
  ensureFresh(): void {
    if (!this.#dirty) return;
    this.#dirty = false;
    this.#rebuildSnapshot();
  }

  #markChanged(): void {
    this.#dirty = true;
    this.#notificationPending = true;
  }

  #schedule(kind: Exclude<ScheduledPublication, "none">): void {
    const generation = ++this.#generation;
    this.#scheduled = kind;
    const publish = () => {
      if (generation !== this.#generation) return;
      this.#scheduled = "none";
      this.#flush();
    };
    if (kind === "animation-frame") requestFrame(publish);
    else queueMicrotask(publish);
  }

  #flush(): void {
    if (!this.#notificationPending || this.#listeners.size === 0) return;
    this.#notificationPending = false;
    this.ensureFresh();
    for (const listener of this.#listeners) listener();
  }
}
