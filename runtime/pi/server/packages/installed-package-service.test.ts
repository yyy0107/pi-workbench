import assert from "node:assert/strict";
import test from "node:test";

import { InstalledPackageService, InstalledPackageServiceError } from "./installed-package-service";

test("lists user and project Pi packages configured for the target session", async () => {
  const requestedSessionIds: string[] = [];
  const service = new InstalledPackageService({
    getSession: async (sessionId) => {
      requestedSessionIds.push(sessionId);
      return {
        session: {
          settingsManager: {
            getGlobalSettings: () => ({
              packages: [
                "npm:pi-review",
                { source: "npm:pi-prompts", prompts: ["review.md"] },
                { source: "npm:pi-no-autoload", autoload: false },
              ],
            }),
            getProjectSettings: () => ({ packages: ["git:github.com/example/pi-tools"] }),
          },
        },
      };
    },
  });

  assert.deepEqual(await service.list({ sessionId: "session-1" }), {
    packages: [
      { source: "npm:pi-review", scope: "user", filtered: false },
      { source: "npm:pi-prompts", scope: "user", filtered: true },
      { source: "npm:pi-no-autoload", scope: "user", filtered: false },
      { source: "git:github.com/example/pi-tools", scope: "project", filtered: false },
    ],
  });
  assert.deepEqual(requestedSessionIds, ["session-1"]);
});

test("translates missing sessions without exposing Pi internals", async () => {
  const service = new InstalledPackageService({
    getSession: async () => {
      throw Object.assign(new Error("private settings path"), { code: "pi_session_not_found" });
    },
  });

  await assert.rejects(service.list({ sessionId: "missing" }), (error: unknown) => {
    assert.ok(error instanceof InstalledPackageServiceError);
    assert.equal(error.code, "session-not-found");
    assert.deepEqual(error.details, { sessionId: "missing" });
    assert.equal(error.message.includes("private settings path"), false);
    return true;
  });
});

test("maps settings failures to a stable internal error", async () => {
  const service = new InstalledPackageService({
    getSession: async () => ({
      session: {
        settingsManager: {
          getGlobalSettings() {
            throw new Error("broken settings file");
          },
          getProjectSettings: () => ({}),
        },
      },
    }),
  });

  await assert.rejects(service.list({ sessionId: "session-1" }), (error: unknown) => {
    assert.ok(error instanceof InstalledPackageServiceError);
    assert.equal(error.code, "internal");
    assert.deepEqual(error.details, {});
    return true;
  });
});

test("installs an official catalog package into the user Pi configuration", async () => {
  const installations: Array<{ sessionId: string; source: string }> = [];
  const service = new InstalledPackageService({
    installUserPackage: async (sessionId, source) => {
      installations.push({ sessionId, source });
    },
  });

  assert.deepEqual(
    await service.install({
      name: "@example/pi-tools",
      target: { scope: "user", sessionId: "session-1" },
    }),
    {
      source: "npm:@example/pi-tools",
      scope: "user",
      reloadRequired: true,
    },
  );
  assert.deepEqual(installations, [{ sessionId: "session-1", source: "npm:@example/pi-tools" }]);
});

test("installs an official catalog package into an imported project", async () => {
  const installations: Array<{ workspacePath: string; source: string }> = [];
  const service = new InstalledPackageService({
    isProjectTrusted: () => true,
    getWorkspace: async (workspaceId) =>
      workspaceId === "workspace-1" ? { path: "/projects/example" } : undefined,
    installProjectPackage: async (workspacePath, source) => {
      installations.push({ workspacePath, source });
    },
  });

  assert.deepEqual(
    await service.install({
      name: "@example/pi-tools",
      target: { scope: "project", workspaceId: "workspace-1" },
    }),
    {
      source: "npm:@example/pi-tools",
      scope: "project",
      workspaceId: "workspace-1",
      reloadRequired: true,
    },
  );
  assert.deepEqual(installations, [
    { workspacePath: "/projects/example", source: "npm:@example/pi-tools" },
  ]);
});

test("rejects project installs while project-local Pi resources are untrusted", async () => {
  const trustChecks: string[] = [];
  const service = new InstalledPackageService({
    getWorkspace: async () => ({ path: "/projects/untrusted" }),
    isProjectTrusted: (workspacePath) => {
      trustChecks.push(workspacePath);
      return false;
    },
  });

  await assert.rejects(
    service.install({
      name: "pi-tools",
      target: { scope: "project", workspaceId: "workspace-1" },
    }),
    (error: unknown) => {
      assert.ok(error instanceof InstalledPackageServiceError);
      assert.equal(error.code, "project-untrusted");
      assert.deepEqual(error.details, { workspaceId: "workspace-1" });
      return true;
    },
  );
  assert.deepEqual(trustChecks, ["/projects/untrusted"]);
});

test("rejects project installs for workspaces that are no longer imported", async () => {
  const service = new InstalledPackageService({
    isProjectTrusted: () => true,
    getWorkspace: async () => undefined,
  });

  await assert.rejects(
    service.install({
      name: "pi-tools",
      target: { scope: "project", workspaceId: "missing-workspace" },
    }),
    (error: unknown) => {
      assert.ok(error instanceof InstalledPackageServiceError);
      assert.equal(error.code, "workspace-not-found");
      assert.deepEqual(error.details, { workspaceId: "missing-workspace" });
      return true;
    },
  );
});

test("translates package installation failures without exposing command output", async () => {
  const service = new InstalledPackageService({
    installUserPackage: async () => {
      throw new Error("private npm stderr and filesystem path");
    },
  });

  await assert.rejects(
    service.install({
      name: "pi-tools",
      target: { scope: "user", sessionId: "session-1" },
    }),
    (error: unknown) => {
      assert.ok(error instanceof InstalledPackageServiceError);
      assert.equal(error.code, "install-failed");
      assert.deepEqual(error.details, { name: "pi-tools", scope: "user" });
      assert.equal(error.message.includes("private npm stderr"), false);
      return true;
    },
  );
});

test("serializes package installations that share Pi user settings", async () => {
  const calls: string[] = [];
  let releaseFirst!: () => void;
  const firstPending = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const service = new InstalledPackageService({
    installUserPackage: async (_sessionId, source) => {
      calls.push(`start:${source}`);
      if (source === "npm:first-package") await firstPending;
      calls.push(`end:${source}`);
    },
  });

  const first = service.install({
    name: "first-package",
    target: { scope: "user", sessionId: "session-1" },
  });
  const second = service.install({
    name: "second-package",
    target: { scope: "user", sessionId: "session-1" },
  });
  await Promise.resolve();
  assert.deepEqual(calls, ["start:npm:first-package"]);

  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(calls, [
    "start:npm:first-package",
    "end:npm:first-package",
    "start:npm:second-package",
    "end:npm:second-package",
  ]);
});
