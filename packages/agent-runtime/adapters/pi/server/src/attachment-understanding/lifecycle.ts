import {
  parseAttachmentRecognitionSnapshot,
  reduceAttachmentRecognitionSnapshot,
  type AttachmentRecognitionFailureDiagnostic,
  type AttachmentRecognitionMethod,
  type AttachmentRecognitionResult,
  type AttachmentRecognitionSnapshot,
  type AttachmentRecognitionStage,
} from "@workbench/attachment-understanding-contracts/state-machine";

export interface AttachmentRecognitionLifecycleOptions {
  operationId: string;
  submissionId: string;
  rpcId?: string;
  method: AttachmentRecognitionMethod;
  providerId?: string;
  attachmentCount: number;
  now?: () => number;
  publish: (snapshot: AttachmentRecognitionSnapshot) => void | Promise<void>;
}

export interface AttachmentRecognitionProgressUpdate {
  method?: AttachmentRecognitionMethod;
  providerId?: string;
  completedCount?: number;
  progress?: number;
}

export interface AttachmentRecognitionSuccessUpdate extends AttachmentRecognitionProgressUpdate {
  /** Bounded normalized output suitable for the terminal message disclosure. */
  results?: readonly AttachmentRecognitionResult[];
}

/** The sole server-side writer for one status operation. Provider adapters only report progress. */
export class AttachmentRecognitionLifecycle {
  private readonly options: AttachmentRecognitionLifecycleOptions;
  private readonly createdAt: number;
  private currentValue: AttachmentRecognitionSnapshot;

  constructor(options: AttachmentRecognitionLifecycleOptions) {
    this.options = options;
    this.createdAt = (options.now ?? Date.now)();
    this.currentValue = this.parse({
      status: "pending",
      revision: 0,
      method: options.method,
      ...(options.providerId === undefined ? {} : { providerId: options.providerId }),
      completedCount: 0,
      progress: 0,
      timestamps: { createdAt: this.createdAt, updatedAt: this.createdAt },
    });
  }

  get current(): AttachmentRecognitionSnapshot {
    return this.currentValue;
  }

  async pending(): Promise<AttachmentRecognitionSnapshot> {
    await this.options.publish(this.currentValue);
    return this.currentValue;
  }

  async running(
    stage: AttachmentRecognitionStage,
    update: AttachmentRecognitionProgressUpdate = {},
  ): Promise<AttachmentRecognitionSnapshot> {
    return this.transition({
      status: "running",
      stage,
      method: update.method ?? this.currentValue.method,
      providerId: update.providerId ?? this.currentValue.providerId,
      completedCount: update.completedCount ?? this.currentValue.completedCount,
      progress: update.progress ?? this.currentValue.progress,
    });
  }

  async succeeded(
    update: AttachmentRecognitionSuccessUpdate = {},
  ): Promise<AttachmentRecognitionSnapshot> {
    return this.terminal({
      status: "succeeded",
      method: update.method ?? this.currentValue.method,
      providerId: update.providerId ?? this.currentValue.providerId,
      completedCount: this.options.attachmentCount,
      progress: 1,
      ...(update.results === undefined ? {} : { results: update.results }),
    });
  }

  async failed(
    errorCode: string,
    diagnostic?: AttachmentRecognitionFailureDiagnostic,
  ): Promise<AttachmentRecognitionSnapshot> {
    return this.terminal({
      status: "failed",
      method: this.currentValue.method,
      providerId: this.currentValue.providerId,
      completedCount: this.currentValue.completedCount,
      progress: this.currentValue.progress,
      errorCode,
      ...(diagnostic === undefined ? {} : { diagnostic }),
    });
  }

  async cancelled(): Promise<AttachmentRecognitionSnapshot> {
    return this.terminal({
      status: "cancelled",
      method: this.currentValue.method,
      providerId: this.currentValue.providerId,
      completedCount: this.currentValue.completedCount,
      progress: this.currentValue.progress,
    });
  }

  async skipped(
    method: AttachmentRecognitionMethod,
    providerId?: string,
  ): Promise<AttachmentRecognitionSnapshot> {
    return this.terminal({
      status: "skipped",
      method,
      providerId,
      completedCount: this.currentValue.completedCount,
      progress: this.currentValue.progress,
    });
  }

  private async terminal(
    state:
      | {
          status: "succeeded";
          method: AttachmentRecognitionMethod;
          providerId?: string;
          completedCount: number;
          progress?: number;
          results?: readonly AttachmentRecognitionResult[];
        }
      | {
          status: "cancelled" | "skipped";
          method: AttachmentRecognitionMethod;
          providerId?: string;
          completedCount: number;
          progress?: number;
        }
      | {
          status: "failed";
          method: AttachmentRecognitionMethod;
          providerId?: string;
          completedCount: number;
          progress?: number;
          errorCode: string;
          diagnostic?: AttachmentRecognitionFailureDiagnostic;
        },
  ): Promise<AttachmentRecognitionSnapshot> {
    const completedAt = this.nextTimestamp();
    return this.transition({
      ...state,
      timestamps: {
        createdAt: this.createdAt,
        updatedAt: completedAt,
        completedAt,
      },
    });
  }

  private async transition(
    state: Omit<
      AttachmentRecognitionSnapshot,
      "version" | "operationId" | "submissionId" | "rpcId" | "revision" | "attachmentCount"
    >,
  ): Promise<AttachmentRecognitionSnapshot> {
    const updatedAt = this.nextTimestamp();
    const incoming = this.parse({
      ...state,
      revision: this.currentValue.revision + 1,
      timestamps:
        state.timestamps ??
        ({ createdAt: this.createdAt, updatedAt } satisfies NonNullable<
          AttachmentRecognitionSnapshot["timestamps"]
        >),
    });
    this.currentValue = reduceAttachmentRecognitionSnapshot(this.currentValue, incoming);
    await this.options.publish(this.currentValue);
    return this.currentValue;
  }

  private nextTimestamp(): number {
    return Math.max(
      this.createdAt,
      this.currentValue.timestamps?.updatedAt ?? this.createdAt,
      (this.options.now ?? Date.now)(),
    );
  }

  private parse(
    state: Omit<
      AttachmentRecognitionSnapshot,
      "version" | "operationId" | "submissionId" | "rpcId" | "attachmentCount"
    >,
  ): AttachmentRecognitionSnapshot {
    const snapshot = parseAttachmentRecognitionSnapshot({
      version: 1,
      operationId: this.options.operationId,
      submissionId: this.options.submissionId,
      ...(this.options.rpcId === undefined ? {} : { rpcId: this.options.rpcId }),
      attachmentCount: this.options.attachmentCount,
      ...state,
    });
    if (!snapshot) {
      throw new TypeError("The attachment recognition lifecycle produced invalid state.");
    }
    return snapshot;
  }
}
