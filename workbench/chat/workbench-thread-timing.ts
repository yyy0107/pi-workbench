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

/** Read the runtime-owned start of the active Pi run from assistant-ui thread extras. */
export function piRunStartedAt(extras: unknown): number | undefined {
  if (!extras || typeof extras !== "object" || !("piRun" in extras)) return undefined;
  const piRun = extras.piRun;
  if (!piRun || typeof piRun !== "object" || !("startedAt" in piRun)) return undefined;
  const startedAt = piRun.startedAt;
  return typeof startedAt === "number" && Number.isFinite(startedAt) ? startedAt : undefined;
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
