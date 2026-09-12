import { diffWordsWithSpace } from "diff";
import type { DiffLine } from "../../../elements/code-diff";
import type { WorkbenchWorkspaceCapability } from "@workbench/agent-runtime-client/capabilities";
import type { WorkbenchWorkspaceGitDiffRequest } from "@workbench/agent-runtime-contracts/runtime-capabilities";

export interface ReviewDisplayOptions {
  wrap: boolean;
  fullFile: boolean;
  richText: boolean;
  wordDiff: boolean;
  whitespace: boolean;
}
export const defaultReviewDisplayOptions: ReviewDisplayOptions = {
  wrap: false,
  fullFile: true,
  richText: true,
  wordDiff: false,
  whitespace: true,
};
export type WordRange = readonly [start: number, end: number];

export function reviewWordRanges(
  lines: readonly DiffLine[],
): ReadonlyMap<number, readonly WordRange[]> {
  const ranges = new Map<number, WordRange[]>();
  for (let index = 0; index < lines.length;) {
    if (lines[index].kind === "context") {
      index++;
      continue;
    }
    const removed: number[] = [],
      added: number[] = [];
    while (index < lines.length && lines[index].kind !== "context") {
      (lines[index].kind === "removed" ? removed : added).push(index++);
    }
    for (let pair = 0; pair < Math.min(removed.length, added.length); pair++) {
      const oldIndex = removed[pair],
        newIndex = added[pair];
      const oldText = lines[oldIndex].text,
        newText = lines[newIndex].text;
      // ponytail: bound expensive word matching; retain whole-line emphasis when a pair exceeds the budget.
      const changes =
        oldText.length + newText.length <= 20_000
          ? diffWordsWithSpace(oldText, newText, { maxEditLength: 1_000, timeout: 20 })
          : undefined;
      if (!changes) {
        ranges.set(oldIndex, [[0, oldText.length]]);
        ranges.set(newIndex, [[0, newText.length]]);
        continue;
      }
      let oldOffset = 0,
        newOffset = 0;
      const oldRanges: WordRange[] = [],
        newRanges: WordRange[] = [];
      for (const change of changes) {
        if (change.removed) oldRanges.push([oldOffset, oldOffset + change.value.length]);
        if (change.added) newRanges.push([newOffset, newOffset + change.value.length]);
        if (!change.added) oldOffset += change.value.length;
        if (!change.removed) newOffset += change.value.length;
      }
      ranges.set(oldIndex, oldRanges);
      ranges.set(newIndex, newRanges);
    }
  }
  return ranges;
}

export function gitApplyCommand(patch: string): string {
  let delimiter = "WORKBENCH_REVIEW_PATCH";
  const lines = new Set(patch.split("\n"));
  while (lines.has(delimiter)) delimiter += "_";
  return `git apply --binary <<'${delimiter}'\n${patch}${patch.endsWith("\n") ? "" : "\n"}${delimiter}`;
}

export async function readReviewPatch(
  workspace: WorkbenchWorkspaceCapability,
  request: WorkbenchWorkspaceGitDiffRequest,
  signal: AbortSignal,
): Promise<string> {
  if (!workspace.readGitDiff) throw new Error("Review unavailable");
  let offset = 0,
    patchVersion: string | undefined;
  const parts: string[] = [];
  do {
    const page = await workspace.readGitDiff(
      { ...request, path: undefined, fullContext: false, exportPatch: true, offset, patchVersion },
      { signal },
    );
    if (!page.repository || page.unrecorded || page.patch === undefined)
      throw new Error("Review unavailable");
    parts.push(page.patch);
    patchVersion = page.patchVersion;
    if (page.nextOffset === undefined) break;
    if (page.nextOffset <= offset) throw new Error("Invalid review page");
    offset = page.nextOffset;
  } while (!signal.aborted);
  signal.throwIfAborted();
  return parts.join("");
}
