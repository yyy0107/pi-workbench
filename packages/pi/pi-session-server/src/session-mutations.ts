/** Serializes all mutations of one authoritative hosted session. */
export class SerializedSessionMutations {
  private tail: Promise<void> = Promise.resolve();

  run<Value>(mutation: () => Promise<Value>): Promise<Value> {
    const run = this.tail.catch(() => undefined).then(mutation);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
