import assert from "node:assert/strict";
import test from "node:test";

import { MemoryGitReviewService } from "./git-review-service";

test("keeps review changes isolated between Workbench installations", async () => {
  const first = new MemoryGitReviewService();
  const second = new MemoryGitReviewService();

  first.noteChanged("same-repository", "first.ts");
  second.noteChanged("same-repository", "second.ts");

  assert.deepEqual(
    (await first.getDiff({ repositoryId: "same-repository", scope: "unstaged" })).files.map(
      ({ path }) => path,
    ),
    ["first.ts"],
  );
  assert.deepEqual(
    (await second.getDiff({ repositoryId: "same-repository", scope: "unstaged" })).files.map(
      ({ path }) => path,
    ),
    ["second.ts"],
  );
});
