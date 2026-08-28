import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { WorkflowDocument } from "@/runtime/shared/execution";
import { ExecutionRepository } from "./execution-repository";
import { nextScheduledAt, ExecutionTriggerService } from "./execution-trigger-service";

test("computes future cron occurrences using the configured timezone across DST", () => {
  const beforeDst = Date.parse("2026-03-07T15:00:00Z");
  const next = nextScheduledAt(
    {
      id: "morning",
      type: "schedule",
      name: "Morning",
      cron: "0 9 * * *",
      timezone: "America/New_York",
    },
    beforeDst,
  );
  assert.equal(new Date(next).toISOString(), "2026-03-08T13:00:00.000Z");
  assert.ok(next > beforeDst);
});

test("deduplicates repeated internal event IDs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-workflow-trigger-"));
  try {
    const repository = new ExecutionRepository({
      rootDirectory: root,
      listWorkspaces: async () => [],
    });
    const document: WorkflowDocument = {
      schemaVersion: 1,
      id: "automation-1",
      kind: "automation",
      scope: { type: "personal" },
      name: "Automation",
      graph: {
        nodes: [
          { id: "start", type: "start", name: "Start", position: { x: 0, y: 0 }, config: {} },
          { id: "end", type: "end", name: "End", position: { x: 1, y: 0 }, config: {} },
        ],
        edges: [{ id: "edge", source: "start", target: "end" }],
        editor: {},
      },
      concurrency: { mode: "queue" },
      triggers: [
        {
          id: "completed",
          type: "event",
          name: "Session completed",
          event: "workbench.session.completed",
          targetWorkspaceId: "workspace-1",
        },
      ],
      draftRevision: 1,
      publishedRevisionId: "published-1",
      createdAt: 1,
      updatedAt: 1,
    };
    await repository.saveTriggerState({
      workflowId: document.id,
      triggerId: "completed",
      enabled: true,
    });
    const admissions: string[] = [];
    const service = new ExecutionTriggerService({
      repository,
      readWorkflow: async () => document,
      isWorkspaceTrusted: async () => true,
      startRun: async ({ dedupeKey }) => {
        admissions.push(dedupeKey);
        return { kind: "skipped", activeRunId: `run-${admissions.length}` };
      },
    });

    await service.handleInternalEvent("workbench.session.completed", "event-1", {});
    await service.handleInternalEvent("workbench.session.completed", "event-1", {});

    assert.deepEqual(admissions, ["completed:event-1"]);
    service.dispose();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
