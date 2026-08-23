import {
  parseImageRecognitionSnapshot,
  reduceImageRecognitionSnapshot,
  type ImageRecognitionMethod,
  type ImageRecognitionSnapshot,
  type ImageRecognitionStage,
} from "../../../image-understanding/state-machine";

export interface ImageRecognitionLifecycleOptions {
  operationId: string;
  submissionId: string;
  rpcId?: string;
  method: ImageRecognitionMethod;
  providerId?: string;
  imageCount: number;
  now?: () => number;
  publish: (snapshot: ImageRecognitionSnapshot) => void | Promise<void>;
}

export interface ImageRecognitionProgressUpdate {
  method?: ImageRecognitionMethod;
  providerId?: string;
  completedCount?: number;
  progress?: number;
}

/** The sole server-side writer for one status operation. Provider adapters only report progress. */
export class ImageRecognitionLifecycle {
  private readonly options: ImageRecognitionLifecycleOptions;
  private readonly createdAt: number;
  private currentValue: ImageRecognitionSnapshot;

  constructor(options: ImageRecognitionLifecycleOptions) {
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

  get current(): ImageRecognitionSnapshot {
    return this.currentValue;
  }

  async pending(): Promise<ImageRecognitionSnapshot> {
    await this.options.publish(this.currentValue);
    return this.currentValue;
  }

  async running(
    stage: ImageRecognitionStage,
    update: ImageRecognitionProgressUpdate = {},
  ): Promise<ImageRecognitionSnapshot> {
    return this.transition({
      status: "running",
      stage,
      method: update.method ?? this.currentValue.method,
      providerId: update.providerId ?? this.currentValue.providerId,
      completedCount: update.completedCount ?? this.currentValue.completedCount,
      progress: update.progress ?? this.currentValue.progress,
    });
  }

  async succeeded(update: ImageRecognitionProgressUpdate = {}): Promise<ImageRecognitionSnapshot> {
    return this.terminal({
      status: "succeeded",
      method: update.method ?? this.currentValue.method,
      providerId: update.providerId ?? this.currentValue.providerId,
      completedCount: this.options.imageCount,
      progress: 1,
    });
  }

  async failed(errorCode: string): Promise<ImageRecognitionSnapshot> {
    return this.terminal({
      status: "failed",
      method: this.currentValue.method,
      providerId: this.currentValue.providerId,
      completedCount: this.currentValue.completedCount,
      progress: this.currentValue.progress,
      errorCode,
    });
  }

  async cancelled(): Promise<ImageRecognitionSnapshot> {
    return this.terminal({
      status: "cancelled",
      method: this.currentValue.method,
      providerId: this.currentValue.providerId,
      completedCount: this.currentValue.completedCount,
      progress: this.currentValue.progress,
    });
  }

  async skipped(
    method: ImageRecognitionMethod,
    providerId?: string,
  ): Promise<ImageRecognitionSnapshot> {
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
          status: "succeeded" | "cancelled" | "skipped";
          method: ImageRecognitionMethod;
          providerId?: string;
          completedCount: number;
          progress?: number;
        }
      | {
          status: "failed";
          method: ImageRecognitionMethod;
          providerId?: string;
          completedCount: number;
          progress?: number;
          errorCode: string;
        },
  ): Promise<ImageRecognitionSnapshot> {
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
      ImageRecognitionSnapshot,
      "version" | "operationId" | "submissionId" | "rpcId" | "revision" | "imageCount"
    >,
  ): Promise<ImageRecognitionSnapshot> {
    const updatedAt = this.nextTimestamp();
    const incoming = this.parse({
      ...state,
      revision: this.currentValue.revision + 1,
      timestamps:
        state.timestamps ??
        ({ createdAt: this.createdAt, updatedAt } satisfies NonNullable<
          ImageRecognitionSnapshot["timestamps"]
        >),
    });
    this.currentValue = reduceImageRecognitionSnapshot(this.currentValue, incoming);
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
      ImageRecognitionSnapshot,
      "version" | "operationId" | "submissionId" | "rpcId" | "imageCount"
    >,
  ): ImageRecognitionSnapshot {
    const snapshot = parseImageRecognitionSnapshot({
      version: 1,
      operationId: this.options.operationId,
      submissionId: this.options.submissionId,
      ...(this.options.rpcId === undefined ? {} : { rpcId: this.options.rpcId }),
      imageCount: this.options.imageCount,
      ...state,
    });
    if (!snapshot) throw new TypeError("The image recognition lifecycle produced invalid state.");
    return snapshot;
  }
}
