import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { ExecutionRepository } from "./execution-repository";
import { ExecutionService } from "./execution-service";

test("persists automations with independent execution semantics", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-execution-service-automation-"));
  try {
    const repository = new ExecutionRepository({
      rootDirectory: root,
      listWorkspaces: async () => [],
    });
    const service = new ExecutionService({
      repository,
      isWorkspaceTrusted: () => true,
    });
    const created = await service.create({
      kind: "automation",
      scope: { type: "personal" },
      name: "Automation",
    });
    assert.deepEqual(created.document.concurrency, { mode: "independent" });

    const migrated = await service.saveDraft({
      workflowId: created.document.id,
      baseDraftRevision: created.document.draftRevision,
      draft: { ...created.document, concurrency: { mode: "queue" } },
    });
    assert.deepEqual(migrated.document.concurrency, { mode: "independent" });
    assert.deepEqual((await repository.readDocument(created.document.id)).concurrency, {
      mode: "independent",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
