import type {
  AttachmentUnderstandingEngine,
  AttachmentUnderstandingSettingsValue,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import { parseOcrAdapterSource } from "@workbench/attachment-understanding-contracts/ocr-adapter";

export type AttachmentUnderstandingRouteDecision =
  | { kind: "none"; reason: "no-attachments" }
  | {
      kind: "native";
      method: "native";
      reason: "auto-native" | "native-only" | "recognition-disabled";
    }
  | {
      kind: "preprocess";
      method: AttachmentUnderstandingEngine;
      providerId: string;
      model: string;
      reason: "auto-text-only" | "always-preprocess";
    }
  | {
      kind: "unsupported";
      reason:
        | "recognition-disabled"
        | "native-model-required"
        | "document-ocr-required"
        | "preprocessor-not-configured";
    };

export interface DecideAttachmentUnderstandingRouteInput {
  settings: AttachmentUnderstandingSettingsValue;
  hasImages: boolean;
  hasDocuments?: boolean;
  modelSupportsImages: boolean;
}

function preprocessDecision(
  settings: AttachmentUnderstandingSettingsValue,
  reason: "auto-text-only" | "always-preprocess",
): AttachmentUnderstandingRouteDecision {
  if (settings.engine === "ocr") {
    const adapter = settings.ocrAdapter;
    if (!adapter.model.trim() || !adapter.credentialConfigured) {
      return { kind: "unsupported", reason: "preprocessor-not-configured" };
    }
    let providerId: string;
    try {
      providerId = parseOcrAdapterSource(adapter.source).id;
    } catch {
      return { kind: "unsupported", reason: "preprocessor-not-configured" };
    }
    return {
      kind: "preprocess",
      method: "ocr",
      providerId,
      model: adapter.model,
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

export function decideAttachmentUnderstandingRoute(
  input: DecideAttachmentUnderstandingRouteInput,
): AttachmentUnderstandingRouteDecision {
  const hasDocuments = input.hasDocuments === true;
  if (!input.hasImages && !hasDocuments) return { kind: "none", reason: "no-attachments" };
  if (input.settings.routing === "disabled") {
    return !hasDocuments && input.modelSupportsImages
      ? { kind: "native", method: "native", reason: "recognition-disabled" }
      : { kind: "unsupported", reason: "recognition-disabled" };
  }
  if (input.settings.routing === "native-only") {
    if (hasDocuments) return { kind: "unsupported", reason: "document-ocr-required" };
    return { kind: "native", method: "native", reason: "native-only" };
  }
  if (hasDocuments && input.settings.engine !== "ocr") {
    return { kind: "unsupported", reason: "document-ocr-required" };
  }
  if (input.settings.routing === "always-preprocess") {
    return preprocessDecision(input.settings, "always-preprocess");
  }
  if (!hasDocuments && input.modelSupportsImages) {
    return { kind: "native", method: "native", reason: "auto-native" };
  }
  return preprocessDecision(input.settings, "auto-text-only");
}

/** @deprecated Use the attachment-neutral coordinator name for new integrations. */
export type ImageUnderstandingRouteDecision = AttachmentUnderstandingRouteDecision;
/** @deprecated Use the attachment-neutral coordinator input name for new integrations. */
export type DecideImageUnderstandingRouteInput = DecideAttachmentUnderstandingRouteInput;
export const decideImageUnderstandingRoute = decideAttachmentUnderstandingRoute;
