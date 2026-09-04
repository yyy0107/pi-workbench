const FORK_TITLE_SUFFIX = /^(.*) \(([1-9]\d*)\)$/u;

function splitForkTitle(title: string): { base: string; index: number } {
  const normalized = title.trim();
  const match = FORK_TITLE_SUFFIX.exec(normalized);
  if (!match) return { base: normalized, index: 0 };

  const index = Number(match[2]);
  if (!Number.isSafeInteger(index)) return { base: normalized, index: 0 };
  return { base: match[1]!, index };
}

export function nextForkTitle(sourceTitle: string, existingTitles: readonly string[]): string {
  const source = splitForkTitle(sourceTitle);
  let highestIndex = source.index;

  for (const title of existingTitles) {
    const candidate = splitForkTitle(title);
    if (candidate.base === source.base) highestIndex = Math.max(highestIndex, candidate.index);
  }

  return `${source.base} (${highestIndex + 1})`;
}
