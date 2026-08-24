import type { ModelCapabilitySource, ModelCapabilityState } from "./rpc-contracts";

export type ModelInputModality = "text" | "image";

export function imageInputCapability(
  input: readonly ModelInputModality[] | undefined,
): ModelCapabilityState {
  if (input === undefined) return "unknown";
  return input.includes("image") ? "supported" : "unsupported";
}

export function verifiedImageInputCapability(
  input: readonly ModelInputModality[] | undefined,
  source: ModelCapabilitySource | undefined,
): ModelCapabilityState {
  return source === undefined ? "unknown" : imageInputCapability(input);
}
