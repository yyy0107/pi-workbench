/** Read-only migration for appearance values saved by earlier Pi clients. */
export function readLegacyRunningIndicatorPreferences(
  value: Record<string, unknown>,
): Readonly<{ styleId: unknown; size: unknown }> {
  return { styleId: value.piWorkingOrbState, size: value.piWorkingOrbSize };
}
