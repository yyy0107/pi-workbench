import {
  getOcrAdapterPreset,
  inferOcrAdapterPreset,
} from "@workbench/attachment-understanding-contracts/ocr-adapter";
import type {
  AttachmentUnderstandingSettingsValue,
  ImageUnderstandingOcrAdapterSettingsValue,
} from "@workbench/agent-runtime-pi-protocol/rpc";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasOcrAdapterSettings(value: AttachmentUnderstandingSettingsValue): boolean {
  const adapter = (value as { ocrAdapter?: unknown }).ocrAdapter;
  return (
    isRecord(adapter) &&
    typeof adapter.preset === "string" &&
    typeof adapter.source === "string" &&
    typeof adapter.endpoint === "string" &&
    typeof adapter.model === "string" &&
    typeof adapter.credentialConfigured === "boolean" &&
    Number.isSafeInteger(adapter.pollIntervalMs) &&
    Number.isSafeInteger(adapter.pollTimeoutMs)
  );
}

/**
 * Normalizes responses from a Host that predates the adapter wire field. This is display-only
 * compatibility: callers should still require a Host restart before editing adapter settings.
 */
export function ocrAdapterSettingsFromValue(
  value: AttachmentUnderstandingSettingsValue,
): ImageUnderstandingOcrAdapterSettingsValue {
  if (hasOcrAdapterSettings(value)) return value.ocrAdapter;

  const presetId = inferOcrAdapterPreset(
    value.ocrProvider,
    value.ocrProvider === "glm-ocr" ? value.glm.model : value.paddle.model,
  );
  const preset = getOcrAdapterPreset(presetId);
  const legacy = value.ocrProvider === "glm-ocr" ? value.glm : value.paddle;
  return {
    preset: presetId,
    source: preset.source,
    endpoint: legacy.endpoint,
    model: legacy.model,
    credentialConfigured: legacy.credentialConfigured,
    pollIntervalMs:
      value.ocrProvider === "paddleocr" ? value.paddle.pollIntervalMs : preset.pollIntervalMs,
    pollTimeoutMs:
      value.ocrProvider === "paddleocr" ? value.paddle.pollTimeoutMs : preset.pollTimeoutMs,
  };
}
