import assert from "node:assert/strict";
import test from "node:test";

import { FileWorkspaceTargetService } from "./file-workspace-target-service";

test("publishes the active directory resource and clears it on release", () => {
  const service = new FileWorkspaceTargetService();
  let notifications = 0;
  service.subscribe(() => {
    notifications += 1;
  });

  const release = service.activate({
    scheme: "skill-directory",
    path: "review",
    metadata: { sessionId: "session-1", skillName: "review" },
  });

  assert.deepEqual(service.getSnapshot(), {
    scheme: "skill-directory",
    path: "review",
    metadata: { sessionId: "session-1", skillName: "review" },
  });
  assert.equal(notifications, 1);

  release();
  assert.equal(service.getSnapshot(), undefined);
  assert.equal(notifications, 2);
});

test("does not let an obsolete publisher clear a newer directory resource", () => {
  const service = new FileWorkspaceTargetService();
  const releaseSkill = service.activate({ scheme: "skill-directory", path: "review" });
  const extension = { scheme: "extension-directory", path: "/extensions/review.ts" };
  const releaseExtension = service.activate(extension);

  releaseSkill();
  assert.deepEqual(service.getSnapshot(), extension);

  releaseExtension();
  assert.equal(service.getSnapshot(), undefined);
});

test("rejects resources that cannot be handled as stable opener targets", () => {
  const service = new FileWorkspaceTargetService();

  assert.throws(() => service.activate({ scheme: " ", path: "review" }));
  assert.throws(() => service.activate({ scheme: "skill-directory", path: " " }));
});
