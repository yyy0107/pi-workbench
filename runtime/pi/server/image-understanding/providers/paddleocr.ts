import {
  ImageUnderstandingProviderError,
  type ImageUnderstandingInputImage,
  type ImageUnderstandingObservation,
  type ImageUnderstandingProvider,
  type ImageUnderstandingRecognitionRequest,
} from "../contracts";
import {
  boundedFetchText,
  boundedPublicHttpsText,
  imageBytes,
  parseJsonObject,
  requireHttpUrl,
  requirePositiveInteger,
  type ImageUnderstandingFetch,
  type PublicAddressResolver,
  type PublicHttpsTransport,
} from "../http";

export const DEFAULT_PADDLE_OCR_ENDPOINT = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs";
export const DEFAULT_PADDLE_OCR_MODEL = "PaddleOCR-VL-1.5";

export interface PaddleOcrProviderOptions {
  /** Complete jobs endpoint, including `/api/v2/ocr/jobs`. */
  endpoint?: string;
  model?: string;
  fetch?: ImageUnderstandingFetch;
  requestTimeoutMs?: number;
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
  maxPollIntervalMs?: number;
  maxResponseBytes?: number;
  maxObservationCharacters?: number;
  optionalPayload?: Readonly<Record<string, unknown>>;
  clientPlatform?: string;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  /** Test seam for provider-controlled result URLs. Production callers leave this unset. */
  resultAddressResolver?: PublicAddressResolver;
  /** Test seam for provider-controlled result URLs. Production callers leave this unset. */
  resultHttpsTransport?: PublicHttpsTransport;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;
const DEFAULT_POLL_TIMEOUT_MS = 600_000;
const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_MAX_POLL_INTERVAL_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_OBSERVATION_CHARACTERS = 250_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function apiData(text: string): Record<string, unknown> {
  const payload = parseJsonObject(text);
  if (payload.code !== undefined && payload.code !== 0) {
    if (payload.code === 10010) {
      throw new ImageUnderstandingProviderError("provider-rate-limited", { retryable: true });
    }
    throw new ImageUnderstandingProviderError("provider-invalid-response");
  }
  if (!isObject(payload.data)) {
    throw new ImageUnderstandingProviderError("provider-invalid-response");
  }
  return payload.data;
}

function safeFilename(image: ImageUnderstandingInputImage, index: number): string {
  const candidate = image.name
    ?.split(/[\\/]/)
    .at(-1)
    ?.replace(/[^A-Za-z0-9._-]/g, "_");
  if (candidate && candidate.length <= 180) return candidate;
  const extension =
    image.mimeType === "image/png"
      ? "png"
      : image.mimeType === "image/webp"
        ? "webp"
        : image.mimeType === "image/gif"
          ? "gif"
          : "jpg";
  return `image-${index + 1}.${extension}`;
}

function blobForImage(image: ImageUnderstandingInputImage): Blob {
  const bytes = imageBytes(image);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type: image.mimeType });
}

function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new ImageUnderstandingProviderError("provider-aborted"));
  }
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new ImageUnderstandingProviderError("provider-aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    if (!signal) return;
    signal.addEventListener("abort", abort, { once: true });
  });
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function textFromPrunedResult(value: unknown): string[] {
  if (!isObject(value)) return [];
  const recognized = strings(value.rec_texts);
  if (recognized.length > 0) return recognized;
  if (Array.isArray(value.blocks)) {
    return value.blocks.flatMap((block) =>
      isObject(block) && typeof block.content === "string" ? [block.content] : [],
    );
  }
  return [];
}

function textFromJsonl(text: string): { format: "markdown" | "text"; text: string } {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    throw new ImageUnderstandingProviderError("provider-invalid-response");
  }

  const markdown: string[] = [];
  const recognized: string[] = [];
  let recognizedShape = false;
  for (const line of lines) {
    const item = parseJsonObject(line);
    if (!isObject(item.result)) {
      throw new ImageUnderstandingProviderError("provider-invalid-response");
    }
    if (Array.isArray(item.result.layoutParsingResults)) {
      recognizedShape = true;
      for (const page of item.result.layoutParsingResults) {
        if (isObject(page) && isObject(page.markdown) && typeof page.markdown.text === "string") {
          markdown.push(page.markdown.text);
        }
      }
    }
    if (Array.isArray(item.result.ocrResults)) {
      recognizedShape = true;
      for (const page of item.result.ocrResults) {
        if (isObject(page)) recognized.push(...textFromPrunedResult(page.prunedResult));
      }
    }
  }
  if (!recognizedShape) {
    throw new ImageUnderstandingProviderError("provider-invalid-response");
  }
  if (markdown.length > 0) return { format: "markdown", text: markdown.join("\n\n") };
  return { format: "text", text: recognized.join("\n") };
}

export class PaddleOcrProvider implements ImageUnderstandingProvider {
  readonly id = "paddleocr" as const;
  readonly method = "ocr" as const;
  readonly endpoint: string;
  readonly model: string;
  private readonly fetch: ImageUnderstandingFetch;
  private readonly requestTimeoutMs: number;
  private readonly pollTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly maxPollIntervalMs: number;
  private readonly maxResponseBytes: number;
  private readonly maxObservationCharacters: number;
  private readonly optionalPayload: Readonly<Record<string, unknown>>;
  private readonly clientPlatform?: string;
  private readonly sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  private readonly now: () => number;
  private readonly resultAddressResolver?: PublicAddressResolver;
  private readonly resultHttpsTransport?: PublicHttpsTransport;

  constructor(options: PaddleOcrProviderOptions = {}) {
    this.endpoint = requireHttpUrl(
      options.endpoint ?? DEFAULT_PADDLE_OCR_ENDPOINT,
      "endpoint",
    ).replace(/\/$/, "");
    this.model = options.model?.trim() || DEFAULT_PADDLE_OCR_MODEL;
    this.fetch = options.fetch ?? fetch;
    this.requestTimeoutMs = requirePositiveInteger(
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      "requestTimeoutMs",
    );
    this.pollTimeoutMs = requirePositiveInteger(
      options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS,
      "pollTimeoutMs",
    );
    this.pollIntervalMs = requirePositiveInteger(
      options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      "pollIntervalMs",
    );
    this.maxPollIntervalMs = requirePositiveInteger(
      options.maxPollIntervalMs ?? DEFAULT_MAX_POLL_INTERVAL_MS,
      "maxPollIntervalMs",
    );
    this.maxResponseBytes = requirePositiveInteger(
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      "maxResponseBytes",
    );
    this.maxObservationCharacters = requirePositiveInteger(
      options.maxObservationCharacters ?? DEFAULT_MAX_OBSERVATION_CHARACTERS,
      "maxObservationCharacters",
    );
    this.optionalPayload =
      options.optionalPayload ??
      (this.model.startsWith("PP-OCR")
        ? {
            useDocOrientationClassify: false,
            useDocUnwarping: false,
            useTextlineOrientation: false,
            visualize: false,
          }
        : {
            useDocOrientationClassify: false,
            useDocUnwarping: false,
            useChartRecognition: false,
            visualize: false,
          });
    this.clientPlatform = options.clientPlatform;
    this.sleep = options.sleep ?? abortableSleep;
    this.now = options.now ?? Date.now;
    this.resultAddressResolver = options.resultAddressResolver;
    this.resultHttpsTransport = options.resultHttpsTransport;
  }

  private headers(credential: string): Record<string, string> {
    return {
      Authorization: `Bearer ${credential}`,
      ...(this.clientPlatform ? { "Client-Platform": this.clientPlatform } : {}),
    };
  }

  private async submit(
    image: ImageUnderstandingInputImage,
    imageIndex: number,
    credential: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const form = new FormData();
    form.append("model", this.model);
    form.append("optionalPayload", JSON.stringify(this.optionalPayload));
    form.append("file", blobForImage(image), safeFilename(image, imageIndex));
    const data = apiData(
      await boundedFetchText({
        fetch: this.fetch,
        url: this.endpoint,
        signal,
        timeoutMs: this.requestTimeoutMs,
        maxResponseBytes: this.maxResponseBytes,
        init: { method: "POST", headers: this.headers(credential), body: form },
      }),
    );
    if (typeof data.jobId !== "string" || !data.jobId) {
      throw new ImageUnderstandingProviderError("provider-invalid-response");
    }
    return data.jobId;
  }

  private async fetchResult(
    resultUrl: Record<string, unknown>,
    signal: AbortSignal | undefined,
    remainingMs: number,
  ): Promise<{ format: "markdown" | "text"; text: string }> {
    if (remainingMs <= 0) {
      throw new ImageUnderstandingProviderError("provider-poll-timeout", { retryable: true });
    }
    const timeoutMs = Math.max(1, Math.min(this.requestTimeoutMs, remainingMs));
    try {
      if (typeof resultUrl.markdownUrl === "string" && resultUrl.markdownUrl) {
        const markdown = await boundedPublicHttpsText({
          url: resultUrl.markdownUrl,
          field: "resultUrl.markdownUrl",
          signal,
          timeoutMs,
          maxResponseBytes: this.maxResponseBytes,
          resolver: this.resultAddressResolver,
          transport: this.resultHttpsTransport,
        });
        return { format: "markdown", text: markdown };
      }
      if (typeof resultUrl.jsonUrl === "string" && resultUrl.jsonUrl) {
        const jsonl = await boundedPublicHttpsText({
          url: resultUrl.jsonUrl,
          field: "resultUrl.jsonUrl",
          signal,
          timeoutMs,
          maxResponseBytes: this.maxResponseBytes,
          resolver: this.resultAddressResolver,
          transport: this.resultHttpsTransport,
        });
        return textFromJsonl(jsonl);
      }
    } catch (error) {
      if (error instanceof TypeError) {
        throw new ImageUnderstandingProviderError("provider-invalid-response");
      }
      if (
        error instanceof ImageUnderstandingProviderError &&
        error.code === "provider-timeout" &&
        timeoutMs === remainingMs
      ) {
        throw new ImageUnderstandingProviderError("provider-poll-timeout", { retryable: true });
      }
      throw error;
    }
    throw new ImageUnderstandingProviderError("provider-invalid-response");
  }

  private async waitForResult(
    jobId: string,
    credential: string,
    signal?: AbortSignal,
  ): Promise<{ format: "markdown" | "text"; text: string }> {
    const deadline = this.now() + this.pollTimeoutMs;
    let interval = this.pollIntervalMs;
    for (;;) {
      if (signal?.aborted) throw new ImageUnderstandingProviderError("provider-aborted");
      const remaining = deadline - this.now();
      if (remaining <= 0) {
        throw new ImageUnderstandingProviderError("provider-poll-timeout", { retryable: true });
      }
      let text: string;
      try {
        text = await boundedFetchText({
          fetch: this.fetch,
          url: `${this.endpoint}/${encodeURIComponent(jobId)}`,
          signal,
          timeoutMs: Math.max(1, Math.min(this.requestTimeoutMs, remaining)),
          maxResponseBytes: this.maxResponseBytes,
          init: { method: "GET", headers: this.headers(credential) },
        });
      } catch (error) {
        if (
          error instanceof ImageUnderstandingProviderError &&
          error.code === "provider-timeout" &&
          this.now() >= deadline
        ) {
          throw new ImageUnderstandingProviderError("provider-poll-timeout", { retryable: true });
        }
        throw error;
      }
      const data = apiData(text);
      if (data.state === "failed") {
        throw new ImageUnderstandingProviderError("provider-job-failed");
      }
      if (data.state === "done") {
        if (!isObject(data.resultUrl)) {
          throw new ImageUnderstandingProviderError("provider-invalid-response");
        }
        return this.fetchResult(data.resultUrl, signal, deadline - this.now());
      }
      if (data.state !== "pending" && data.state !== "running") {
        throw new ImageUnderstandingProviderError("provider-invalid-response");
      }
      const sleepMs = Math.min(interval, Math.max(0, deadline - this.now()));
      await this.sleep(sleepMs, signal);
      interval = Math.min(Math.ceil(interval * 1.5), this.maxPollIntervalMs);
    }
  }

  async recognize(
    request: ImageUnderstandingRecognitionRequest,
  ): Promise<ImageUnderstandingObservation[]> {
    if (
      !request.credential.trim() ||
      request.images.length === 0 ||
      request.images.some((image) => !image.id.trim())
    ) {
      throw new ImageUnderstandingProviderError("provider-invalid-input");
    }
    const observations: ImageUnderstandingObservation[] = [];
    let observationCharacters = 0;
    for (const [index, image] of request.images.entries()) {
      const jobId = await this.submit(image, index, request.credential, request.signal);
      const normalized = await this.waitForResult(jobId, request.credential, request.signal);
      observationCharacters += normalized.text.length;
      if (observationCharacters > this.maxObservationCharacters) {
        throw new ImageUnderstandingProviderError("provider-response-too-large");
      }
      observations.push({
        imageId: image.id,
        providerId: this.id,
        method: this.method,
        ...normalized,
      });
    }
    return observations;
  }
}
