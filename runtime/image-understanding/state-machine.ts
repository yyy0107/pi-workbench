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
      }
    | {
        status: "running";
        stage: ImageRecognitionStage;
        errorCode?: never;
      }
    | {
        status: "succeeded" | "cancelled" | "skipped";
        stage?: never;
        errorCode?: never;
      }
    | {
        status: "failed";
        stage?: never;
        /** Stable machine-readable code. Raw provider error text is intentionally unsupported. */
        errorCode: string;
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
]);
const TIMESTAMP_KEYS = new Set(["createdAt", "updatedAt", "completedAt"]);
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

/**
 * Parses the complete v1 wire snapshot. Unknown fields are rejected so provider payloads, OCR text,
 * raw errors, and image data cannot accidentally cross this status-only boundary.
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
      timestamps?.completedAt !== undefined
    ) {
      return undefined;
    }
    return { ...common, status: "running", stage: value.stage };
  }

  if (!isTerminalStatus(value.status) || value.stage !== undefined) return undefined;
  if (timestamps !== undefined && timestamps.completedAt === undefined) return undefined;

  if (value.status === "failed") {
    const errorCode = parseErrorCode(value.errorCode);
    if (errorCode === undefined) return undefined;
    return { ...common, status: "failed", errorCode };
  }

  if (value.errorCode !== undefined) return undefined;
  if (
    value.status === "succeeded" &&
    (value.completedCount !== value.imageCount ||
      (value.progress !== undefined && value.progress !== 1))
  ) {
    return undefined;
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
      "Image recognition snapshots belong to different operations.",
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
      "Immutable image recognition operation fields changed.",
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
      "Image recognition completedCount cannot decrease.",
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
        "Image recognition timestamps cannot disappear or move backwards.",
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
      "A terminal image recognition snapshot cannot transition again.",
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
      "A pending image recognition operation must transition to running.",
    );
  }
  if (current.status === "running" && incoming.status === "pending") {
    throw new ImageRecognitionTransitionError(
      "invalid-transition",
      "A running image recognition operation cannot transition back to pending.",
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
      "The same image recognition revision contains different state.",
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
    "The image recognition snapshot is invalid.",
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
