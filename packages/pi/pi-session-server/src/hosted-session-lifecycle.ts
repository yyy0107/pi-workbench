/** Owns idempotent liveness, shutdown, and final disposal for one hosted SDK session. */
export class HostedSessionLifecycle {
  private alive = true;
  private shutdownTask?: Promise<void>;
  private readonly disposeRuntime: () => Promise<void>;

  constructor(disposeRuntime: () => Promise<void>) {
    this.disposeRuntime = disposeRuntime;
  }

  get isAlive(): boolean {
    return this.alive;
  }

  shutdown(stop: () => Promise<void>): Promise<void> {
    if (this.shutdownTask) return this.shutdownTask;
    if (!this.alive) return Promise.resolve();
    this.alive = false;
    this.shutdownTask = stop();
    return this.shutdownTask;
  }

  dispose(): Promise<void> {
    return this.disposeRuntime();
  }
}
