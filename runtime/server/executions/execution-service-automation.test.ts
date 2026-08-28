import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { MIN_SCHEDULE_RUN_DURATION_SECONDS } from "@/runtime/shared/execution";
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

test("applies a schedule duration only when that schedule triggers a run", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-execution-service-timeout-"));
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
    const saved = await service.saveDraft({
      workflowId: created.document.id,
      baseDraftRevision: created.document.draftRevision,
      draft: {
        ...created.document,
        triggers: [
          {
            id: "schedule",
            type: "schedule",
            name: "Schedule",
            cron: "0 9 * * *",
            timezone: "UTC",
            maxRunDurationSeconds: MIN_SCHEDULE_RUN_DURATION_SECONDS,
          },
        ],
      },
    });
    const published = await service.publish({
      workflowId: saved.document.id,
      baseDraftRevision: saved.document.draftRevision,
    });
    let observedDuration: number | undefined;
    service.engine.start = async (input) => {
      observedDuration = input.maxRunDurationSeconds;
      return { kind: "skipped", activeRunId: "stub-run" };
    };

    await service.startRun({
      workflowId: published.document.id,
      revisionSource: "published",
      source: "schedule",
      triggerId: "schedule",
    });
    assert.equal(observedDuration, MIN_SCHEDULE_RUN_DURATION_SECONDS);

    observedDuration = undefined;
    await service.startRun({
      workflowId: published.document.id,
      revisionSource: "published",
      source: "manual",
    });
    assert.equal(observedDuration, undefined);
    service.triggers.dispose();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
