type Listener = () => void;

let open = false;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

export const commandPaletteStore = Object.freeze({
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): boolean {
    return open;
  },
  getServerSnapshot(): boolean {
    return false;
  },
  setOpen(nextOpen: boolean): void {
    if (open === nextOpen) return;
    open = nextOpen;
    emit();
  },
});
