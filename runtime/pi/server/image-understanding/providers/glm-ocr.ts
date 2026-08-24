import {
  ImageUnderstandingProviderError,
  type AttachmentRecognitionProvider,
  type AttachmentRecognitionRequest,
  type AttachmentUnderstandingObservation,
} from "../contracts";
import {
  attachmentDataUrl,
  boundedFetchText,
  parseJsonObject,
  requireHttpUrl,
  requirePositiveInteger,
  type ImageUnderstandingFetch,
} from "../http";

export const DEFAULT_GLM_OCR_ENDPOINT = "https://api.z.ai/api/paas/v4/layout_parsing";
export const DEFAULT_GLM_OCR_MODEL = "glm-ocr";

export interface GlmOcrProviderOptions {
  endpoint?: string;
  model?: string;
  fetch?: ImageUnderstandingFetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxObservationCharacters?: number;
}

const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_OBSERVATION_CHARACTERS = 250_000;
const GLM_OCR_ATTACHMENT_MEDIA_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function layoutText(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const text: string[] = [];
  for (const page of value) {
    if (!Array.isArray(page)) continue;
    for (const region of page) {
      if (isObject(region) && typeof region.content === "string" && region.content) {
        text.push(region.content);
      }
    }
  }
  return text.join("\n");
}

function normalizedResponse(payload: Record<string, unknown>): {
  format: "markdown" | "text";
  text: string;
} {
  if (typeof payload.md_results === "string") {
    return { format: "markdown", text: payload.md_results };
  }
  if (typeof payload.markdown_result === "string") {
    return { format: "markdown", text: payload.markdown_result };
  }
  const text = layoutText(payload.layout_details);
  if (text !== undefined) return { format: "text", text };
  throw new ImageUnderstandingProviderError("provider-invalid-response");
}

export class GlmOcrProvider implements AttachmentRecognitionProvider {
  readonly id = "glm-ocr" as const;
  readonly method = "ocr" as const;
  readonly endpoint: string;
  readonly model: string;
  private readonly fetch: ImageUnderstandingFetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly maxObservationCharacters: number;

  constructor(options: GlmOcrProviderOptions = {}) {
    this.endpoint = requireHttpUrl(options.endpoint ?? DEFAULT_GLM_OCR_ENDPOINT, "endpoint");
    this.model = options.model?.trim() || DEFAULT_GLM_OCR_MODEL;
    this.fetch = options.fetch ?? fetch;
    this.timeoutMs = requirePositiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs");
    this.maxResponseBytes = requirePositiveInteger(
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      "maxResponseBytes",
    );
    this.maxObservationCharacters = requirePositiveInteger(
      options.maxObservationCharacters ?? DEFAULT_MAX_OBSERVATION_CHARACTERS,
      "maxObservationCharacters",
    );
  }

  async recognize(
    request: AttachmentRecognitionRequest,
  ): Promise<AttachmentUnderstandingObservation[]> {
    if (
      !request.credential.trim() ||
      request.attachments.length === 0 ||
      request.attachments.some(
        (attachment) =>
          !attachment.id.trim() || !GLM_OCR_ATTACHMENT_MEDIA_TYPES.has(attachment.mimeType),
      )
    ) {
      throw new ImageUnderstandingProviderError("provider-invalid-input");
    }

    const observations: AttachmentUnderstandingObservation[] = [];
    let observationCharacters = 0;
    for (const attachment of request.attachments) {
      if (request.signal?.aborted) {
        throw new ImageUnderstandingProviderError("provider-aborted");
      }
      const responseText = await boundedFetchText({
        fetch: this.fetch,
        url: this.endpoint,
        signal: request.signal,
        timeoutMs: this.timeoutMs,
        maxResponseBytes: this.maxResponseBytes,
        init: {
          method: "POST",
          headers: {
            Authorization: `Bearer ${request.credential}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: this.model,
            file: attachmentDataUrl(attachment),
            return_crop_images: false,
            need_layout_visualization: false,
          }),
        },
      });
      const normalized = normalizedResponse(parseJsonObject(responseText));
      observationCharacters += normalized.text.length;
      if (observationCharacters > this.maxObservationCharacters) {
        throw new ImageUnderstandingProviderError("provider-response-too-large");
      }
      observations.push({
        attachmentId: attachment.id,
        kind: attachment.kind,
        sequence: attachment.sequence,
        providerId: this.id,
        method: this.method,
        ...normalized,
      });
    }
    return observations;
  }
}
