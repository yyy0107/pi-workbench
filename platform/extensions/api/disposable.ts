export interface Disposable {
  dispose(): void;
}

export function createDisposable(dispose: () => void): Disposable {
  let disposed = false;

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      dispose();
    },
  };
}

export function disposeAll(disposables: Iterable<Disposable>): void {
  const errors: unknown[] = [];

  for (const disposable of Array.from(disposables).reverse()) {
    try {
      disposable.dispose();
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, "Multiple extension disposables failed");
  }
}
