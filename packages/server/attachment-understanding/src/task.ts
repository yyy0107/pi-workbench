import {
  isTerminalAttachmentRecognitionSnapshot,
  type AttachmentRecognitionJob,
} from "@workbench/attachment-understanding-contracts/state-machine";
import {
  ImageUnderstandingProviderError,
  type RecognizableAttachment,
  type AttachmentUnderstandingObservation,
  type CachedAttachmentUnderstandingObservation,
} from "./contracts";
import { decideAttachmentUnderstandingRoute } from "./coordinator";
import { projectAttachmentRecognitionResults } from "./display-results";
import {
  AttachmentRecognitionLifecycle,
  type AttachmentRecognitionLifecycleOptions,
} from "./lifecycle";
import { OcrAdapterProvider } from "./providers/ocr-adapter";
import { cacheAttachmentRecognitionResults } from "./result-cache";
import type { ImageUnderstandingRuntimeSettings } from "./settings-store";

export type AttachmentUnderstandingResult =
  | { kind: "native" }
  | { kind: "preprocessed"; observations: CachedAttachmentUnderstandingObservation[] }
  | { kind: "failed"; errorCode: string }
  | { kind: "cancelled" };

export interface AttachmentUnderstandingTaskOptions extends Pick<
  AttachmentRecognitionLifecycleOptions,
  "operationId" | "submissionId" | "rpcId" | "publish"
> {
  attachments: readonly RecognizableAttachment[];
  settings: { ok: true; value: ImageUnderstandingRuntimeSettings } | { ok: false; error: unknown };
  signal: AbortSignal;
  modelSupportsImages: () => Promise<boolean>;
  prepareMultimodal: (provider: string) => Promise<void>;
  recognizeMultimodal: (options: {
    provider: string;
    model: string;
    attachments: readonly RecognizableAttachment[];
    signal: AbortSignal;
    onProgress: (completedCount: number) => Promise<void>;
  }) => Promise<AttachmentUnderstandingObservation[]>;
}

const MAX_ATTACHMENT_UNDERSTANDING_CONTEXT_CHARACTERS = 250_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateAttachmentUnderstandingObservations(
  observations: unknown,
  expectedAttachments: readonly RecognizableAttachment[],
): asserts observations is AttachmentUnderstandingObservation[] {
  const attachmentCount = expectedAttachments.length;
  if (!Array.isArray(observations) || observations.length !== attachmentCount) {
    throw new ImageUnderstandingProviderError("provider-invalid-response");
  }
  const expectedById = new Map(
    expectedAttachments.map((attachment) => [attachment.id, attachment]),
  );
  const observedIds = new Set<string>();
  const referencesMatch = observations.every((observation) => {
    if (
      !isRecord(observation) ||
      typeof observation.attachmentId !== "string" ||
      typeof observation.text !== "string" ||
      typeof observation.providerId !== "string" ||
      !["ocr", "multimodal"].includes(observation.method as string) ||
      !["markdown", "text"].includes(observation.format as string)
    )
      return false;
    const expected = expectedById.get(observation.attachmentId);
    if (!expected || observedIds.has(observation.attachmentId)) return false;
    observedIds.add(observation.attachmentId);
    return expected.kind === observation.kind && expected.sequence === observation.sequence;
  });
  if (expectedById.size !== attachmentCount || !referencesMatch) {
    throw new ImageUnderstandingProviderError("provider-invalid-response");
  }
  const totalCharacters = observations.reduce((total, observation) => {
    return total + observation.text.length;
  }, 0);
  if (totalCharacters > MAX_ATTACHMENT_UNDERSTANDING_CONTEXT_CHARACTERS) {
    throw new ImageUnderstandingProviderError("provider-response-too-large");
  }
}

function stableImageUnderstandingErrorCode(error: unknown): string {
  if (error instanceof ImageUnderstandingProviderError) return error.code;
  if (error instanceof Error && error.name === "AbortError") return "provider-aborted";
  if (isRecord(error) && typeof error.code === "string" && /^[a-z0-9._-]+$/u.test(error.code)) {
    return error.code;
  }
  return "provider-unavailable";
}

function stableAttachmentRecognitionDiagnostic(error: unknown) {
  return error instanceof ImageUnderstandingProviderError ? error.diagnostic : undefined;
}

/** Owns one recognition operation; the host owns persistence and session cancellation resources. */
export async function runAttachmentUnderstandingTask(
  options: AttachmentUnderstandingTaskOptions,
): Promise<AttachmentUnderstandingResult> {
  const { attachments, settings: settingsResult, signal } = options;
  const route = settingsResult.ok
    ? decideAttachmentUnderstandingRoute({
        settings: settingsResult.value.value,
        hasImages: attachments.some((attachment) => attachment.kind === "image"),
        hasDocuments: attachments.some((attachment) => attachment.kind === "pdf"),
        modelSupportsImages: await options.modelSupportsImages(),
      })
    : undefined;
  const method =
    route?.kind === "native"
      ? "native"
      : settingsResult.ok
        ? settingsResult.value.value.engine
        : "ocr";
  const lifecycle = new AttachmentRecognitionLifecycle({
    operationId: options.operationId,
    submissionId: options.submissionId,
    ...(options.rpcId === undefined ? {} : { rpcId: options.rpcId }),
    method,
    ...(route?.kind === "preprocess" ? { providerId: route.providerId } : {}),
    attachmentCount: attachments.length,
    publish: options.publish,
  });
  try {
    await lifecycle.pending();
    await lifecycle.running("routing");
    if (signal.aborted) {
      await lifecycle.cancelled();
      return { kind: "cancelled" };
    }
    if (!settingsResult.ok) {
      const errorCode = stableImageUnderstandingErrorCode(settingsResult.error);
      await lifecycle.failed(
        errorCode,
        stableAttachmentRecognitionDiagnostic(settingsResult.error),
      );
      return { kind: "failed", errorCode };
    }
    const runtimeSettings = settingsResult.value;
    if (!route) throw new Error("Missing attachment route.");
    if (route.kind === "native") {
      await lifecycle.skipped("native");
      return { kind: "native" };
    }
    if (route.kind === "none") {
      await lifecycle.skipped(method);
      return { kind: "preprocessed", observations: [] };
    }
    if (route.kind === "unsupported") {
      await lifecycle.failed(route.reason);
      return { kind: "failed", errorCode: route.reason };
    }
    if (route.method === "multimodal") {
      // Attachment settings may point at a provider other than the session model. Reload that
      // provider too so retries use its current credentials and model configuration.
      await options.prepareMultimodal(route.providerId);
    }

    const inputs = attachments;
    let observations: AttachmentUnderstandingObservation[];
    if (route.method === "ocr") {
      const credential = runtimeSettings.credential;
      if (!credential) {
        await lifecycle.failed("preprocessor-not-configured");
        return { kind: "failed", errorCode: "preprocessor-not-configured" };
      }
      let jobs: readonly AttachmentRecognitionJob[] = attachments.map((attachment) => ({
        attachmentId: attachment.id,
        status: "queued",
        pollCount: 0,
      }));
      await lifecycle.running("submitting", { jobs });
      const provider = new OcrAdapterProvider({
        source: runtimeSettings.value.ocrAdapter.source,
        endpoint: runtimeSettings.value.ocrAdapter.endpoint,
        model: runtimeSettings.value.ocrAdapter.model,
        pollIntervalMs: runtimeSettings.value.ocrAdapter.pollIntervalMs,
        pollTimeoutMs: runtimeSettings.value.ocrAdapter.pollTimeoutMs,
        onSubmissionRetry: async () => {
          await lifecycle.running("submitting");
        },
        onProgress: async (job) => {
          jobs = jobs.map((current) => (current.attachmentId === job.attachmentId ? job : current));
          const completedCount = jobs.filter((current) => current.status === "succeeded").length;
          await lifecycle.running(
            job.status === "submitting"
              ? "submitting"
              : job.status === "downloading" || job.status === "succeeded"
                ? "normalizing"
                : job.status === "running"
                  ? "recognizing"
                  : "polling",
            { jobs, completedCount, progress: completedCount / attachments.length },
          );
        },
      });
      if (provider.definition.operation.kind === "sync") {
        await lifecycle.running("recognizing");
      }
      observations = await provider.recognize({
        attachments: inputs,
        credential,
        signal: signal,
      });
    } else {
      await lifecycle.running("submitting");
      await lifecycle.running("recognizing");
      observations = await options.recognizeMultimodal({
        provider: runtimeSettings.value.multimodal.provider,
        model: runtimeSettings.value.multimodal.model,
        attachments: inputs,
        signal: signal,
        onProgress: async (completedCount) => {
          await lifecycle.running("recognizing", {
            completedCount,
            progress: completedCount / attachments.length,
          });
        },
      });
    }
    signal.throwIfAborted();
    validateAttachmentUnderstandingObservations(observations, inputs);
    await lifecycle.running("normalizing", {
      completedCount: observations.length,
      progress: observations.length / attachments.length,
    });
    const cached = await cacheAttachmentRecognitionResults(
      runtimeSettings.value.resultCacheDirectory,
      observations,
      signal,
    );
    await lifecycle.succeeded({
      results: projectAttachmentRecognitionResults(cached),
    });
    return { kind: "preprocessed", observations: cached };
  } catch (error) {
    if (signal.aborted || stableImageUnderstandingErrorCode(error) === "provider-aborted") {
      if (!isTerminalAttachmentRecognitionSnapshot(lifecycle.current)) {
        await lifecycle.cancelled();
      }
      return { kind: "cancelled" };
    }
    const errorCode = stableImageUnderstandingErrorCode(error);
    if (!isTerminalAttachmentRecognitionSnapshot(lifecycle.current))
      await lifecycle.failed(errorCode, stableAttachmentRecognitionDiagnostic(error));
    return { kind: "failed", errorCode };
  }
}
