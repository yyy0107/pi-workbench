import { getSupportedThinkingLevels, type Api, type Model } from "@earendil-works/pi-ai";
import type {
  ModelCapabilitySource,
  ModelCapabilityState,
} from "@workbench/agent-runtime-pi-protocol/rpc";

export type ModelInputModality = "text" | "image";

export function supportedModelThinkingLevels(
  model: Pick<Model<Api>, "reasoning" | "thinkingLevelMap">,
) {
  // Pi's helper only reads these two fields; drafts and catalog DTOs omit other Model fields.
  return getSupportedThinkingLevels(model as Model<Api>);
}

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
