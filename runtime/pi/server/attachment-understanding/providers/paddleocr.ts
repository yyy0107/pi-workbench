import {
  ImageUnderstandingProviderError,
  type AttachmentRecognitionProvider,
  type AttachmentRecognitionRequest,
  type AttachmentUnderstandingObservation,
  type RecognizableAttachment,
} from "../contracts";
import {
  attachmentBytes,
  boundedAllowedHttpsText,
  boundedFetchText,
  boundedPublicHttpsText,
  matchesAllowedHttpsHostname,
  parseJsonObject,
  requireHttpUrl,
  requirePositiveInteger,
  type ImageUnderstandingFetch,
  type PublicAddressResolver,
  type PublicHttpsTransport,
} from "../http";
import {
  DEFAULT_PADDLE_AI_STUDIO_ASYNC_MODEL,
  PADDLE_AI_STUDIO_ASYNC_ENDPOINT,
} from "../../../../shared/attachment-understanding/paddleocr-models";
import type {
  AttachmentRecognitionFailureDiagnostic,
  AttachmentRecognitionFailurePhase,
  AttachmentRecognitionResultSource,
} from "../../../../shared/attachment-understanding/state-machine";

export const DEFAULT_PADDLE_OCR_ENDPOINT = PADDLE_AI_STUDIO_ASYNC_ENDPOINT;
export const DEFAULT_PADDLE_OCR_MODEL = DEFAULT_PADDLE_AI_STUDIO_ASYNC_MODEL;

export interface PaddleOcrProviderOptions {
  /** Complete jobs endpoint, including `/api/v2/ocr/jobs`. */
  endpoint?: string;
  model?: string;
  fetch?: ImageUnderstandingFetch;
  requestTimeoutMs?: number;
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
  maxPollIntervalMs?: number;
  maxSubmissionAttempts?: number;
  submissionRetryDelayMs?: number;
  maxSubmissionRetryDelayMs?: number;
  maxResponseBytes?: number;
  maxObservationCharacters?: number;
  optionalPayload?: Readonly<Record<string, unknown>>;
  clientPlatform?: string;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  /** Reports another bounded submission attempt without exposing the upstream response. */
  onSubmissionRetry?: (update: { attempt: number; delayMs: number }) => void | Promise<void>;
  /** Reports that Paddle accepted the job and polling is about to begin. */
  onSubmitted?: () => void | Promise<void>;
  /** Test seam for provider-controlled result URLs. Production callers leave this unset. */
  resultAddressResolver?: PublicAddressResolver;
  /** Test seam for provider-controlled result URLs. Production callers leave this unset. */
  resultHttpsTransport?: PublicHttpsTransport;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;
const DEFAULT_POLL_TIMEOUT_MS = 600_000;
const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_MAX_POLL_INTERVAL_MS = 15_000;
const DEFAULT_MAX_SUBMISSION_ATTEMPTS = 4;
const DEFAULT_SUBMISSION_RETRY_DELAY_MS = 3_000;
const DEFAULT_MAX_SUBMISSION_RETRY_DELAY_MS = 12_000;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_OBSERVATION_CHARACTERS = 250_000;
const PADDLE_BOS_RESULT_HOST_SUFFIXES = ["bcebos.com"] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function diagnostic(
  phase: AttachmentRecognitionFailurePhase,
  reason: string,
  details: {
    httpStatus?: number;
    providerCode?: string;
    resultSource?: AttachmentRecognitionResultSource;
  } = {},
): AttachmentRecognitionFailureDiagnostic {
  return { phase, reason, ...details };
}

function paddleProviderCode(value: unknown): string | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? String(value)
    : typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,127}$/iu.test(value)
      ? value.toLowerCase()
      : undefined;
}

function annotateProviderError(
  error: unknown,
  failure: AttachmentRecognitionFailureDiagnostic,
): ImageUnderstandingProviderError {
  if (error instanceof ImageUnderstandingProviderError) {
    return new ImageUnderstandingProviderError(error.code, {
      retryable: error.retryable,
      ...(error.status === undefined ? {} : { status: error.status }),
      diagnostic: {
        ...failure,
        ...error.diagnostic,
        ...(error.status === undefined ? {} : { httpStatus: error.status }),
      },
    });
  }
  return new ImageUnderstandingProviderError(
    error instanceof TypeError ? "provider-invalid-response" : "provider-network-error",
    {
      retryable: !(error instanceof TypeError),
      diagnostic: failure,
    },
  );
}

function apiData(
  text: string,
  phase: Extract<AttachmentRecognitionFailurePhase, "submission" | "polling">,
): Record<string, unknown> {
  let payload: Record<string, unknown>;
  try {
    payload = parseJsonObject(text);
  } catch (error) {
    throw annotateProviderError(error, diagnostic(phase, "invalid-json"));
  }
  if (payload.code !== undefined && payload.code !== 0) {
    const providerCode = paddleProviderCode(payload.code);
    const failure = diagnostic(
      phase,
      "api-error-code",
      providerCode === undefined ? {} : { providerCode },
    );
    switch (payload.code) {
      case 401:
        throw new ImageUnderstandingProviderError("provider-authentication-failed", {
          diagnostic: failure,
        });
      case 500:
        throw new ImageUnderstandingProviderError("provider-unavailable", {
          retryable: true,
          diagnostic: failure,
        });
      case 10_001:
      case 10_002:
      case 10_003:
      case 10_004:
      case 10_005:
      case 10_006:
        throw new ImageUnderstandingProviderError("provider-invalid-input", {
          diagnostic: failure,
        });
      case 10_007:
      case 10_008:
        throw new ImageUnderstandingProviderError("provider-configuration-invalid", {
          diagnostic: failure,
        });
      case 12_001:
        throw new ImageUnderstandingProviderError("provider-rate-limited", {
          diagnostic: failure,
        });
      case 10_010:
      case 12_002:
        throw new ImageUnderstandingProviderError("provider-rate-limited", {
          retryable: true,
          diagnostic: failure,
        });
      case 11_003:
        throw new ImageUnderstandingProviderError("provider-job-failed", {
          diagnostic: failure,
        });
      default:
        throw new ImageUnderstandingProviderError("provider-invalid-response", {
          diagnostic: failure,
        });
    }
  }
  if (!isObject(payload.data)) {
    throw new ImageUnderstandingProviderError("provider-invalid-response", {
      diagnostic: diagnostic(phase, "missing-data"),
    });
  }
  return payload.data;
}

function paddleApiErrorResponse(
  phase: Extract<AttachmentRecognitionFailurePhase, "submission" | "polling">,
): (response: { status: number; text: string }) => ImageUnderstandingProviderError | undefined {
  return (response) => {
    let payload: Record<string, unknown>;
    try {
      payload = parseJsonObject(response.text);
    } catch {
      return undefined;
    }
    if (payload.code === undefined || payload.code === 0) return undefined;
    try {
      apiData(response.text, phase);
    } catch (error) {
      if (!(error instanceof ImageUnderstandingProviderError)) return undefined;
      return annotateProviderError(error, {
        ...(error.diagnostic ?? diagnostic(phase, "api-error-code")),
        httpStatus: response.status,
      });
    }
    return undefined;
  };
}

function safeFilename(attachment: RecognizableAttachment, index: number): string {
  const candidate = attachment.name
    ?.split(/[\\/]/)
    .at(-1)
    ?.replace(/[^A-Za-z0-9._-]/g, "_");
  if (candidate && candidate.length <= 180) return candidate;
  const extension =
    attachment.mimeType === "application/pdf"
      ? "pdf"
      : attachment.mimeType === "image/png"
        ? "png"
        : attachment.mimeType === "image/webp"
          ? "webp"
          : attachment.mimeType === "image/gif"
            ? "gif"
            : "jpg";
  return `attachment-${index + 1}.${extension}`;
}

function blobForAttachment(attachment: RecognizableAttachment): Blob {
  const bytes = attachmentBytes(attachment);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type: attachment.mimeType });
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

export class PaddleOcrProvider implements AttachmentRecognitionProvider {
  readonly id = "paddleocr" as const;
  readonly method = "ocr" as const;
  readonly endpoint: string;
  readonly model: string;
  private readonly fetch: ImageUnderstandingFetch;
  private readonly requestTimeoutMs: number;
  private readonly pollTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly maxPollIntervalMs: number;
  private readonly maxSubmissionAttempts: number;
  private readonly submissionRetryDelayMs: number;
  private readonly maxSubmissionRetryDelayMs: number;
  private readonly maxResponseBytes: number;
  private readonly maxObservationCharacters: number;
  private readonly optionalPayload: Readonly<Record<string, unknown>>;
  private readonly clientPlatform?: string;
  private readonly sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  private readonly now: () => number;
  private readonly onSubmissionRetry?: PaddleOcrProviderOptions["onSubmissionRetry"];
  private readonly onSubmitted?: PaddleOcrProviderOptions["onSubmitted"];
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
    this.maxSubmissionAttempts = requirePositiveInteger(
      options.maxSubmissionAttempts ?? DEFAULT_MAX_SUBMISSION_ATTEMPTS,
      "maxSubmissionAttempts",
    );
    if (this.maxSubmissionAttempts > 10) {
      throw new TypeError("maxSubmissionAttempts must not exceed 10.");
    }
    this.submissionRetryDelayMs = requirePositiveInteger(
      options.submissionRetryDelayMs ?? DEFAULT_SUBMISSION_RETRY_DELAY_MS,
      "submissionRetryDelayMs",
    );
    this.maxSubmissionRetryDelayMs = requirePositiveInteger(
      options.maxSubmissionRetryDelayMs ?? DEFAULT_MAX_SUBMISSION_RETRY_DELAY_MS,
      "maxSubmissionRetryDelayMs",
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
          }
        : {
            useDocOrientationClassify: false,
            useDocUnwarping: false,
            useChartRecognition: false,
          });
    this.clientPlatform = options.clientPlatform;
    this.sleep = options.sleep ?? abortableSleep;
    this.now = options.now ?? Date.now;
    this.onSubmissionRetry = options.onSubmissionRetry;
    this.onSubmitted = options.onSubmitted;
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
    attachment: RecognizableAttachment,
    attachmentIndex: number,
    credential: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const form = new FormData();
    form.append("model", this.model);
    form.append("optionalPayload", JSON.stringify(this.optionalPayload));
    form.append("file", blobForAttachment(attachment), safeFilename(attachment, attachmentIndex));
    let responseText: string;
    try {
      responseText = await boundedFetchText({
        fetch: this.fetch,
        url: this.endpoint,
        signal,
        timeoutMs: this.requestTimeoutMs,
        maxResponseBytes: this.maxResponseBytes,
        mapErrorResponse: paddleApiErrorResponse("submission"),
        init: { method: "POST", headers: this.headers(credential), body: form },
      });
    } catch (error) {
      throw annotateProviderError(error, diagnostic("submission", "request-failed"));
    }
    const data = apiData(responseText, "submission");
    if (typeof data.jobId !== "string" || !data.jobId) {
      throw new ImageUnderstandingProviderError("provider-invalid-response", {
        diagnostic: diagnostic("submission", "missing-job-id"),
      });
    }
    return data.jobId;
  }

  private async submitWithRetry(
    attachment: RecognizableAttachment,
    attachmentIndex: number,
    credential: string,
    signal?: AbortSignal,
  ): Promise<string> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.submit(attachment, attachmentIndex, credential, signal);
      } catch (error) {
        const retryable =
          error instanceof ImageUnderstandingProviderError &&
          error.retryable &&
          (error.code === "provider-rate-limited" || error.code === "provider-unavailable");
        if (!retryable || attempt >= this.maxSubmissionAttempts || signal?.aborted) throw error;
        const delayMs = Math.min(
          this.submissionRetryDelayMs * 2 ** Math.min(attempt - 1, 30),
          this.maxSubmissionRetryDelayMs,
        );
        await this.onSubmissionRetry?.({ attempt: attempt + 1, delayMs });
        await this.sleep(delayMs, signal);
      }
    }
  }

  private async fetchResult(
    resultUrl: Record<string, unknown>,
    signal: AbortSignal | undefined,
    deadline: number,
  ): Promise<{ format: "markdown" | "text"; text: string }> {
    const candidates = [
      typeof resultUrl.jsonUrl === "string" && resultUrl.jsonUrl
        ? { field: "resultUrl.jsonUrl", format: "jsonl" as const, url: resultUrl.jsonUrl }
        : undefined,
      typeof resultUrl.markdownUrl === "string" && resultUrl.markdownUrl
        ? {
            field: "resultUrl.markdownUrl",
            format: "markdown" as const,
            url: resultUrl.markdownUrl,
          }
        : undefined,
    ].filter((candidate) => candidate !== undefined);
    if (candidates.length === 0) {
      throw new ImageUnderstandingProviderError("provider-invalid-response", {
        diagnostic: diagnostic("result-download", "missing-result-url"),
      });
    }

    let lastError: unknown;
    for (const candidate of candidates) {
      const remainingMs = deadline - this.now();
      if (remainingMs <= 0) {
        throw new ImageUnderstandingProviderError("provider-poll-timeout", { retryable: true });
      }
      const timeoutMs = Math.max(1, Math.min(this.requestTimeoutMs, remainingMs));
      let body: string;
      try {
        body = matchesAllowedHttpsHostname(candidate.url, PADDLE_BOS_RESULT_HOST_SUFFIXES)
          ? await boundedAllowedHttpsText({
              fetch: this.fetch,
              url: candidate.url,
              field: candidate.field,
              allowedHostnameSuffixes: PADDLE_BOS_RESULT_HOST_SUFFIXES,
              signal,
              timeoutMs,
              maxResponseBytes: this.maxResponseBytes,
              maxRedirects: 3,
            })
          : await boundedPublicHttpsText({
              url: candidate.url,
              field: candidate.field,
              signal,
              timeoutMs,
              maxResponseBytes: this.maxResponseBytes,
              maxRedirects: 3,
              resolver: this.resultAddressResolver,
              transport: this.resultHttpsTransport,
            });
      } catch (error) {
        if (
          signal?.aborted ||
          (error instanceof ImageUnderstandingProviderError && error.code === "provider-aborted")
        ) {
          throw new ImageUnderstandingProviderError("provider-aborted");
        }
        if (
          error instanceof ImageUnderstandingProviderError &&
          error.code === "provider-timeout" &&
          timeoutMs === remainingMs
        ) {
          throw new ImageUnderstandingProviderError("provider-poll-timeout", { retryable: true });
        }
        lastError = annotateProviderError(
          error,
          diagnostic("result-download", "download-failed", {
            resultSource: candidate.format,
          }),
        );
        continue;
      }
      try {
        return candidate.format === "jsonl"
          ? textFromJsonl(body)
          : { format: "markdown", text: body };
      } catch (error) {
        lastError = annotateProviderError(
          error,
          diagnostic("result-parsing", "result-payload-invalid", {
            resultSource: candidate.format,
          }),
        );
      }
    }

    if (lastError instanceof ImageUnderstandingProviderError) throw lastError;
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
          mapErrorResponse: paddleApiErrorResponse("polling"),
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
        throw annotateProviderError(error, diagnostic("polling", "request-failed"));
      }
      const data = apiData(text, "polling");
      if (data.state === "failed") {
        throw new ImageUnderstandingProviderError("provider-job-failed", {
          diagnostic: diagnostic("polling", "job-failed"),
        });
      }
      if (data.state === "done") {
        if (!isObject(data.resultUrl)) {
          throw new ImageUnderstandingProviderError("provider-invalid-response", {
            diagnostic: diagnostic("result-download", "missing-result-url"),
          });
        }
        return this.fetchResult(data.resultUrl, signal, deadline);
      }
      if (data.state !== "pending" && data.state !== "running") {
        throw new ImageUnderstandingProviderError("provider-invalid-response", {
          diagnostic: diagnostic("polling", "unexpected-job-state"),
        });
      }
      const sleepMs = Math.min(interval, Math.max(0, deadline - this.now()));
      await this.sleep(sleepMs, signal);
      interval = Math.min(Math.ceil(interval * 1.5), this.maxPollIntervalMs);
    }
  }

  async recognize(
    request: AttachmentRecognitionRequest,
  ): Promise<AttachmentUnderstandingObservation[]> {
    if (
      !request.credential.trim() ||
      request.attachments.length === 0 ||
      request.attachments.some(
        (attachment) =>
          !attachment.id.trim() ||
          (!attachment.mimeType.startsWith("image/") && attachment.mimeType !== "application/pdf"),
      )
    ) {
      throw new ImageUnderstandingProviderError("provider-invalid-input");
    }
    const observations: AttachmentUnderstandingObservation[] = [];
    let observationCharacters = 0;
    for (const [index, attachment] of request.attachments.entries()) {
      const jobId = await this.submitWithRetry(
        attachment,
        index,
        request.credential,
        request.signal,
      );
      await this.onSubmitted?.();
      const normalized = await this.waitForResult(jobId, request.credential, request.signal);
      observationCharacters += normalized.text.length;
      if (observationCharacters > this.maxObservationCharacters) {
        throw new ImageUnderstandingProviderError("provider-response-too-large", {
          diagnostic: diagnostic("normalizing", "output-too-large"),
        });
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
