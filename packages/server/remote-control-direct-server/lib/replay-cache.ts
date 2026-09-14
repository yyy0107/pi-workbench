export interface DirectReplayCache {
  consume(key: string, expiresAt: Date): boolean;
  clear(): void;
}

export function createDirectReplayCache(options: {
  readonly now: () => Date;
  readonly maximumEntries: number;
}): DirectReplayCache {
  const entries = new Map<string, number>();

  const prune = (): void => {
    const now = options.now().getTime();
    for (const [key, expiresAt] of entries) {
      if (expiresAt <= now) entries.delete(key);
    }
    while (entries.size >= options.maximumEntries) {
      const oldest = entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  };

  return {
    consume(key, expiresAt): boolean {
      prune();
      if (entries.has(key) || expiresAt.getTime() <= options.now().getTime()) return false;
      entries.set(key, expiresAt.getTime());
      return true;
    },
    clear(): void {
      entries.clear();
    },
  };
}
