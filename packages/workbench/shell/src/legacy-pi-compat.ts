/**
 * Read-only compatibility for persisted state and wire metadata written before the generic Shell
 * package boundary existed. New Shell state must never be written with these product-specific
 * identifiers; keep every remaining literal centralized here so it can be removed as one migration.
 */

export const LEGACY_COMMAND_DIRECTIVE_TYPE = "pi-command";
export const LEGACY_PROJECT_SKILL_DIRECTIVE_TYPE = "pi-project-skill";
export const LEGACY_USER_SKILL_DIRECTIVE_TYPE = "pi-user-skill";

export const LEGACY_COMPOSER_DIRECTIVE_RE =
  /:(workbench-command|agent-command|pi-command|workbench-command-argument-end)\[([^|\]\n]{1,2048})\|([^\]\n]{1,4096})\]/gu;

export const LEGACY_RIGHT_WORKSPACE_STORAGE_KEY = "pi-workbench:right-workspace:v1";

export function readLegacyRunningIndicatorPreferences(
  value: Record<string, unknown>,
): Readonly<{ styleId: unknown; size: unknown }> {
  return {
    styleId: value.piWorkingOrbState,
    size: value.piWorkingOrbSize,
  };
}
