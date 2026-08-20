type Listener = () => void;

let open = false;
const listeners = new Set<Listener>();

function setOpen(nextOpen: boolean): void {
  if (open === nextOpen) return;
  open = nextOpen;
  for (const listener of listeners) listener();
}

export const settingsOverlayStore = Object.freeze({
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
  open(): void {
    setOpen(true);
  },
  close(): void {
    setOpen(false);
  },
  setOpen,
});
