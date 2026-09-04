import type { OcrAdapterPresetId } from "./ocr-adapter";

export type AttachmentUnderstandingRouting =
  | "auto"
  | "always-preprocess"
  | "native-only"
  | "disabled";
export type AttachmentUnderstandingEngine = "ocr" | "multimodal";
export type AttachmentUnderstandingOcrProvider = "glm-ocr" | "paddleocr";

export interface AttachmentUnderstandingOcrAdapterSettingsValue {
  /** A built-in template identifier, or `custom` after the source is edited. */
  preset: OcrAdapterPresetId;
  /** Declarative TypeScript. The server parses this as data and never evaluates JavaScript. */
  source: string;
  endpoint: string;
  model: string;
  credentialConfigured: boolean;
  pollIntervalMs: number;
  pollTimeoutMs: number;
}

export interface AttachmentUnderstandingSettingsValue {
  routing: AttachmentUnderstandingRouting;
  engine: AttachmentUnderstandingEngine;
  ocrProvider: AttachmentUnderstandingOcrProvider;
  glm: {
    endpoint: string;
    model: string;
    credentialConfigured: boolean;
  };
  paddle: {
    endpoint: string;
    model: string;
    credentialConfigured: boolean;
    pollIntervalMs: number;
    pollTimeoutMs: number;
  };
  ocrAdapter: AttachmentUnderstandingOcrAdapterSettingsValue;
  multimodal: {
    provider: string;
    model: string;
  };
}

export interface AttachmentUnderstandingDescribeValue {
  revision: number;
  value: AttachmentUnderstandingSettingsValue;
}

export interface AttachmentUnderstandingSettingsPatch {
  routing?: AttachmentUnderstandingRouting;
  engine?: AttachmentUnderstandingEngine;
  ocrProvider?: AttachmentUnderstandingOcrProvider;
  glm?: {
    endpoint?: string;
    model?: string;
    /** Omit or use an empty string to retain the current secret; null removes it. */
    apiKey?: string | null;
  };
  paddle?: {
    endpoint?: string;
    model?: string;
    /** Omit or use an empty string to retain the current secret; null removes it. */
    apiKey?: string | null;
    pollIntervalMs?: number;
    pollTimeoutMs?: number;
  };
  ocrAdapter?: {
    preset?: OcrAdapterPresetId;
    source?: string;
    endpoint?: string;
    model?: string;
    /** Omit or use an empty string to retain the active adapter credential; null removes it. */
    apiKey?: string | null;
    pollIntervalMs?: number;
    pollTimeoutMs?: number;
  };
  multimodal?: {
    provider?: string;
    model?: string;
  };
}

export interface AttachmentUnderstandingUpdatePayload {
  patch: AttachmentUnderstandingSettingsPatch;
  expectedRevision?: number;
}
