/** Minimal snapshot source shared by Headless Runtime implementations and UI bindings. */
export interface HostObservable<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}
