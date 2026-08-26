import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { ScopedResourceContextService } from "./scoped-resource-context";

test("creates cached user and project resource catalogs without an AgentSession", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-scoped-resources-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const applicationCwd = path.join(root, "application");
  const projectCwd = path.join(root, "project");
  const agentDir = path.join(root, "agent");
  const workspaceLookups: string[] = [];
  const service = new ScopedResourceContextService({
    applicationCwd: () => applicationCwd,
    agentDir: () => agentDir,
    getWorkspace: async (workspaceId) => {
      workspaceLookups.push(workspaceId);
      return workspaceId === "project-1" ? { path: projectCwd } : undefined;
    },
    isProjectTrusted: async (workspacePath) => workspacePath === projectCwd,
  });

  const user = await service.get({ scope: "user" });
  const project = await service.get({ scope: "project", workspaceId: "project-1" });

  assert.equal(user.cwd, applicationCwd);
  assert.equal(user.settingsManager.isProjectTrusted(), false);
  assert.equal(project.cwd, projectCwd);
  assert.equal(project.settingsManager.isProjectTrusted(), true);
  assert.equal(await service.get({ scope: "project", workspaceId: "project-1" }), project);
  assert.deepEqual(workspaceLookups, ["project-1"]);
});

test("rejects an unknown project scope before loading resources", async () => {
  const service = new ScopedResourceContextService({
    getWorkspace: async () => undefined,
  });

  await assert.rejects(
    service.get({ scope: "project", workspaceId: "missing" }),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "workspace-not-found",
  );
});
