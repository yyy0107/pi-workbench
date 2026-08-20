interface ThreadTimingMessage {
  role: string;
  createdAt: Date;
  metadata?: {
    timing?: {
      streamStartTime: number;
    };
  };
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

    if (message.role === "user") {
      const candidate = message.createdAt.getTime();
      if (Number.isFinite(candidate)) return candidate;
    }
  }

  return assistantStreamStartedAt;
}
