import {
  ATTACHMENT_RECOGNITION_METHODS as SHARED_ATTACHMENT_RECOGNITION_METHODS,
  ATTACHMENT_RECOGNITION_STAGES as SHARED_ATTACHMENT_RECOGNITION_STAGES,
  ATTACHMENT_RECOGNITION_TERMINAL_STATUSES,
  WORKBENCH_ATTACHMENT_RECOGNITION_DATA_NAME,
  WORKBENCH_IMAGE_RECOGNITION_DATA_NAME,
  parseAttachmentRecognitionSnapshot,
  parseAttachmentReferenceId,
  type AttachmentRecognitionMethod as SharedAttachmentRecognitionMethod,
  type AttachmentRecognitionFailureDiagnostic,
  type AttachmentRecognitionResultFormat as SharedAttachmentRecognitionResultFormat,
  type AttachmentRecognitionSnapshot,
  type AttachmentRecognitionStage as SharedAttachmentRecognitionStage,
  type AttachmentRecognitionStatus as SharedAttachmentRecognitionStatus,
  type AttachmentReferenceKind,
} from "@workbench/attachment-understanding-contracts/state-machine";

export const ATTACHMENT_RECOGNITION_DATA_PART_NAME = WORKBENCH_ATTACHMENT_RECOGNITION_DATA_NAME;
export const LEGACY_IMAGE_RECOGNITION_DATA_PART_NAME = WORKBENCH_IMAGE_RECOGNITION_DATA_NAME;
/** @deprecated Register the attachment-neutral data-part name for new messages. */
export const IMAGE_RECOGNITION_DATA_PART_NAME = ATTACHMENT_RECOGNITION_DATA_PART_NAME;

export const IMAGE_RECOGNITION_STATUSES = [
  "pending",
  "running",
  ...ATTACHMENT_RECOGNITION_TERMINAL_STATUSES,
] as const;

export const IMAGE_RECOGNITION_STAGES = SHARED_ATTACHMENT_RECOGNITION_STAGES;
export const IMAGE_RECOGNITION_METHODS = SHARED_ATTACHMENT_RECOGNITION_METHODS;

export type ImageRecognitionStatus = SharedAttachmentRecognitionStatus;
export type ImageRecognitionStage = SharedAttachmentRecognitionStage;
export type ImageRecognitionMethod = SharedAttachmentRecognitionMethod;
export type ImageRecognitionResultFormat = SharedAttachmentRecognitionResultFormat;

/**
 * The version-one transport shape emitted as a named assistant-ui data part.
 * The renderer deliberately keeps operation identifiers and timestamps out of
 * its presentation model so they can never become accidental user-facing text.
 */
export type ImageRecognitionDataPartV1 = AttachmentRecognitionSnapshot;

export type ImageRecognitionErrorKind =
  | "authentication"
  | "configuration"
  | "rateLimited"
  | "timeout"
  | "network"
  | "serviceUnavailable"
  | "unsupportedImage"
  | "invalidResponse"
  | "generic";

export type ImageRecognitionSkipKind = "native" | "disabled" | "notNeeded" | "generic";

export interface ImageRecognitionPresentationResult {
  readonly attachmentId: string;
  readonly referenceKind: AttachmentReferenceKind | "attachment";
  readonly sequence: number;
  readonly format: ImageRecognitionResultFormat;
  readonly text: string;
  readonly truncated?: true;
}

export interface ImageRecognitionPresentationState {
  readonly status: ImageRecognitionStatus;
  readonly stage?: ImageRecognitionStage;
  readonly method: ImageRecognitionMethod;
  readonly providerId?: string;
  readonly attachmentCount: number;
  readonly completedCount: number;
  /** Normalized finite progress in the inclusive range 0..1. */
  readonly progress: number;
  readonly results: readonly ImageRecognitionPresentationResult[];
  readonly errorCode?: string;
  readonly diagnostic?: AttachmentRecognitionFailureDiagnostic;
  readonly errorKind?: ImageRecognitionErrorKind;
  readonly skipKind?: ImageRecognitionSkipKind;
}

export interface ImageRecognitionLiveRegion {
  readonly role: "alert" | "status";
  readonly live: "assertive" | "polite";
}

const SAFE_IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,127}$/iu;

function safeIdentifier(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_IDENTIFIER.test(value) ? value : undefined;
}

export function imageRecognitionLiveRegion(
  status: ImageRecognitionStatus,
): ImageRecognitionLiveRegion {
  return status === "failed"
    ? { role: "alert", live: "assertive" }
    : { role: "status", live: "polite" };
}

export function imageRecognitionErrorKind(errorCode: unknown): ImageRecognitionErrorKind {
  const normalized = safeIdentifier(errorCode)?.toLowerCase();
  switch (normalized) {
    case "auth":
    case "auth-failed":
    case "authentication-failed":
    case "credential-missing":
    case "invalid-credential":
    case "invalid-credentials":
    case "provider-authentication-failed":
    case "unauthorized":
      return "authentication";
    case "config-invalid":
    case "configuration-invalid":
    case "image-settings-conflict":
    case "image-settings-invalid":
    case "image-settings-io":
    case "invalid-config":
    case "preprocessor-not-configured":
    case "provider-configuration-invalid":
    case "provider-not-configured":
    case "recognition-disabled":
      return "configuration";
    case "rate-limit":
    case "rate-limited":
    case "provider-rate-limited":
    case "too-many-requests":
      return "rateLimited";
    case "deadline-exceeded":
    case "poll-timeout":
    case "provider-poll-timeout":
    case "provider-timeout":
    case "timeout":
      return "timeout";
    case "connection-failed":
    case "network":
    case "network-error":
    case "provider-network-error":
      return "network";
    case "provider-unavailable":
    case "recognition-interrupted":
    case "service-unavailable":
      return "serviceUnavailable";
    case "invalid-image":
    case "native-model-required":
    case "provider-invalid-input":
    case "unsupported-image":
    case "unsupported-media-type":
      return "unsupportedImage";
    case "invalid-response":
    case "malformed-response":
    case "provider-invalid-response":
    case "provider-response-too-large":
      return "invalidResponse";
    default:
      return "generic";
  }
}

export function imageRecognitionSkipKind(
  method: ImageRecognitionMethod,
  errorCode: unknown,
  skipReason: unknown,
): ImageRecognitionSkipKind {
  if (method === "native") return "native";

  const normalized = (safeIdentifier(skipReason) ?? safeIdentifier(errorCode))?.toLowerCase();
  switch (normalized) {
    case "disabled":
    case "recognition-disabled":
      return "disabled";
    case "native":
    case "native-vision":
      return "native";
    case "already-supported":
    case "not-needed":
    case "not-required":
      return "notNeeded";
    default:
      return "generic";
  }
}

/**
 * Safely narrows untrusted data-part payloads through the shared FSM parser,
 * then projects only the fields used by the renderer. The terminal result is
 * already bounded normalized user content; endpoint, API keys, request bodies,
 * raw provider objects, and base64 image data remain structurally impossible.
 */
export function parseAttachmentRecognitionPresentation(
  value: unknown,
): ImageRecognitionPresentationState | undefined {
  const snapshot = parseAttachmentRecognitionSnapshot(value);
  if (!snapshot) return undefined;

  const providerId = safeIdentifier(snapshot.providerId);
  const progress = snapshot.progress ?? snapshot.completedCount / snapshot.attachmentCount;

  return {
    status: snapshot.status,
    ...(snapshot.status === "running" ? { stage: snapshot.stage } : {}),
    method: snapshot.method,
    ...(providerId ? { providerId } : {}),
    attachmentCount: snapshot.attachmentCount,
    completedCount: snapshot.completedCount,
    progress,
    results:
      snapshot.status === "succeeded"
        ? (snapshot.results?.map(({ attachmentId, format, text, truncated }, index) => {
            const reference = parseAttachmentReferenceId(attachmentId);
            return {
              attachmentId,
              referenceKind: reference?.kind ?? "attachment",
              sequence: reference?.sequence ?? index + 1,
              format,
              text,
              ...(truncated === true ? { truncated: true as const } : {}),
            };
          }) ?? [])
        : [],
    ...(snapshot.status === "failed"
      ? {
          errorCode: snapshot.errorCode,
          ...(snapshot.diagnostic === undefined ? {} : { diagnostic: snapshot.diagnostic }),
          errorKind: imageRecognitionErrorKind(snapshot.errorCode),
        }
      : {}),
    ...(snapshot.status === "skipped"
      ? { skipKind: imageRecognitionSkipKind(snapshot.method, undefined, undefined) }
      : {}),
  };
}

/** @deprecated Use the attachment-neutral presentation parser for new integrations. */
export const parseImageRecognitionPresentation = parseAttachmentRecognitionPresentation;
