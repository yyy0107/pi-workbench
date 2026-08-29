import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { AutomationDefinition } from "@/runtime/shared/automation";
import { AutomationRepository } from "./automation-repository";
import { AutomationService } from "./automation-service";

test("runNow creates an ordinary session reference without a workflow run", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-automation-service-"));
  const launches: Array<{
    automation: AutomationDefinition;
    workspaceId: string;
    source: string;
  }> = [];
  const service = new AutomationService({
    repository: new AutomationRepository({ rootDirectory: root }),
    resolveWorkspace: async (workspaceId) => ({ workspaceId, path: "/projects/example" }),
    isWorkspaceTrusted: () => true,
    async launch(automation, workspace, source) {
      launches.push({ automation, workspaceId: workspace.workspaceId, source });
      return "session-1";
    },
  });
  try {
    const saved = await service.save({
      name: "Daily review",
      prompt: "Review this project",
      workspaceId: "workspace-1",
      model: { provider: "openai", model: "gpt-5", reasoningEffort: "high" },
      schedule: { cron: "0 9 * * 1-5", timezone: "UTC" },
      enabled: false,
    });
    const launched = await service.runNow({ automationId: saved.automation.id });

    assert.deepEqual(launched, {
      automationId: saved.automation.id,
      sessionId: "session-1",
      source: "manual",
      triggeredAt: launched.triggeredAt,
    });
    assert.equal(launches.length, 1);
    assert.equal(launches[0]?.workspaceId, "workspace-1");
    assert.equal(launches[0]?.source, "manual");
    assert.deepEqual(launches[0]?.automation.model, {
      provider: "openai",
      model: "gpt-5",
      reasoningEffort: "high",
    });
    assert.deepEqual(await service.sessions({ automationId: saved.automation.id }), {
      items: [{ sessionId: "session-1", source: "manual", triggeredAt: launched.triggeredAt }],
    });
  } finally {
    service.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects an enabled automation before persisting an untrusted workspace", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-automation-untrusted-"));
  const repository = new AutomationRepository({ rootDirectory: root });
  const service = new AutomationService({
    repository,
    resolveWorkspace: async (workspaceId) => ({ workspaceId, path: "/projects/untrusted" }),
    isWorkspaceTrusted: () => false,
    launch: async () => "unexpected-session",
  });
  try {
    await assert.rejects(
      service.save({
        name: "Daily review",
        prompt: "Review this project",
        workspaceId: "workspace-1",
        schedule: { cron: "0 9 * * *", timezone: "UTC" },
        enabled: true,
      }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "automation-workspace-not-trusted",
    );
    assert.deepEqual(await repository.list(), []);
  } finally {
    service.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("removes a settled session reference without deleting its linked conversation", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-automation-remove-session-"));
  let running = true;
  let cancellations = 0;
  const service = new AutomationService({
    repository: new AutomationRepository({ rootDirectory: root }),
    resolveWorkspace: async (workspaceId) => ({ workspaceId, path: "/projects/example" }),
    isWorkspaceTrusted: () => true,
    isSessionRunning: () => running,
    launch: async () => "session-1",
    cancel: async () => {
      cancellations += 1;
    },
  });
  try {
    const saved = await service.save({
      name: "Daily review",
      prompt: "Review this project",
      workspaceId: "workspace-1",
      schedule: { cron: "0 9 * * *", timezone: "UTC" },
      enabled: false,
    });
    await service.runNow({ automationId: saved.automation.id });

    await assert.rejects(
      service.removeSession({ automationId: saved.automation.id, sessionId: "session-1" }),
      (error: unknown) =>
        error instanceof Error && "code" in error && error.code === "automation-session-active",
    );
    assert.equal((await service.sessions({ automationId: saved.automation.id })).items.length, 1);

    running = false;
    assert.deepEqual(
      await service.removeSession({ automationId: saved.automation.id, sessionId: "session-1" }),
      { automationId: saved.automation.id, sessionId: "session-1", removed: true },
    );
    const updated = await service.read({ automationId: saved.automation.id });
    assert.deepEqual(updated.automation.sessions, []);
    assert.equal(updated.automation.lastSessionId, undefined);
    assert.equal(updated.automation.lastTriggeredAt, undefined);
    assert.equal(cancellations, 0);
    assert.deepEqual(
      await service.removeSession({ automationId: saved.automation.id, sessionId: "session-1" }),
      { automationId: saved.automation.id, sessionId: "session-1", removed: false },
    );
  } finally {
    service.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
