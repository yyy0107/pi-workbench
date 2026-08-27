import {
  parseOcrAdapterSource,
  type OcrAdapterApiEnvelopeV1,
  type OcrAdapterDefinitionV1,
  type OcrAdapterOutputV1,
  type OcrAdapterTemplateValue,
} from "../../../../shared/attachment-understanding/ocr-adapter";
import type {
  AttachmentRecognitionFailureDiagnostic,
  AttachmentRecognitionFailurePhase,
  AttachmentRecognitionResultSource,
} from "../../../../shared/attachment-understanding/state-machine";
import {
  ImageUnderstandingProviderError,
  type AttachmentRecognitionProvider,
  type AttachmentRecognitionRequest,
  type AttachmentUnderstandingObservation,
  type RecognizableAttachment,
} from "../contracts";
import {
  attachmentBytes,
  attachmentDataUrl,
  boundedAllowedHttpsText,
  boundedFetchText,
  boundedPublicHttpsText,
  matchesAllowedHttpsHostname,
  parseJsonObject,
  requireHttpsUrl,
  requirePositiveInteger,
  type ImageUnderstandingFetch,
  type PublicAddressResolver,
  type PublicHttpsTransport,
} from "../http";

export interface OcrAdapterProviderOptions {
  source?: string;
  definition?: OcrAdapterDefinitionV1;
  endpoint: string;
  model: string;
  fetch?: ImageUnderstandingFetch;
  requestTimeoutMs?: number;
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
  maxPollIntervalMs?: number;
  maxResponseBytes?: number;
  maxObservationCharacters?: number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  onSubmissionRetry?: (update: { attempt: number; delayMs: number }) => void | Promise<void>;
  onSubmitted?: () => void | Promise<void>;
  resultAddressResolver?: PublicAddressResolver;
  resultHttpsTransport?: PublicHttpsTransport;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;
const DEFAULT_POLL_TIMEOUT_MS = 600_000;
const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_MAX_POLL_INTERVAL_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_OBSERVATION_CHARACTERS = 250_000;
const NATIVE_RESULT_DOWNLOAD_HOST_SUFFIXES = ["bcebos.com"] as const;

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
    { retryable: !(error instanceof TypeError), diagnostic: failure },
  );
}

function valuesAtPath(root: unknown, path: string): unknown[] {
  let values: unknown[] = [root];
  for (const rawSegment of path.split(".")) {
    const name = rawSegment.replace(/(?:\[\])+$/g, "");
    const flattenCount = (rawSegment.length - name.length) / 2;
    values = values.flatMap((value) => (isObject(value) ? [value[name]] : []));
    for (let index = 0; index < flattenCount; index += 1) {
      values = values.flatMap((value) => (Array.isArray(value) ? value : []));
    }
  }
  return values.filter((value) => value !== undefined);
}

function scalarAtPath(root: unknown, path: string): unknown {
  return valuesAtPath(root, path)[0];
}

function comparable(value: unknown): string | number | undefined {
  return typeof value === "string" || (typeof value === "number" && Number.isSafeInteger(value))
    ? value
    : undefined;
}

function sameScalar(left: string | number, right: string | number): boolean {
  return left === right || String(left) === String(right);
}

function providerCode(value: unknown): string | undefined {
  const scalar = comparable(value);
  if (scalar === undefined) return undefined;
  const normalized = String(scalar).toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{0,127}$/iu.test(normalized) ? normalized : undefined;
}

function assertApiSuccess(
  payload: Record<string, unknown>,
  api: OcrAdapterApiEnvelopeV1 | undefined,
  phase: Extract<AttachmentRecognitionFailurePhase, "submission" | "polling">,
): void {
  if (!api) return;
  const rawCode = scalarAtPath(payload, api.codePath);
  if (rawCode === undefined) return;
  const code = comparable(rawCode);
  if (code === undefined) {
    throw new ImageUnderstandingProviderError("provider-invalid-response", {
      diagnostic: diagnostic(phase, "invalid-api-code"),
    });
  }
  if (api.successValues.some((candidate) => sameScalar(candidate, code))) return;
  const normalizedProviderCode = providerCode(code);
  const failure = diagnostic(
    phase,
    "api-error-code",
    normalizedProviderCode === undefined ? {} : { providerCode: normalizedProviderCode },
  );
  const mapping = api.errors.find((rule) =>
    rule.values.some((candidate) => sameScalar(candidate, code)),
  );
  throw new ImageUnderstandingProviderError(mapping?.errorCode ?? "provider-invalid-response", {
    retryable: mapping?.retryable ?? false,
    diagnostic: failure,
  });
}

function apiErrorResponse(
  api: OcrAdapterApiEnvelopeV1 | undefined,
  phase: Extract<AttachmentRecognitionFailurePhase, "submission" | "polling">,
): (response: { status: number; text: string }) => ImageUnderstandingProviderError | undefined {
  return (response) => {
    if (!api) return undefined;
    try {
      const payload = parseJsonObject(response.text);
      assertApiSuccess(payload, api, phase);
      return undefined;
    } catch (error) {
      if (!(error instanceof ImageUnderstandingProviderError)) return undefined;
      return annotateProviderError(error, {
        ...(error.diagnostic ?? diagnostic(phase, "api-error-code")),
        httpStatus: response.status,
      });
    }
  };
}

function replaceTemplate(
  value: OcrAdapterTemplateValue,
  attachment: RecognizableAttachment,
  model: string,
): OcrAdapterTemplateValue {
  if (value === "$model") return model;
  if (value === "$attachment.dataUrl") return attachmentDataUrl(attachment);
  if (value === "$attachment.base64") {
    const comma = attachment.data.indexOf(",");
    return attachment.data.startsWith("data:") && comma >= 0
      ? attachment.data.slice(comma + 1)
      : attachment.data;
  }
  if (value === "$attachment.name") return attachment.name ?? "";
  if (value === "$attachment.mimeType") return attachment.mimeType;
  if (Array.isArray(value)) return value.map((item) => replaceTemplate(item, attachment, model));
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        replaceTemplate(item as OcrAdapterTemplateValue, attachment, model),
      ]),
    );
  }
  return value;
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

function requestBody(
  definition: OcrAdapterDefinitionV1,
  attachment: RecognizableAttachment,
  index: number,
  model: string,
): { body: BodyInit; contentType?: string } {
  if (definition.request.kind === "json") {
    return {
      body: JSON.stringify(replaceTemplate(definition.request.body, attachment, model)),
      contentType: "application/json",
    };
  }
  const form = new FormData();
  for (const field of definition.request.fields) {
    const value = replaceTemplate(field.value, attachment, model);
    const encoded = field.encoding === "json" ? JSON.stringify(value) : String(value ?? "");
    form.append(field.name, encoded);
  }
  form.append(
    definition.request.fileField,
    blobForAttachment(attachment),
    safeFilename(attachment, index),
  );
  return { body: form };
}

function extractOutput(
  payload: unknown,
  output: OcrAdapterOutputV1,
): { format: "markdown" | "text"; text: string } | undefined {
  for (const rule of output.rules) {
    const text = valuesAtPath(payload, rule.path)
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim())
      .join("\n");
    if (text) return { format: rule.format, text };
  }
  return undefined;
}

function outputFromJsonl(
  text: string,
  output: OcrAdapterOutputV1,
): { format: "markdown" | "text"; text: string } {
  const normalized: Array<{ format: "markdown" | "text"; text: string }> = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const extracted = extractOutput(parseJsonObject(line), output);
    if (extracted) normalized.push(extracted);
  }
  if (normalized.length === 0) {
    throw new ImageUnderstandingProviderError("provider-invalid-response");
  }
  return {
    format: normalized.some((item) => item.format === "markdown") ? "markdown" : "text",
    text: normalized.map((item) => item.text).join("\n\n"),
  };
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
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export class OcrAdapterProvider implements AttachmentRecognitionProvider {
  readonly definition: OcrAdapterDefinitionV1;
  readonly id: string;
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
  private readonly sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  private readonly now: () => number;
  private readonly onSubmissionRetry?: OcrAdapterProviderOptions["onSubmissionRetry"];
  private readonly onSubmitted?: OcrAdapterProviderOptions["onSubmitted"];
  private readonly resultAddressResolver?: PublicAddressResolver;
  private readonly resultHttpsTransport?: PublicHttpsTransport;

  constructor(options: OcrAdapterProviderOptions) {
    if ((options.source === undefined) === (options.definition === undefined)) {
      throw new TypeError("Provide exactly one OCR adapter source or definition.");
    }
    this.definition = options.definition ?? parseOcrAdapterSource(options.source!);
    this.id = this.definition.id;
    this.endpoint = requireHttpsUrl(options.endpoint, "endpoint").replace(/\/$/, "");
    this.model = options.model.trim();
    if (!this.model) throw new TypeError("model must be a non-empty string.");
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
    this.sleep = options.sleep ?? abortableSleep;
    this.now = options.now ?? Date.now;
    this.onSubmissionRetry = options.onSubmissionRetry;
    this.onSubmitted = options.onSubmitted;
    this.resultAddressResolver = options.resultAddressResolver;
    this.resultHttpsTransport = options.resultHttpsTransport;
  }

  private headers(credential: string, contentType?: string): Record<string, string> {
    return {
      [this.definition.authentication.header]:
        `${this.definition.authentication.prefix}${credential}`,
      ...(contentType === undefined ? {} : { "Content-Type": contentType }),
    };
  }

  private parseApiPayload(
    text: string,
    phase: Extract<AttachmentRecognitionFailurePhase, "submission" | "polling">,
  ): Record<string, unknown> {
    let payload: Record<string, unknown>;
    try {
      payload = parseJsonObject(text);
    } catch (error) {
      throw annotateProviderError(error, diagnostic(phase, "invalid-json"));
    }
    assertApiSuccess(payload, this.definition.api, phase);
    return payload;
  }

  private async post(
    attachment: RecognizableAttachment,
    index: number,
    credential: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const request = requestBody(this.definition, attachment, index, this.model);
    let text: string;
    try {
      text = await boundedFetchText({
        fetch: this.fetch,
        url: this.endpoint,
        signal,
        timeoutMs: this.requestTimeoutMs,
        maxResponseBytes: this.maxResponseBytes,
        mapErrorResponse: apiErrorResponse(this.definition.api, "submission"),
        init: {
          method: "POST",
          headers: this.headers(credential, request.contentType),
          body: request.body,
        },
      });
    } catch (error) {
      throw annotateProviderError(error, diagnostic("submission", "request-failed"));
    }
    return this.parseApiPayload(text, "submission");
  }

  private async submitWithRetry(
    attachment: RecognizableAttachment,
    index: number,
    credential: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const retry = this.definition.retry ?? {
      maxAttempts: 1,
      initialDelayMs: 1_000,
      maxDelayMs: 1_000,
    };
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.post(attachment, index, credential, signal);
      } catch (error) {
        const retryable = error instanceof ImageUnderstandingProviderError && error.retryable;
        if (!retryable || attempt >= retry.maxAttempts || signal?.aborted) throw error;
        const delayMs = Math.min(
          retry.initialDelayMs * 2 ** Math.min(attempt - 1, 30),
          retry.maxDelayMs,
        );
        await this.onSubmissionRetry?.({ attempt: attempt + 1, delayMs });
        await this.sleep(delayMs, signal);
      }
    }
  }

  private pollUrl(jobId: string): string {
    const operation = this.definition.operation;
    if (operation.kind !== "async-job") throw new TypeError("adapter is not asynchronous.");
    return `${this.endpoint}${operation.pollPath.replace("{jobId}", encodeURIComponent(jobId))}`;
  }

  private async downloadResult(
    result: Record<string, unknown>,
    signal: AbortSignal | undefined,
    deadline: number,
  ): Promise<{ format: "markdown" | "text"; text: string }> {
    const operation = this.definition.operation;
    if (operation.kind !== "async-job") throw new TypeError("adapter is not asynchronous.");
    let lastError: unknown;
    for (const source of operation.resultSources) {
      const value = scalarAtPath(result, source.path);
      if (typeof value !== "string" || !value) continue;
      const remainingMs = deadline - this.now();
      if (remainingMs <= 0) {
        throw new ImageUnderstandingProviderError("provider-poll-timeout", { retryable: true });
      }
      const timeoutMs = Math.max(1, Math.min(this.requestTimeoutMs, remainingMs));
      let body: string;
      try {
        body = matchesAllowedHttpsHostname(value, NATIVE_RESULT_DOWNLOAD_HOST_SUFFIXES)
          ? await boundedAllowedHttpsText({
              fetch: this.fetch,
              url: value,
              field: source.path,
              allowedHostnameSuffixes: NATIVE_RESULT_DOWNLOAD_HOST_SUFFIXES,
              signal,
              timeoutMs,
              maxResponseBytes: this.maxResponseBytes,
              maxRedirects: 3,
            })
          : await boundedPublicHttpsText({
              url: value,
              field: source.path,
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
        lastError = annotateProviderError(
          error,
          diagnostic(
            "result-download",
            "download-failed",
            source.encoding === "jsonl"
              ? { resultSource: "jsonl" as const }
              : source.format === "markdown"
                ? { resultSource: "markdown" as const }
                : {},
          ),
        );
        continue;
      }
      try {
        if (source.encoding === "text") {
          if (!body.trim()) throw new ImageUnderstandingProviderError("provider-invalid-response");
          return { format: source.format ?? "text", text: body };
        }
        if (!source.output) throw new ImageUnderstandingProviderError("provider-invalid-response");
        return outputFromJsonl(body, source.output);
      } catch (error) {
        lastError = annotateProviderError(
          error,
          diagnostic(
            "result-parsing",
            "result-payload-invalid",
            source.encoding === "jsonl"
              ? { resultSource: "jsonl" }
              : source.format === "markdown"
                ? { resultSource: "markdown" }
                : {},
          ),
        );
      }
    }
    if (lastError instanceof ImageUnderstandingProviderError) throw lastError;
    throw new ImageUnderstandingProviderError("provider-invalid-response", {
      diagnostic: diagnostic("result-download", "missing-result-url"),
    });
  }

  private async waitForResult(
    jobId: string,
    credential: string,
    signal?: AbortSignal,
  ): Promise<{ format: "markdown" | "text"; text: string }> {
    const operation = this.definition.operation;
    if (operation.kind !== "async-job") throw new TypeError("adapter is not asynchronous.");
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
          url: this.pollUrl(jobId),
          signal,
          timeoutMs: Math.max(1, Math.min(this.requestTimeoutMs, remaining)),
          maxResponseBytes: this.maxResponseBytes,
          mapErrorResponse: apiErrorResponse(this.definition.api, "polling"),
          init: { method: "GET", headers: this.headers(credential) },
        });
      } catch (error) {
        throw annotateProviderError(error, diagnostic("polling", "request-failed"));
      }
      const payload = this.parseApiPayload(text, "polling");
      const state = scalarAtPath(payload, operation.statePath);
      if (typeof state !== "string") {
        throw new ImageUnderstandingProviderError("provider-invalid-response", {
          diagnostic: diagnostic("polling", "unexpected-job-state"),
        });
      }
      if (operation.failedStates.includes(state)) {
        throw new ImageUnderstandingProviderError("provider-job-failed", {
          diagnostic: diagnostic("polling", "job-failed"),
        });
      }
      if (operation.completedStates.includes(state)) {
        return this.downloadResult(payload, signal, deadline);
      }
      if (!operation.pendingStates.includes(state)) {
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
      request.attachments.some((attachment) => {
        const kind = attachment.mimeType === "application/pdf" ? "pdf" : "image";
        return (
          !attachment.id.trim() ||
          (!attachment.mimeType.startsWith("image/") && kind !== "pdf") ||
          !this.definition.accepts.includes(kind)
        );
      })
    ) {
      throw new ImageUnderstandingProviderError("provider-invalid-input");
    }

    const observations: AttachmentUnderstandingObservation[] = [];
    let observationCharacters = 0;
    for (const [index, attachment] of request.attachments.entries()) {
      if (request.signal?.aborted) throw new ImageUnderstandingProviderError("provider-aborted");
      const submitted = await this.submitWithRetry(
        attachment,
        index,
        request.credential,
        request.signal,
      );
      let normalized: { format: "markdown" | "text"; text: string };
      if (this.definition.operation.kind === "sync") {
        const extracted = extractOutput(submitted, this.definition.operation.output);
        if (!extracted) throw new ImageUnderstandingProviderError("provider-invalid-response");
        normalized = extracted;
      } else {
        const jobId = scalarAtPath(submitted, this.definition.operation.jobIdPath);
        if (typeof jobId !== "string" || !jobId) {
          throw new ImageUnderstandingProviderError("provider-invalid-response", {
            diagnostic: diagnostic("submission", "missing-job-id"),
          });
        }
        await this.onSubmitted?.();
        normalized = await this.waitForResult(jobId, request.credential, request.signal);
      }
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
