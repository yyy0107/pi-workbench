interface ThreadTimingMessage {
  role: string;
  createdAt: Date;
  metadata?: {
    custom?: {
      piSteering?: boolean;
    };
    timing?: {
      streamStartTime: number;
    };
  };
}

export interface PiAutoRetryStatus {
  readonly attempt: number;
  readonly maxAttempts: number;
}

/** Read the runtime-owned start of the active Pi run from assistant-ui thread extras. */
export function piRunStartedAt(extras: unknown): number | undefined {
  if (!extras || typeof extras !== "object" || !("piRun" in extras)) return undefined;
  const piRun = extras.piRun;
  if (!piRun || typeof piRun !== "object" || !("startedAt" in piRun)) return undefined;
  const startedAt = piRun.startedAt;
  return typeof startedAt === "number" && Number.isFinite(startedAt) ? startedAt : undefined;
}

/** Read the active automatic-retry attempt from assistant-ui thread extras. */
export function piAutoRetryStatus(extras: unknown): PiAutoRetryStatus | undefined {
  if (!extras || typeof extras !== "object" || !("piRun" in extras)) return undefined;
  const piRun = extras.piRun;
  if (!piRun || typeof piRun !== "object" || !("autoRetry" in piRun)) return undefined;
  const autoRetry = piRun.autoRetry;
  if (!autoRetry || typeof autoRetry !== "object") return undefined;
  if (!("attempt" in autoRetry) || !("maxAttempts" in autoRetry)) return undefined;
  const { attempt, maxAttempts } = autoRetry;
  if (
    typeof attempt !== "number" ||
    !Number.isInteger(attempt) ||
    attempt <= 0 ||
    typeof maxAttempts !== "number" ||
    !Number.isInteger(maxAttempts) ||
    maxAttempts < attempt
  ) {
    return undefined;
  }
  return autoRetry as PiAutoRetryStatus;
}

/** Return a stable wall-clock start for the currently running turn. */
export function currentRunStartedAt(messages: readonly ThreadTimingMessage[]): number | undefined {
  let assistantStreamStartedAt: number | undefined;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;

    if (message.role === "assistant" && assistantStreamStartedAt === undefined) {
      const candidate = message.metadata?.timing?.streamStartTime;
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        assistantStreamStartedAt = candidate;
      }
    }

    if (message.role === "user" && message.metadata?.custom?.piSteering !== true) {
      const candidate = message.createdAt.getTime();
      if (Number.isFinite(candidate)) return candidate;
    }
  }

  return assistantStreamStartedAt;
}
