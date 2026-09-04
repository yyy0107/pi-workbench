import type { DiffLine } from "@workbench/shell/elements";
import type { FileDiffDescriptor } from "@workbench/shell/workspace-files";
export {
  MemoryFileDiffService,
  type FileDiffDescriptor,
  type FileDiffService,
  type FileDiffSnapshot,
} from "@workbench/shell/workspace-files";

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
