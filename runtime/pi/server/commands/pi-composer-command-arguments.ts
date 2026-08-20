import type { WorkbenchComposerCommandSubmission } from "../../../composer-request";
import { PiServerError } from "../core/errors";

export const PI_COMPACT_CUSTOM_INSTRUCTIONS_MAX_LENGTH = 32_768;

function invalidCommandArguments(): never {
  throw new PiServerError("pi_composer_command_args_invalid", 400);
}

function optionalInstructions(value: string): string | undefined {
  const instructions = value.trim();
  if (instructions.length > PI_COMPACT_CUSTOM_INSTRUCTIONS_MAX_LENGTH) {
    invalidCommandArguments();
  }
  return instructions || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Resolves the canonical object shape while retaining string and implicit-text compatibility for
 * Composer v1 clients that predate structured argument binding.
 */
export function resolvePiCompactCustomInstructions(
  command: WorkbenchComposerCommandSubmission,
  fallbackText: string,
): string | undefined {
  const args = command.args;
  if (args === undefined) return optionalInstructions(fallbackText);
  if (typeof args === "string") return optionalInstructions(args);
  if (args === null) return undefined;
  if (!isRecord(args)) return invalidCommandArguments();

  const keys = Object.keys(args);
  if (keys.some((key) => key !== "customInstructions")) return invalidCommandArguments();
  const customInstructions = args.customInstructions;
  if (customInstructions === undefined) return undefined;
  if (typeof customInstructions !== "string") return invalidCommandArguments();
  return optionalInstructions(customInstructions);
}

/** Canonical object args leave `fallbackText` available as the ordinary prompt after the action. */
export function piCompactUsesLegacyArguments(command: WorkbenchComposerCommandSubmission): boolean {
  return !isRecord(command.args);
}

/** Validates the command-specific shape before the durable user marker or any side effect. */
export function validatePiCompactCommandArguments(
  command: WorkbenchComposerCommandSubmission,
  fallbackText: string,
): void {
  resolvePiCompactCustomInstructions(command, fallbackText);
}
