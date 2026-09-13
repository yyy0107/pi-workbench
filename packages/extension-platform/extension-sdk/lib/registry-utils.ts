export type RegistryListener = () => void;

export function assertNonEmptyId(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

export function emitRegistryChange(listeners: ReadonlySet<RegistryListener>): void {
  for (const listener of listeners) listener();
}
