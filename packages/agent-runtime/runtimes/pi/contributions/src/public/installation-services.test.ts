import assert from "node:assert/strict";
import test from "node:test";

import { createPiContributionInstallationServices } from "./installation-services";

test("isolates file targets and git review state for installations with the same IDs", async () => {
  const first = createPiContributionInstallationServices();
  const second = createPiContributionInstallationServices();
  const target = { scheme: "skill-directory", path: "review" };
  let firstTargetNotifications = 0;
  let secondTargetNotifications = 0;
  let firstReviewNotifications = 0;
  let secondReviewNotifications = 0;
  first.fileWorkspaceTargets.subscribe(() => {
    firstTargetNotifications += 1;
  });
  second.fileWorkspaceTargets.subscribe(() => {
    secondTargetNotifications += 1;
  });
  first.gitReview.subscribe(() => {
    firstReviewNotifications += 1;
  });
  second.gitReview.subscribe(() => {
    secondReviewNotifications += 1;
  });

  const releaseFirstTarget = first.fileWorkspaceTargets.activate(target);
  first.gitReview.noteChanged("same-repository", "first.ts");

  assert.deepEqual(first.fileWorkspaceTargets.getSnapshot(), target);
  assert.equal(second.fileWorkspaceTargets.getSnapshot(), undefined);
  assert.equal(firstTargetNotifications, 1);
  assert.equal(secondTargetNotifications, 0);
  assert.equal(firstReviewNotifications, 1);
  assert.equal(secondReviewNotifications, 0);
  assert.deepEqual(
    (
      await first.gitReview.getDiff({ repositoryId: "same-repository", scope: "unstaged" })
    ).files.map(({ path }) => path),
    ["first.ts"],
  );
  assert.deepEqual(
    (await second.gitReview.getDiff({ repositoryId: "same-repository", scope: "unstaged" })).files,
    [],
  );

  const releaseSecondTarget = second.fileWorkspaceTargets.activate(target);
  second.gitReview.noteChanged("same-repository", "second.ts");

  assert.equal(firstTargetNotifications, 1);
  assert.equal(secondTargetNotifications, 1);
  assert.equal(firstReviewNotifications, 1);
  assert.equal(secondReviewNotifications, 1);
  assert.deepEqual(
    (
      await first.gitReview.getDiff({ repositoryId: "same-repository", scope: "unstaged" })
    ).files.map(({ path }) => path),
    ["first.ts"],
  );
  assert.deepEqual(
    (
      await second.gitReview.getDiff({ repositoryId: "same-repository", scope: "unstaged" })
    ).files.map(({ path }) => path),
    ["second.ts"],
  );

  first.dispose();
  releaseFirstTarget();
  first.gitReview.noteChanged("same-repository", "late-first.ts");

  assert.equal(first.fileWorkspaceTargets.getSnapshot(), undefined);
  assert.equal(firstTargetNotifications, 1);
  assert.equal(firstReviewNotifications, 1);
  assert.deepEqual(
    (await first.gitReview.getDiff({ repositoryId: "same-repository", scope: "unstaged" })).files,
    [],
  );
  assert.deepEqual(second.fileWorkspaceTargets.getSnapshot(), target);
  assert.deepEqual(
    (
      await second.gitReview.getDiff({ repositoryId: "same-repository", scope: "unstaged" })
    ).files.map(({ path }) => path),
    ["second.ts"],
  );

  releaseSecondTarget();
  second.dispose();
});
