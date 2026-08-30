/** Canonical JSON-safe protocol for OCR and other preprocessing across images and documents. */
export const WORKBENCH_ATTACHMENT_RECOGNITION_CUSTOM_TYPE = "workbench.attachment-recognition.v1";
export const WORKBENCH_ATTACHMENT_RECOGNITION_DATA_NAME = "workbench.attachment-recognition";

/** Legacy protocol identifiers retained so persisted image-only sessions remain readable. */
export const WORKBENCH_IMAGE_RECOGNITION_CUSTOM_TYPE = "workbench.image-recognition.v1";
export const WORKBENCH_IMAGE_RECOGNITION_DATA_NAME = "workbench.image-recognition";

export const IMAGE_RECOGNITION_METHODS = ["ocr", "multimodal", "native"] as const;
export type ImageRecognitionMethod = (typeof IMAGE_RECOGNITION_METHODS)[number];

export const IMAGE_RECOGNITION_STAGES = [
  "routing",
  "submitting",
  "polling",
  "recognizing",
  "normalizing",
  "fallback",
] as const;
export type ImageRecognitionStage = (typeof IMAGE_RECOGNITION_STAGES)[number];

export const IMAGE_RECOGNITION_TERMINAL_STATUSES = [
  "succeeded",
  "failed",
  "cancelled",
  "skipped",
] as const;
export type ImageRecognitionTerminalStatus = (typeof IMAGE_RECOGNITION_TERMINAL_STATUSES)[number];
export type ImageRecognitionStatus = "pending" | "running" | ImageRecognitionTerminalStatus;

export const IMAGE_RECOGNITION_RESULT_FORMATS = ["markdown", "text"] as const;
export type ImageRecognitionResultFormat = (typeof IMAGE_RECOGNITION_RESULT_FORMATS)[number];

export const ATTACHMENT_RECOGNITION_FAILURE_PHASES = [
  "configuration",
  "routing",
  "submission",
  "polling",
  "result-download",
  "result-parsing",
  "normalizing",
] as const;
export type AttachmentRecognitionFailurePhase =
  (typeof ATTACHMENT_RECOGNITION_FAILURE_PHASES)[number];

export const ATTACHMENT_RECOGNITION_RESULT_SOURCES = ["jsonl", "markdown"] as const;
export type AttachmentRecognitionResultSource =
  (typeof ATTACHMENT_RECOGNITION_RESULT_SOURCES)[number];

/**
 * Bounded, sanitized failure metadata suitable for persistence and display. Raw response bodies,
 * provider messages, endpoints, credentials, and attachment bytes are deliberately unsupported.
 */
export interface AttachmentRecognitionFailureDiagnostic {
  readonly phase: AttachmentRecognitionFailurePhase;
  readonly reason: string;
  readonly httpStatus?: number;
  readonly providerCode?: string;
  readonly resultSource?: AttachmentRecognitionResultSource;
}

/** Matches the inline-image admission limit and bounds terminal snapshot fan-out. */
export const MAX_IMAGE_RECOGNITION_RESULTS = 20;
/** Leaves headroom for JSON escaping and event metadata below the 1 MiB stream budget. */
export const MAX_IMAGE_RECOGNITION_RESULT_CHARACTERS = 100_000;

/**
 * Normalized, user-visible recognition output. Provider envelopes, credentials, endpoints, raw
 * errors, and image bytes are deliberately not representable here.
 */
export interface ImageRecognitionResult {
  readonly imageId: string;
  readonly format: ImageRecognitionResultFormat;
  readonly text: string;
  /** True when the full model-context observation exceeded the message-display budget. */
  readonly truncated?: true;
}

export interface ImageRecognitionTimestamps {
  /** Epoch milliseconds at which this operation was created. */
  createdAt: number;
  /** Epoch milliseconds at which this snapshot was produced. */
  updatedAt: number;
  /** Epoch milliseconds at which a terminal snapshot was produced. */
  completedAt?: number;
}

interface ImageRecognitionSnapshotBase {
  version: 1;
  operationId: string;
  submissionId: string;
  rpcId?: string;
  revision: number;
  method: ImageRecognitionMethod;
  providerId?: string;
  imageCount: number;
  completedCount: number;
  progress?: number;
  timestamps?: ImageRecognitionTimestamps;
}

export type ImageRecognitionSnapshot = ImageRecognitionSnapshotBase &
  (
    | {
        status: "pending";
        stage?: never;
        errorCode?: never;
        diagnostic?: never;
        results?: never;
      }
    | {
        status: "running";
        stage: ImageRecognitionStage;
        errorCode?: never;
        diagnostic?: never;
        results?: never;
      }
    | {
        status: "succeeded";
        stage?: never;
        errorCode?: never;
        diagnostic?: never;
        /** Optional for compatibility with terminal snapshots persisted before result display. */
        results?: readonly ImageRecognitionResult[];
      }
    | {
        status: "cancelled" | "skipped";
        stage?: never;
        errorCode?: never;
        diagnostic?: never;
        results?: never;
      }
    | {
        status: "failed";
        stage?: never;
        /** Stable machine-readable code. Raw provider error text is intentionally unsupported. */
        errorCode: string;
        diagnostic?: AttachmentRecognitionFailureDiagnostic;
        results?: never;
      }
  );

export type AttachmentRecognitionMethod = ImageRecognitionMethod;
export type AttachmentRecognitionStage = ImageRecognitionStage;
export type AttachmentRecognitionTerminalStatus = ImageRecognitionTerminalStatus;
export type AttachmentRecognitionStatus = ImageRecognitionStatus;
export type AttachmentRecognitionResultFormat = ImageRecognitionResultFormat;
export type AttachmentRecognitionTimestamps = ImageRecognitionTimestamps;

/**
 * Canonical result item for both images and document attachments. The old `imageId` form is
 * accepted only by the compatibility parser below and is never emitted for new operations.
 */
export interface AttachmentRecognitionResult {
  readonly attachmentId: string;
  readonly format: AttachmentRecognitionResultFormat;
  readonly text: string;
  readonly truncated?: true;
}

interface AttachmentRecognitionSnapshotBase {
  version: 1;
  operationId: string;
  submissionId: string;
  rpcId?: string;
  revision: number;
  method: AttachmentRecognitionMethod;
  providerId?: string;
  attachmentCount: number;
  completedCount: number;
  progress?: number;
  timestamps?: AttachmentRecognitionTimestamps;
}

export type AttachmentRecognitionSnapshot = AttachmentRecognitionSnapshotBase &
  (
    | {
        status: "pending";
        stage?: never;
        errorCode?: never;
        diagnostic?: never;
        results?: never;
      }
    | {
        status: "running";
        stage: AttachmentRecognitionStage;
        errorCode?: never;
        diagnostic?: never;
        results?: never;
      }
    | {
        status: "succeeded";
        stage?: never;
        errorCode?: never;
        diagnostic?: never;
        results?: readonly AttachmentRecognitionResult[];
      }
    | {
        status: "cancelled" | "skipped";
        stage?: never;
        errorCode?: never;
        diagnostic?: never;
        results?: never;
      }
    | {
        status: "failed";
        stage?: never;
        errorCode: string;
        diagnostic?: AttachmentRecognitionFailureDiagnostic;
        results?: never;
      }
  );

export type ImageRecognitionTransitionErrorCode =
  | "invalid-snapshot"
  | "operation-mismatch"
  | "identity-mismatch"
  | "revision-conflict"
  | "terminal-state"
  | "invalid-transition"
  | "completed-count-regression"
  | "timestamp-regression";

export class ImageRecognitionTransitionError extends Error {
  readonly code: ImageRecognitionTransitionErrorCode;

  constructor(code: ImageRecognitionTransitionErrorCode, message: string) {
    super(message);
    this.name = "ImageRecognitionTransitionError";
    this.code = code;
  }
}

const SNAPSHOT_KEYS = new Set([
  "version",
  "operationId",
  "submissionId",
  "rpcId",
  "revision",
  "status",
  "stage",
  "method",
  "providerId",
  "imageCount",
  "completedCount",
  "progress",
  "timestamps",
  "errorCode",
  "diagnostic",
  "results",
]);
const TIMESTAMP_KEYS = new Set(["createdAt", "updatedAt", "completedAt"]);
const DIAGNOSTIC_KEYS = new Set(["phase", "reason", "httpStatus", "providerCode", "resultSource"]);
const RESULT_KEYS = new Set(["imageId", "format", "text", "truncated"]);
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const SAFE_ERROR_CODE_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function safeIdentifier(value: unknown, maximumLength = 256): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    SAFE_ID_PATTERN.test(value)
  );
}

function safeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function parseTimestamps(value: unknown): ImageRecognitionTimestamps | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, TIMESTAMP_KEYS)) return undefined;
  if (!safeInteger(value.createdAt) || !safeInteger(value.updatedAt)) return undefined;
  if (value.updatedAt < value.createdAt) return undefined;
  if (value.completedAt !== undefined) {
    if (!safeInteger(value.completedAt) || value.completedAt < value.updatedAt) return undefined;
  }
  return {
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(value.completedAt === undefined ? {} : { completedAt: value.completedAt }),
  };
}

function isMethod(value: unknown): value is ImageRecognitionMethod {
  return (IMAGE_RECOGNITION_METHODS as readonly unknown[]).includes(value);
}

function isStage(value: unknown): value is ImageRecognitionStage {
  return (IMAGE_RECOGNITION_STAGES as readonly unknown[]).includes(value);
}

function isTerminalStatus(value: unknown): value is ImageRecognitionTerminalStatus {
  return (IMAGE_RECOGNITION_TERMINAL_STATUSES as readonly unknown[]).includes(value);
}

function parseErrorCode(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    SAFE_ERROR_CODE_PATTERN.test(value)
    ? value
    : undefined;
}

function parseFailureDiagnostic(
  value: unknown,
): AttachmentRecognitionFailureDiagnostic | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, DIAGNOSTIC_KEYS)) return undefined;
  if (
    !(ATTACHMENT_RECOGNITION_FAILURE_PHASES as readonly unknown[]).includes(value.phase) ||
    parseErrorCode(value.reason) === undefined ||
    (value.httpStatus !== undefined &&
      (typeof value.httpStatus !== "number" ||
        !Number.isSafeInteger(value.httpStatus) ||
        value.httpStatus < 100 ||
        value.httpStatus > 599)) ||
    (value.providerCode !== undefined && parseErrorCode(value.providerCode) === undefined) ||
    (value.resultSource !== undefined &&
      !(ATTACHMENT_RECOGNITION_RESULT_SOURCES as readonly unknown[]).includes(value.resultSource))
  ) {
    return undefined;
  }
  return {
    phase: value.phase as AttachmentRecognitionFailurePhase,
    reason: value.reason as string,
    ...(value.httpStatus === undefined ? {} : { httpStatus: value.httpStatus as number }),
    ...(value.providerCode === undefined ? {} : { providerCode: value.providerCode as string }),
    ...(value.resultSource === undefined
      ? {}
      : { resultSource: value.resultSource as AttachmentRecognitionResultSource }),
  };
}

function isResultFormat(value: unknown): value is ImageRecognitionResultFormat {
  return (IMAGE_RECOGNITION_RESULT_FORMATS as readonly unknown[]).includes(value);
}

function parseResults(
  value: unknown,
  imageCount: number,
): readonly ImageRecognitionResult[] | null | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length !== imageCount ||
    value.length > MAX_IMAGE_RECOGNITION_RESULTS
  ) {
    return null;
  }

  const imageIds = new Set<string>();
  const results: ImageRecognitionResult[] = [];
  let totalCharacters = 0;
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      !hasOnlyKeys(candidate, RESULT_KEYS) ||
      !safeIdentifier(candidate.imageId, 128) ||
      !isResultFormat(candidate.format) ||
      typeof candidate.text !== "string" ||
      (candidate.truncated !== undefined && candidate.truncated !== true)
    ) {
      return null;
    }
    if (imageIds.has(candidate.imageId)) return null;
    imageIds.add(candidate.imageId);
    totalCharacters += candidate.text.length;
    if (totalCharacters > MAX_IMAGE_RECOGNITION_RESULT_CHARACTERS) return null;
    results.push({
      imageId: candidate.imageId,
      format: candidate.format,
      text: candidate.text,
      ...(candidate.truncated === true ? { truncated: true as const } : {}),
    });
  }
  return results;
}

/**
 * Parses the complete v1 wire snapshot. A succeeded snapshot may expose only bounded normalized
 * recognition results; unknown fields still reject provider payloads, secrets, raw errors, and
 * image data at the boundary.
 */
export function parseImageRecognitionSnapshot(
  value: unknown,
): ImageRecognitionSnapshot | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, SNAPSHOT_KEYS) || value.version !== 1) {
    return undefined;
  }
  if (
    !safeIdentifier(value.operationId) ||
    !safeIdentifier(value.submissionId) ||
    (value.rpcId !== undefined && !safeIdentifier(value.rpcId)) ||
    !safeInteger(value.revision) ||
    !isMethod(value.method) ||
    (value.providerId !== undefined && !safeIdentifier(value.providerId, 128)) ||
    !safeInteger(value.imageCount) ||
    value.imageCount === 0 ||
    !safeInteger(value.completedCount) ||
    value.completedCount > value.imageCount ||
    (value.progress !== undefined &&
      (typeof value.progress !== "number" ||
        !Number.isFinite(value.progress) ||
        value.progress < 0 ||
        value.progress > 1))
  ) {
    return undefined;
  }

  const timestamps = value.timestamps === undefined ? undefined : parseTimestamps(value.timestamps);
  if (value.timestamps !== undefined && timestamps === undefined) return undefined;

  const common = {
    version: 1 as const,
    operationId: value.operationId,
    submissionId: value.submissionId,
    ...(value.rpcId === undefined ? {} : { rpcId: value.rpcId }),
    revision: value.revision,
    method: value.method,
    ...(value.providerId === undefined ? {} : { providerId: value.providerId }),
    imageCount: value.imageCount,
    completedCount: value.completedCount,
    ...(value.progress === undefined ? {} : { progress: value.progress }),
    ...(timestamps === undefined ? {} : { timestamps }),
  };

  if (value.status === "pending") {
    if (
      value.stage !== undefined ||
      value.errorCode !== undefined ||
      value.diagnostic !== undefined ||
      value.results !== undefined ||
      value.completedCount !== 0 ||
      (value.progress !== undefined && value.progress !== 0) ||
      timestamps?.completedAt !== undefined
    ) {
      return undefined;
    }
    return { ...common, status: "pending" };
  }

  if (value.status === "running") {
    if (
      !isStage(value.stage) ||
      value.errorCode !== undefined ||
      value.diagnostic !== undefined ||
      value.results !== undefined ||
      timestamps?.completedAt !== undefined
    ) {
      return undefined;
    }
    return { ...common, status: "running", stage: value.stage };
  }

  if (!isTerminalStatus(value.status) || value.stage !== undefined) return undefined;
  if (timestamps !== undefined && timestamps.completedAt === undefined) return undefined;

  if (value.status === "failed") {
    if (value.results !== undefined) return undefined;
    const errorCode = parseErrorCode(value.errorCode);
    if (errorCode === undefined) return undefined;
    const diagnostic =
      value.diagnostic === undefined ? undefined : parseFailureDiagnostic(value.diagnostic);
    if (value.diagnostic !== undefined && diagnostic === undefined) return undefined;
    return {
      ...common,
      status: "failed",
      errorCode,
      ...(diagnostic === undefined ? {} : { diagnostic }),
    };
  }

  if (value.errorCode !== undefined || value.diagnostic !== undefined) return undefined;
  if (value.status !== "succeeded" && value.results !== undefined) return undefined;
  if (
    value.status === "succeeded" &&
    (value.completedCount !== value.imageCount ||
      (value.progress !== undefined && value.progress !== 1))
  ) {
    return undefined;
  }
  if (value.status === "succeeded") {
    const results = parseResults(value.results, value.imageCount);
    if (results === null) return undefined;
    return {
      ...common,
      status: "succeeded",
      ...(results === undefined ? {} : { results }),
    };
  }
  return { ...common, status: value.status };
}

export function isImageRecognitionSnapshot(value: unknown): value is ImageRecognitionSnapshot {
  return parseImageRecognitionSnapshot(value) !== undefined;
}

export function isTerminalImageRecognitionSnapshot(
  snapshot: Pick<ImageRecognitionSnapshot, "status">,
): boolean {
  return isTerminalStatus(snapshot.status);
}

function sameTimestamps(
  left: ImageRecognitionTimestamps | undefined,
  right: ImageRecognitionTimestamps | undefined,
): boolean {
  return (
    left === right ||
    (left !== undefined &&
      right !== undefined &&
      left.createdAt === right.createdAt &&
      left.updatedAt === right.updatedAt &&
      left.completedAt === right.completedAt)
  );
}

function sameResults(
  left: readonly ImageRecognitionResult[] | undefined,
  right: readonly ImageRecognitionResult[] | undefined,
): boolean {
  return (
    left === right ||
    (left !== undefined &&
      right !== undefined &&
      left.length === right.length &&
      left.every(
        (result, index) =>
          result.imageId === right[index]?.imageId &&
          result.format === right[index]?.format &&
          result.text === right[index]?.text &&
          result.truncated === right[index]?.truncated,
      ))
  );
}

function sameFailureDiagnostic(
  left: AttachmentRecognitionFailureDiagnostic | undefined,
  right: AttachmentRecognitionFailureDiagnostic | undefined,
): boolean {
  return (
    left === right ||
    (left !== undefined &&
      right !== undefined &&
      left.phase === right.phase &&
      left.reason === right.reason &&
      left.httpStatus === right.httpStatus &&
      left.providerCode === right.providerCode &&
      left.resultSource === right.resultSource)
  );
}

function sameSnapshot(left: ImageRecognitionSnapshot, right: ImageRecognitionSnapshot): boolean {
  return (
    left.version === right.version &&
    left.operationId === right.operationId &&
    left.submissionId === right.submissionId &&
    left.rpcId === right.rpcId &&
    left.revision === right.revision &&
    left.status === right.status &&
    left.stage === right.stage &&
    left.method === right.method &&
    left.providerId === right.providerId &&
    left.imageCount === right.imageCount &&
    left.completedCount === right.completedCount &&
    left.progress === right.progress &&
    left.errorCode === right.errorCode &&
    sameFailureDiagnostic(left.diagnostic, right.diagnostic) &&
    sameResults(left.results, right.results) &&
    sameTimestamps(left.timestamps, right.timestamps)
  );
}

function assertStableIdentity(
  current: ImageRecognitionSnapshot,
  incoming: ImageRecognitionSnapshot,
): void {
  if (current.operationId !== incoming.operationId) {
    throw new ImageRecognitionTransitionError(
      "operation-mismatch",
      "Recognition snapshots belong to different attachment operations.",
    );
  }
  if (
    current.version !== incoming.version ||
    current.submissionId !== incoming.submissionId ||
    current.rpcId !== incoming.rpcId ||
    current.imageCount !== incoming.imageCount
  ) {
    throw new ImageRecognitionTransitionError(
      "identity-mismatch",
      "Immutable attachment recognition operation fields changed.",
    );
  }
}

function assertMonotonicFields(
  current: ImageRecognitionSnapshot,
  incoming: ImageRecognitionSnapshot,
): void {
  if (incoming.completedCount < current.completedCount) {
    throw new ImageRecognitionTransitionError(
      "completed-count-regression",
      "Attachment recognition completedCount cannot decrease.",
    );
  }
  if (current.timestamps !== undefined) {
    if (
      incoming.timestamps === undefined ||
      incoming.timestamps.createdAt !== current.timestamps.createdAt ||
      incoming.timestamps.updatedAt < current.timestamps.updatedAt
    ) {
      throw new ImageRecognitionTransitionError(
        "timestamp-regression",
        "Attachment recognition timestamps cannot disappear or move backwards.",
      );
    }
  }
}

function assertStateTransition(
  current: ImageRecognitionSnapshot,
  incoming: ImageRecognitionSnapshot,
  allowSkippedRunningTransition = false,
): void {
  if (isTerminalImageRecognitionSnapshot(current)) {
    throw new ImageRecognitionTransitionError(
      "terminal-state",
      "A terminal attachment recognition snapshot cannot transition again.",
    );
  }
  if (current.status === "pending" && incoming.status !== "running") {
    if (
      allowSkippedRunningTransition &&
      isTerminalImageRecognitionSnapshot(incoming) &&
      incoming.revision > current.revision + 1
    ) {
      return;
    }
    throw new ImageRecognitionTransitionError(
      "invalid-transition",
      "A pending attachment recognition operation must transition to running.",
    );
  }
  if (current.status === "running" && incoming.status === "pending") {
    throw new ImageRecognitionTransitionError(
      "invalid-transition",
      "A running attachment recognition operation cannot transition back to pending.",
    );
  }
}

function mergeImageRecognitionSnapshot(
  currentValue: ImageRecognitionSnapshot,
  incomingValue: unknown,
  allowSkippedRunningTransition: boolean,
): ImageRecognitionSnapshot {
  const current = parsedSnapshot(currentValue);
  const incoming = parsedSnapshot(incomingValue);
  assertStableIdentity(current, incoming);

  if (incoming.revision < current.revision) return currentValue;
  if (incoming.revision === current.revision) {
    if (sameSnapshot(current, incoming)) return currentValue;
    throw new ImageRecognitionTransitionError(
      "revision-conflict",
      "The same attachment recognition revision contains different state.",
    );
  }

  assertStateTransition(current, incoming, allowSkippedRunningTransition);
  assertMonotonicFields(current, incoming);
  return incoming;
}

function parsedSnapshot(value: unknown): ImageRecognitionSnapshot {
  const parsed = parseImageRecognitionSnapshot(value);
  if (parsed) return parsed;
  throw new ImageRecognitionTransitionError(
    "invalid-snapshot",
    "The attachment recognition snapshot is invalid.",
  );
}

/**
 * Applies one operation-local transition. Older revisions and exact duplicate revisions are
 * idempotent and return `current`; conflicting duplicate revisions and illegal transitions throw.
 */
export function reduceImageRecognitionSnapshot(
  currentValue: ImageRecognitionSnapshot,
  incomingValue: unknown,
): ImageRecognitionSnapshot {
  return mergeImageRecognitionSnapshot(currentValue, incomingValue, false);
}

/**
 * Reconciles snapshots observed through replay or paginated history. It preserves every live
 * reducer invariant, but permits a pending snapshot to jump to a terminal snapshot when the
 * revision gap proves that at least one intermediate transition was not observed.
 */
export function reconcileImageRecognitionSnapshot(
  currentValue: ImageRecognitionSnapshot,
  incomingValue: unknown,
): ImageRecognitionSnapshot {
  return mergeImageRecognitionSnapshot(currentValue, incomingValue, true);
}

/**
 * Inserts a replay baseline or reduces an existing operation in an immutable snapshot list.
 * A first observation may already be terminal when history pagination starts after `pending`.
 */
export function upsertImageRecognitionSnapshot(
  snapshots: readonly ImageRecognitionSnapshot[],
  incomingValue: unknown,
): ImageRecognitionSnapshot[] {
  const incoming = parsedSnapshot(incomingValue);
  const index = snapshots.findIndex((snapshot) => snapshot.operationId === incoming.operationId);
  if (index < 0) return [...snapshots, incoming];

  const current = snapshots[index];
  if (!current) return [...snapshots, incoming];
  const next = reduceImageRecognitionSnapshot(current, incoming);
  if (next === current) return snapshots as ImageRecognitionSnapshot[];

  const updated = [...snapshots];
  updated[index] = next;
  return updated;
}

export const ATTACHMENT_RECOGNITION_METHODS = IMAGE_RECOGNITION_METHODS;
export const ATTACHMENT_RECOGNITION_STAGES = IMAGE_RECOGNITION_STAGES;
export const ATTACHMENT_RECOGNITION_TERMINAL_STATUSES = IMAGE_RECOGNITION_TERMINAL_STATUSES;
export const ATTACHMENT_RECOGNITION_RESULT_FORMATS = IMAGE_RECOGNITION_RESULT_FORMATS;
export const MAX_ATTACHMENT_RECOGNITION_RESULTS = MAX_IMAGE_RECOGNITION_RESULTS;
export const MAX_ATTACHMENT_RECOGNITION_RESULT_CHARACTERS = MAX_IMAGE_RECOGNITION_RESULT_CHARACTERS;

/**
 * Stable, type-local references shared by the attachment UI, recognition providers, and model
 * context. Sequences are one-based so users can naturally refer to "image 1" or "PDF 1".
 */
export const ATTACHMENT_REFERENCE_KINDS = ["image", "pdf"] as const;
export type AttachmentReferenceKind = (typeof ATTACHMENT_REFERENCE_KINDS)[number];

export interface AttachmentReference {
  readonly kind: AttachmentReferenceKind;
  readonly sequence: number;
}

function isAttachmentReferenceKind(value: unknown): value is AttachmentReferenceKind {
  return ATTACHMENT_REFERENCE_KINDS.some((kind) => kind === value);
}

function isAttachmentReferenceSequence(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_ATTACHMENT_RECOGNITION_RESULTS
  );
}

export function attachmentReferenceId(reference: AttachmentReference): string {
  if (
    !isAttachmentReferenceKind(reference.kind) ||
    !isAttachmentReferenceSequence(reference.sequence)
  ) {
    throw new RangeError(
      "Attachment references require a supported kind and a one-based sequence.",
    );
  }
  return `${reference.kind}-${reference.sequence}`;
}

export function parseAttachmentReferenceId(value: unknown): AttachmentReference | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(image|pdf)-([1-9][0-9]*)$/u.exec(value);
  const kind = match?.[1];
  const sequence = Number(match?.[2]);
  return isAttachmentReferenceKind(kind) && isAttachmentReferenceSequence(sequence)
    ? { kind, sequence }
    : undefined;
}

function legacyImageSnapshotToAttachment(
  snapshot: ImageRecognitionSnapshot,
): AttachmentRecognitionSnapshot {
  const { imageCount, results, ...common } = snapshot;
  return {
    ...common,
    attachmentCount: imageCount,
    ...(results === undefined
      ? {}
      : {
          results: results.map(({ imageId, ...result }) => ({
            ...result,
            attachmentId: imageId,
          })),
        }),
  } as AttachmentRecognitionSnapshot;
}

function attachmentSnapshotToLegacyImage(
  snapshot: AttachmentRecognitionSnapshot,
): ImageRecognitionSnapshot {
  const { attachmentCount, results, ...common } = snapshot;
  return {
    ...common,
    imageCount: attachmentCount,
    ...(results === undefined
      ? {}
      : {
          results: results.map(({ attachmentId, ...result }) => ({
            ...result,
            imageId: attachmentId,
          })),
        }),
  } as ImageRecognitionSnapshot;
}

function attachmentWireValueToLegacyImage(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (value.attachmentCount === undefined) return value;
  if (value.imageCount !== undefined) return undefined;

  const { attachmentCount, results, ...common } = value;
  if (results !== undefined && !Array.isArray(results)) return undefined;
  const legacyResults = results?.map((candidate) => {
    if (
      !isRecord(candidate) ||
      candidate.attachmentId === undefined ||
      candidate.imageId !== undefined
    ) {
      return undefined;
    }
    const { attachmentId, ...result } = candidate;
    return { ...result, imageId: attachmentId };
  });
  if (legacyResults?.some((candidate) => candidate === undefined)) return undefined;
  return {
    ...common,
    imageCount: attachmentCount,
    ...(legacyResults === undefined ? {} : { results: legacyResults }),
  };
}

/**
 * Parses the canonical attachment protocol and normalizes legacy image-only snapshots. This is
 * the only compatibility seam: new callers always receive `attachmentCount`/`attachmentId`.
 */
export function parseAttachmentRecognitionSnapshot(
  value: unknown,
): AttachmentRecognitionSnapshot | undefined {
  const legacy = parseImageRecognitionSnapshot(attachmentWireValueToLegacyImage(value));
  return legacy === undefined ? undefined : legacyImageSnapshotToAttachment(legacy);
}

export function isAttachmentRecognitionSnapshot(
  value: unknown,
): value is AttachmentRecognitionSnapshot {
  return parseAttachmentRecognitionSnapshot(value) !== undefined;
}

export function isTerminalAttachmentRecognitionSnapshot(
  snapshot: Pick<AttachmentRecognitionSnapshot, "status">,
): boolean {
  return isTerminalImageRecognitionSnapshot(snapshot);
}

function parsedAttachmentSnapshot(value: unknown): AttachmentRecognitionSnapshot {
  const parsed = parseAttachmentRecognitionSnapshot(value);
  if (parsed) return parsed;
  throw new ImageRecognitionTransitionError(
    "invalid-snapshot",
    "The attachment recognition snapshot is invalid.",
  );
}

export function reduceAttachmentRecognitionSnapshot(
  currentValue: AttachmentRecognitionSnapshot,
  incomingValue: unknown,
): AttachmentRecognitionSnapshot {
  const current = parsedAttachmentSnapshot(currentValue);
  const incoming = parsedAttachmentSnapshot(incomingValue);
  const currentLegacy = attachmentSnapshotToLegacyImage(current);
  const nextLegacy = reduceImageRecognitionSnapshot(
    currentLegacy,
    attachmentSnapshotToLegacyImage(incoming),
  );
  return nextLegacy === currentLegacy ? currentValue : legacyImageSnapshotToAttachment(nextLegacy);
}

export function reconcileAttachmentRecognitionSnapshot(
  currentValue: AttachmentRecognitionSnapshot,
  incomingValue: unknown,
): AttachmentRecognitionSnapshot {
  const current = parsedAttachmentSnapshot(currentValue);
  const incoming = parsedAttachmentSnapshot(incomingValue);
  const currentLegacy = attachmentSnapshotToLegacyImage(current);
  const nextLegacy = reconcileImageRecognitionSnapshot(
    currentLegacy,
    attachmentSnapshotToLegacyImage(incoming),
  );
  return nextLegacy === currentLegacy ? currentValue : legacyImageSnapshotToAttachment(nextLegacy);
}

export function upsertAttachmentRecognitionSnapshot(
  snapshots: readonly AttachmentRecognitionSnapshot[],
  incomingValue: unknown,
): AttachmentRecognitionSnapshot[] {
  const incoming = parsedAttachmentSnapshot(incomingValue);
  const index = snapshots.findIndex((snapshot) => snapshot.operationId === incoming.operationId);
  if (index < 0) return [...snapshots, incoming];

  const current = snapshots[index];
  if (!current) return [...snapshots, incoming];
  const next = reduceAttachmentRecognitionSnapshot(current, incoming);
  if (next === current) return snapshots as AttachmentRecognitionSnapshot[];

  const updated = [...snapshots];
  updated[index] = next;
  return updated;
}
