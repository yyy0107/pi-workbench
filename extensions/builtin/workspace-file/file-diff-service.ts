import type { DiffLine } from "@/components/elements/code-diff";

export interface FileDiffDescriptor {
  id: string;
  lines: readonly DiffLine[];
}

export interface FileDiffSnapshot extends FileDiffDescriptor {
  path: string;
  additions: number;
  deletions: number;
  cycle: number;
}

export interface FileDiffService {
  get(diffId: string): FileDiffSnapshot | undefined;
  upsert(path: string, descriptor: FileDiffDescriptor): FileDiffSnapshot;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseDiffLines(value: unknown): DiffLine[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const lines: DiffLine[] = [];
  for (const candidate of value) {
    const line = asRecord(candidate);
    if (
      !line ||
      (line.kind !== "context" && line.kind !== "added" && line.kind !== "removed") ||
      typeof line.text !== "string"
    ) {
      return undefined;
    }
    lines.push({ kind: line.kind, text: line.text });
  }
  return lines;
}

export function parseFileDiffMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
): FileDiffDescriptor | undefined {
  if (metadata?.viewMode !== "diff") return undefined;

  const id = typeof metadata.diffId === "string" ? metadata.diffId.trim() : "";
  const lines = parseDiffLines(metadata.lines);
  if (!id || !lines) return undefined;

  return { id, lines };
}

export class MemoryFileDiffService implements FileDiffService {
  readonly #diffs = new Map<string, FileDiffSnapshot>();
  #cycle = 0;

  get(diffId: string): FileDiffSnapshot | undefined {
    return this.#diffs.get(diffId);
  }

  upsert(path: string, descriptor: FileDiffDescriptor): FileDiffSnapshot {
    let additions = 0;
    let deletions = 0;
    for (const line of descriptor.lines) {
      if (line.kind === "added") additions += 1;
      if (line.kind === "removed") deletions += 1;
    }

    const snapshot: FileDiffSnapshot = {
      ...descriptor,
      path,
      additions,
      deletions,
      cycle: ++this.#cycle,
    };
    this.#diffs.set(descriptor.id, snapshot);
    return snapshot;
  }
}

export const fileDiffService = new MemoryFileDiffService();
