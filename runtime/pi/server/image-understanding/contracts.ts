import type { ImageRecognitionSnapshot } from "../../../image-understanding/state-machine";

export type ImageUnderstandingProviderId = "glm-ocr" | "paddleocr";
export type ImageUnderstandingPreprocessMethod = "ocr" | "multimodal";

export interface ImageUnderstandingInputImage {
  id: string;
  name?: string;
  mimeType: string;
  /** Canonical base64 or a base64 data URL. */
  data: string;
}

export interface ImageUnderstandingObservation {
  imageId: string;
  providerId: string;
  method: ImageUnderstandingPreprocessMethod;
  format: "markdown" | "text";
  text: string;
}

export type ImageRecognitionObserver = (snapshot: ImageRecognitionSnapshot) => void | Promise<void>;

export interface ImageUnderstandingRecognitionRequest {
  images: readonly ImageUnderstandingInputImage[];
  /** Resolved server-side credential. It must never be copied into status metadata. */
  credential: string;
  signal?: AbortSignal;
  /** Reserved for the session coordinator that owns the shared recognition FSM. */
  observer?: ImageRecognitionObserver;
}

export interface ImageUnderstandingProvider {
  readonly id: ImageUnderstandingProviderId;
  readonly method: ImageUnderstandingPreprocessMethod;
  recognize(
    request: ImageUnderstandingRecognitionRequest,
  ): Promise<ImageUnderstandingObservation[]>;
}

export type ImageUnderstandingProviderErrorCode =
  | "provider-aborted"
  | "provider-timeout"
  | "provider-poll-timeout"
  | "provider-response-too-large"
  | "provider-authentication-failed"
  | "provider-rate-limited"
  | "provider-unavailable"
  | "provider-invalid-response"
  | "provider-job-failed"
  | "provider-network-error"
  | "provider-invalid-input";

const PROVIDER_ERROR_MESSAGES = Object.freeze({
  "provider-aborted": "Image recognition was cancelled.",
  "provider-timeout": "The image recognition provider timed out.",
  "provider-poll-timeout": "The image recognition job did not finish in time.",
  "provider-response-too-large": "The image recognition provider response was too large.",
  "provider-authentication-failed": "The image recognition credential was rejected.",
  "provider-rate-limited": "The image recognition provider rate limit was reached.",
  "provider-unavailable": "The image recognition provider is unavailable.",
  "provider-invalid-response": "The image recognition provider returned an invalid response.",
  "provider-job-failed": "The image recognition job failed.",
  "provider-network-error": "The image recognition provider could not be reached.",
  "provider-invalid-input": "The image recognition input is invalid.",
}) satisfies Record<ImageUnderstandingProviderErrorCode, string>;

export class ImageUnderstandingProviderError extends Error {
  readonly code: ImageUnderstandingProviderErrorCode;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(
    code: ImageUnderstandingProviderErrorCode,
    options: { retryable?: boolean; status?: number } = {},
  ) {
    super(PROVIDER_ERROR_MESSAGES[code]);
    this.name = "ImageUnderstandingProviderError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
  }
}
