import assert from "node:assert/strict";
import test from "node:test";
import type { WorkbenchWorkspaceCapability } from "@workbench/agent-runtime-client/capabilities";
import { gitApplyCommand, readReviewPatch, reviewWordRanges } from "./review-options";

test("word ranges preserve offsets and copy exports complete literal patches", async () => {
  const words = reviewWordRanges([
    { kind: "removed", text: "const value = '旧词';" },
    { kind: "added", text: "const value = '新词';" },
  ]);
  assert.equal("const value = '旧词';".slice(...words.get(0)![0]), "旧");
  assert.equal("const value = '新词';".slice(...words.get(1)![0]), "新");
  const spaced = reviewWordRanges([
    { kind: "removed", text: "a b" },
    { kind: "added", text: "a  b" },
  ]);
  assert.ok(spaced.get(1)!.length);
  const literal = "WORKBENCH_REVIEW_PATCH\n$(touch /never-execute)\n`echo do-not-run`\n";
  const command = gitApplyCommand(literal);
  assert.ok(command.startsWith("git apply --binary <<'WORKBENCH_REVIEW_PATCH_'\n"));
  assert.ok(command.endsWith("WORKBENCH_REVIEW_PATCH_"));
  assert.ok(command.includes(literal));
  const requests: unknown[] = [];
  const workspace = {
    readGitDiff: async (request: { offset: number }) => {
      requests.push(request);
      return {
        repository: true,
        branches: [],
        files: [],
        patch: request.offset ? "tail\n" : "head\n",
        patchVersion: "version",
        ...(request.offset ? {} : { nextOffset: 5 }),
      };
    },
  } as unknown as WorkbenchWorkspaceCapability;
  assert.equal(
    await readReviewPatch(
      workspace,
      { workspaceId: "w", scope: "session", sessionId: "s", fullContext: true },
      new AbortController().signal,
    ),
    "head\ntail\n",
  );
  assert.deepEqual(
    requests.map((request) => {
      const value = request as Record<string, unknown>;
      return [value.exportPatch, value.fullContext, value.offset, value.patchVersion];
    }),
    [
      [true, false, 0, undefined],
      [true, false, 5, "version"],
    ],
  );
});
