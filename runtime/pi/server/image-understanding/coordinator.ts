import type {
  ImageUnderstandingEngine,
  ImageUnderstandingSettingsValue,
} from "../../rpc-contracts";

export type ImageUnderstandingRouteDecision =
  | { kind: "none"; reason: "no-images" }
  | {
      kind: "native";
      method: "native";
      reason: "auto-native" | "native-only" | "recognition-disabled";
    }
  | {
      kind: "preprocess";
      method: ImageUnderstandingEngine;
      providerId: string;
      model: string;
      reason: "auto-text-only" | "always-preprocess";
    }
  | {
      kind: "unsupported";
      reason: "recognition-disabled" | "native-model-required" | "preprocessor-not-configured";
    };

export interface DecideImageUnderstandingRouteInput {
  settings: ImageUnderstandingSettingsValue;
  hasImages: boolean;
  modelSupportsImages: boolean;
}

function preprocessDecision(
  settings: ImageUnderstandingSettingsValue,
  reason: "auto-text-only" | "always-preprocess",
): ImageUnderstandingRouteDecision {
  if (settings.engine === "ocr") {
    const provider = settings.ocrProvider === "glm-ocr" ? settings.glm : settings.paddle;
    if (!provider.model.trim() || !provider.credentialConfigured) {
      return { kind: "unsupported", reason: "preprocessor-not-configured" };
    }
    return {
      kind: "preprocess",
      method: "ocr",
      providerId: settings.ocrProvider,
      model: provider.model,
      reason,
    };
  }
  if (!settings.multimodal.provider.trim() || !settings.multimodal.model.trim()) {
    return { kind: "unsupported", reason: "preprocessor-not-configured" };
  }
  return {
    kind: "preprocess",
    method: "multimodal",
    providerId: settings.multimodal.provider,
    model: settings.multimodal.model,
    reason,
  };
}

export function decideImageUnderstandingRoute(
  input: DecideImageUnderstandingRouteInput,
): ImageUnderstandingRouteDecision {
  if (!input.hasImages) return { kind: "none", reason: "no-images" };
  if (input.settings.routing === "disabled") {
    return input.modelSupportsImages
      ? { kind: "native", method: "native", reason: "recognition-disabled" }
      : { kind: "unsupported", reason: "recognition-disabled" };
  }
  if (input.settings.routing === "native-only") {
    return input.modelSupportsImages
      ? { kind: "native", method: "native", reason: "native-only" }
      : { kind: "unsupported", reason: "native-model-required" };
  }
  if (input.settings.routing === "always-preprocess") {
    return preprocessDecision(input.settings, "always-preprocess");
  }
  if (input.modelSupportsImages) {
    return { kind: "native", method: "native", reason: "auto-native" };
  }
  return preprocessDecision(input.settings, "auto-text-only");
}
