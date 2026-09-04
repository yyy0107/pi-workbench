import type { DiffLine } from "../elements";

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
