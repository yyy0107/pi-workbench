import type {
  AttachmentRecognitionFailureDiagnostic,
  AttachmentRecognitionSnapshot,
  AttachmentReferenceKind,
} from "@workbench/attachment-understanding-contracts/state-machine";

/** Adapter-defined stable identifier. Built-in legacy providers use `glm-ocr` and `paddleocr`. */
export type ImageUnderstandingProviderId = string;
export type ImageUnderstandingPreprocessMethod = "ocr" | "multimodal";

export interface RecognizableAttachment {
  id: string;
  /** Stable type-local reference used in both display and model context. */
  kind: AttachmentReferenceKind;
  /** One-based sequence within `kind` (for example, image 2 or PDF 1). */
  sequence: number;
  name?: string;
  mimeType: string;
  /** Canonical base64 or a base64 data URL. */
  data: string;
}

export interface AttachmentUnderstandingObservation {
  attachmentId: string;
  kind: AttachmentReferenceKind;
  sequence: number;
  providerId: string;
  method: ImageUnderstandingPreprocessMethod;
  format: "markdown" | "text";
  text: string;
}

export interface CachedAttachmentUnderstandingObservation extends AttachmentUnderstandingObservation {
  /** Absolute path to the complete normalized result, written before publishing success. */
  resultPath: string;
}

export type AttachmentRecognitionObserver = (
  snapshot: AttachmentRecognitionSnapshot,
) => void | Promise<void>;

export interface AttachmentRecognitionRequest {
  attachments: readonly RecognizableAttachment[];
  /** Resolved server-side credential. It must never be copied into status metadata. */
  credential: string;
  signal?: AbortSignal;
  /** Reserved for the session coordinator that owns the shared recognition FSM. */
  observer?: AttachmentRecognitionObserver;
}

export interface AttachmentRecognitionProvider {
  readonly id: ImageUnderstandingProviderId;
  readonly method: ImageUnderstandingPreprocessMethod;
  recognize(request: AttachmentRecognitionRequest): Promise<AttachmentUnderstandingObservation[]>;
}

export type ImageUnderstandingProviderErrorCode =
  | "result-cache-write-failed"
  | "provider-aborted"
  | "provider-timeout"
  | "provider-poll-timeout"
  | "provider-response-too-large"
  | "provider-authentication-failed"
  | "provider-configuration-invalid"
  | "provider-rate-limited"
  | "provider-unavailable"
  | "provider-invalid-response"
  | "provider-job-failed"
  | "provider-network-error"
  | "provider-invalid-input";

const PROVIDER_ERROR_MESSAGES = Object.freeze({
  "result-cache-write-failed":
    "The attachment recognition result could not be saved to the cache directory.",
  "provider-aborted": "Attachment recognition was cancelled.",
  "provider-timeout": "The attachment recognition provider timed out.",
  "provider-poll-timeout": "The attachment recognition job did not finish in time.",
  "provider-response-too-large": "The attachment recognition provider response was too large.",
  "provider-authentication-failed": "The attachment recognition credential was rejected.",
  "provider-configuration-invalid": "The attachment recognition provider configuration is invalid.",
  "provider-rate-limited": "The attachment recognition provider rate limit was reached.",
  "provider-unavailable": "The attachment recognition provider is unavailable.",
  "provider-invalid-response": "The attachment recognition provider returned an invalid response.",
  "provider-job-failed": "The attachment recognition job failed.",
  "provider-network-error": "The attachment recognition provider could not be reached.",
  "provider-invalid-input": "The attachment recognition input is invalid.",
}) satisfies Record<ImageUnderstandingProviderErrorCode, string>;

export class ImageUnderstandingProviderError extends Error {
  readonly code: ImageUnderstandingProviderErrorCode;
  readonly retryable: boolean;
  readonly status?: number;
  readonly diagnostic?: AttachmentRecognitionFailureDiagnostic;

  constructor(
    code: ImageUnderstandingProviderErrorCode,
    options: {
      retryable?: boolean;
      status?: number;
      diagnostic?: AttachmentRecognitionFailureDiagnostic;
    } = {},
  ) {
    super(PROVIDER_ERROR_MESSAGES[code]);
    this.name = "ImageUnderstandingProviderError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
    this.diagnostic = options.diagnostic;
  }
}
