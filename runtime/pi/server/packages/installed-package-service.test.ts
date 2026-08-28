import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { PiPackageUpdatesValue } from "@/runtime/pi/contracts/rpc";

import {
  InstalledPackageService,
  InstalledPackageServiceError,
  packageUpdateInstallSource,
  parseInstalledPackageDetails,
  updateConfiguredPackage,
} from "./installed-package-service";

test("parses installed package details from the downloaded package.json snapshot", () => {
  const details = parseInstalledPackageDetails(
    JSON.stringify({
      name: "pi-mcp-adapter",
      version: "2.28.0",
      description: "MCP adapter for Pi",
      author: { name: "Nico Bailon", email: "private@example.com" },
      license: "MIT",
      pi: {
        extensions: ["./index.ts"],
        skills: ["./skills"],
        video: "https://example.com/demo.mp4",
      },
      dependencies: { first: "1.0.0", second: "2.0.0" },
      peerDependencies: { pi: "^0.84.0" },
      scripts: { postinstall: "private command" },
    }),
    { source: "npm:pi-mcp-adapter", scope: "project" },
  );

  assert.deepEqual(details, {
    source: "npm:pi-mcp-adapter",
    scope: "project",
    name: "pi-mcp-adapter",
    version: "2.28.0",
    description: "MCP adapter for Pi",
    author: "Nico Bailon",
    license: "MIT",
    types: ["extension", "skill"],
    dependencyCount: 2,
    peerDependencyCount: 1,
    manifestJson: JSON.stringify(
      {
        extensions: ["./index.ts"],
        skills: ["./skills"],
        video: "https://example.com/demo.mp4",
      },
      null,
      2,
    ),
  });
  assert.equal(details.manifestJson?.includes("postinstall"), false);
  assert.equal(details.author?.includes("private@example.com"), false);
});

test("installs the exact server-resolved npm target version", () => {
  const target = { type: "npm" as const, version: "0.26.0" };
  assert.equal(packageUpdateInstallSource("npm:pi-web-access", target), "npm:pi-web-access@0.26.0");
  assert.equal(
    packageUpdateInstallSource("npm:@example/pi-tools", target),
    "npm:@example/pi-tools@0.26.0",
  );
  assert.equal(packageUpdateInstallSource("npm:pi-tools@^2", target), "npm:pi-tools@0.26.0");
  assert.equal(
    packageUpdateInstallSource("npm:@example/pi-tools@next", target),
    "npm:@example/pi-tools@0.26.0",
  );
  assert.equal(
    packageUpdateInstallSource("git:github.com/example/pi-tools", {
      type: "git",
      revision: "1".repeat(40),
    }),
    "git:github.com/example/pi-tools",
  );
});

test("installs and verifies the exact npm version resolved by the server", async (t) => {
  const installedPath = await mkdtemp(join(tmpdir(), "workbench-package-update-install-"));
  t.after(() => rm(installedPath, { recursive: true, force: true }));
  const packageJsonPath = join(installedPath, "package.json");
  await writeFile(packageJsonPath, JSON.stringify({ version: "0.25.0" }));
  const installations: Array<{ source: string; local?: boolean }> = [];

  const updated = await updateConfiguredPackage(
    {
      getInstalledPath: () => installedPath,
      install: async (source, options) => {
        installations.push({ source, ...options });
        await writeFile(packageJsonPath, JSON.stringify({ version: "0.26.0" }));
      },
    },
    { packages: [{ source: "npm:pi-web-access", extensions: ["index.ts"] }] },
    "npm:pi-web-access",
    "project",
    { type: "npm", version: "0.26.0" },
    { local: true },
  );

  assert.equal(updated, true);
  assert.deepEqual(installations, [{ source: "npm:pi-web-access@0.26.0", local: true }]);
  assert.deepEqual(JSON.parse(await readFile(packageJsonPath, "utf8")), { version: "0.26.0" });
});

test("rejects an npm update when the installed version does not match the target", async (t) => {
  const installedPath = await mkdtemp(join(tmpdir(), "workbench-package-update-unchanged-"));
  t.after(() => rm(installedPath, { recursive: true, force: true }));
  await writeFile(join(installedPath, "package.json"), JSON.stringify({ version: "0.25.0" }));

  await assert.rejects(
    updateConfiguredPackage(
      {
        getInstalledPath: () => installedPath,
        install: async () => undefined,
      },
      { packages: ["npm:pi-web-access"] },
      "npm:pi-web-access",
      "project",
      { type: "npm", version: "0.26.0" },
      { local: true },
    ),
    /does not match the requested update target/,
  );
});

test("rejects an update that installs a different version than the requested target", async (t) => {
  const installedPath = await mkdtemp(join(tmpdir(), "workbench-package-update-pending-"));
  t.after(() => rm(installedPath, { recursive: true, force: true }));
  const packageJsonPath = join(installedPath, "package.json");
  await writeFile(packageJsonPath, JSON.stringify({ version: "0.25.0" }));

  await assert.rejects(
    updateConfiguredPackage(
      {
        getInstalledPath: () => installedPath,
        install: async () => {
          await writeFile(packageJsonPath, JSON.stringify({ version: "0.25.1" }));
        },
      },
      { packages: ["npm:pi-web-access"] },
      "npm:pi-web-access",
      "project",
      { type: "npm", version: "0.26.0" },
      { local: true },
    ),
    /does not match the requested update target/,
  );
});

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

test("lists only the requested Toolbox package scope without resolving a session", async () => {
  const requestedTargets: unknown[] = [];
  const service = new InstalledPackageService({
    getSession: async () => {
      throw new Error("Toolbox catalogs must not resolve sessions");
    },
    getScopedResourceHost: async (target) => {
      requestedTargets.push(target);
      return {
        session: {
          settingsManager: {
            getGlobalSettings: () => ({ packages: ["npm:user-tools"] }),
            getProjectSettings: () => ({ packages: ["npm:project-tools"] }),
          },
        },
      };
    },
  });

  assert.deepEqual(await service.list({ target: { scope: "user" } }), {
    packages: [{ source: "npm:user-tools", scope: "user", filtered: false }],
  });
  assert.deepEqual(requestedTargets, [{ scope: "user" }]);
});

test("describes the installed package snapshot for the exact Toolbox source and scope", async () => {
  const requests: unknown[] = [];
  const service = new InstalledPackageService({
    describeInstalledPackage: async (request) => {
      requests.push(request);
      return {
        source: request.source,
        scope: request.target.scope,
        name: "pi-mcp-adapter",
        version: "2.28.0",
        types: ["extension", "skill"],
        dependencyCount: 14,
        peerDependencyCount: 4,
      };
    },
  });

  const request = {
    source: "npm:pi-mcp-adapter",
    target: { scope: "project" as const, workspaceId: "workspace-1" },
  };
  assert.deepEqual(await service.describe(request), {
    source: "npm:pi-mcp-adapter",
    scope: "project",
    name: "pi-mcp-adapter",
    version: "2.28.0",
    types: ["extension", "skill"],
    dependencyCount: 14,
    peerDependencyCount: 4,
  });
  assert.deepEqual(requests, [request]);
});

test("checks the downloaded packages in the requested Toolbox scope for available updates", async () => {
  const requests: unknown[] = [];
  const service = new InstalledPackageService({
    checkAvailablePackageUpdates: async (request) => {
      requests.push(request);
      return {
        updates: [
          {
            source: "npm:pi-review",
            displayName: "pi-review",
            type: "npm",
            scope: "user",
            filtered: false,
          },
        ],
      };
    },
  });

  assert.deepEqual(await service.updates({ target: { scope: "user" } }), {
    updates: [
      {
        source: "npm:pi-review",
        displayName: "pi-review",
        type: "npm",
        scope: "user",
        filtered: false,
      },
    ],
  });
  assert.deepEqual(requests, [{ target: { scope: "user" } }]);
});

test("coalesces concurrent update checks for the same Toolbox scope", async () => {
  let resolveUpdates!: (value: PiPackageUpdatesValue) => void;
  const pendingUpdates = new Promise<PiPackageUpdatesValue>((resolve) => {
    resolveUpdates = resolve;
  });
  let checks = 0;
  const service = new InstalledPackageService({
    checkAvailablePackageUpdates: async () => {
      checks += 1;
      return pendingUpdates;
    },
  });

  const first = service.updates({ target: { scope: "project", workspaceId: "workspace-1" } });
  const second = service.updates({ target: { scope: "project", workspaceId: "workspace-1" } });

  assert.equal(checks, 1);
  resolveUpdates({ updates: [] });
  assert.deepEqual(await Promise.all([first, second]), [{ updates: [] }, { updates: [] }]);
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

test("installs a user package without resolving a Pi session", async () => {
  const installations: Array<{ sessionId: string | undefined; source: string }> = [];
  const service = new InstalledPackageService({
    installUserPackage: async (sessionId, source) => {
      installations.push({ sessionId, source });
    },
  });

  assert.deepEqual(
    await service.install({
      name: "@example/pi-tools",
      target: { scope: "user" },
    }),
    {
      source: "npm:@example/pi-tools",
      scope: "user",
      reloadRequired: false,
    },
  );
  assert.deepEqual(installations, [{ sessionId: undefined, source: "npm:@example/pi-tools" }]);
});

test("reloads affected sessions after installing a user Pi package", async () => {
  const reloaded: string[] = [];
  const service = new InstalledPackageService({
    getLoadedSessions: () => [
      {
        id: "session-1",
        isRunning: false,
        session: {
          sessionManager: { getCwd: () => "/projects/example" },
          reload: async () => {
            reloaded.push("session-1");
          },
        },
      },
    ],
    installUserPackage: async () => undefined,
  });

  await service.install({
    name: "@example/pi-tools",
    target: { scope: "user", sessionId: "session-1" },
  });

  assert.deepEqual(reloaded, ["session-1"]);
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
      reloadRequired: false,
    },
  );
  assert.deepEqual(installations, [
    { workspacePath: "/projects/example", source: "npm:@example/pi-tools" },
  ]);
});

test("updates a configured user package and reloads every affected session", async () => {
  const lifecycle: string[] = [];
  const service = new InstalledPackageService({
    getLoadedSessions: () => [
      {
        id: "session-1",
        isRunning: false,
        session: {
          sessionManager: { getCwd: () => "/projects/example" },
          reload: async () => {
            lifecycle.push("reload:session-1");
          },
        },
      },
      {
        id: "session-2",
        isRunning: false,
        session: {
          sessionManager: { getCwd: () => "/projects/other" },
          reload: async () => {
            lifecycle.push("reload:session-2");
          },
        },
      },
    ],
    updateUserPackage: async (sessionId, source) => {
      lifecycle.push(`update:${sessionId ?? "none"}:${source}`);
      return true;
    },
    reloadScopedResources: async (target) => {
      lifecycle.push(`catalog:${target.scope}`);
    },
  });

  assert.deepEqual(
    await service.update({
      source: "npm:@example/pi-tools",
      target: { scope: "user" },
    }),
    {
      source: "npm:@example/pi-tools",
      scope: "user",
      reloadRequired: false,
    },
  );
  assert.deepEqual(lifecycle, [
    "update:none:npm:@example/pi-tools",
    "reload:session-1",
    "reload:session-2",
    "catalog:user",
  ]);
});

test("updates only the selected imported project package scope", async () => {
  const lifecycle: string[] = [];
  const service = new InstalledPackageService({
    getWorkspace: async () => ({ path: "/projects/example" }),
    isProjectTrusted: () => true,
    getLoadedSessions: () => [
      {
        id: "project-session",
        isRunning: false,
        session: {
          sessionManager: { getCwd: () => "/projects/example" },
          reload: async () => {
            lifecycle.push("reload:project-session");
          },
        },
      },
      {
        id: "other-session",
        isRunning: false,
        session: {
          sessionManager: { getCwd: () => "/projects/other" },
          reload: async () => {
            lifecycle.push("reload:other-session");
          },
        },
      },
    ],
    updateProjectPackage: async (workspacePath, source) => {
      lifecycle.push(`update:${workspacePath}:${source}`);
      return true;
    },
    reloadScopedResources: async (target) => {
      lifecycle.push(target.scope === "project" ? `catalog:${target.workspaceId}` : "catalog:user");
    },
  });

  assert.deepEqual(
    await service.update({
      source: "git:github.com/example/pi-tools",
      target: { scope: "project", workspaceId: "workspace-1" },
    }),
    {
      source: "git:github.com/example/pi-tools",
      scope: "project",
      workspaceId: "workspace-1",
      reloadRequired: false,
    },
  );
  assert.deepEqual(lifecycle, [
    "update:/projects/example:git:github.com/example/pi-tools",
    "reload:project-session",
    "catalog:workspace-1",
  ]);
});

test("reports a stable error when an update target is no longer configured", async () => {
  const service = new InstalledPackageService({
    updateUserPackage: async () => false,
  });

  await assert.rejects(
    service.update({
      source: "npm:pi-tools",
      target: { scope: "user" },
    }),
    (error: unknown) => {
      assert.ok(error instanceof InstalledPackageServiceError);
      assert.equal(error.code, "package-not-installed");
      assert.deepEqual(error.details, { source: "npm:pi-tools", scope: "user" });
      return true;
    },
  );
});

test("reports update-failed when the package manager cannot prove the update was applied", async () => {
  const service = new InstalledPackageService({
    updateUserPackage: async () => {
      throw new Error("The installed package does not match the requested update target.");
    },
  });

  await assert.rejects(
    service.update({
      source: "npm:pi-web-access",
      target: { scope: "user" },
    }),
    (error: unknown) => {
      assert.ok(error instanceof InstalledPackageServiceError);
      assert.equal(error.code, "update-failed");
      assert.deepEqual(error.details, { source: "npm:pi-web-access", scope: "user" });
      assert.equal(error.message.includes("requested update target"), false);
      return true;
    },
  );
});

test("rejects package updates before writing when an affected session is running", async () => {
  let updateAttempted = false;
  const service = new InstalledPackageService({
    getLoadedSessions: () => [
      {
        id: "session-busy",
        isRunning: true,
        session: {
          sessionManager: { getCwd: () => "/projects/example" },
          reload: async () => undefined,
        },
      },
    ],
    updateUserPackage: async () => {
      updateAttempted = true;
      return true;
    },
  });

  await assert.rejects(
    service.update({
      source: "npm:pi-tools",
      target: { scope: "user" },
    }),
    (error: unknown) => {
      assert.ok(error instanceof InstalledPackageServiceError);
      assert.equal(error.code, "session-busy");
      assert.deepEqual(error.details, { sessionId: "session-busy" });
      return true;
    },
  );
  assert.equal(updateAttempted, false);
});

test("removes a user package without resolving a Pi session", async () => {
  const removals: Array<{ sessionId: string | undefined; source: string }> = [];
  const service = new InstalledPackageService({
    prepareUserPackageRemoval: async (sessionId, source) => async () => {
      removals.push({ sessionId, source });
    },
  });

  assert.deepEqual(
    await service.remove({
      source: "npm:@example/pi-tools",
      target: { scope: "user" },
    }),
    {
      source: "npm:@example/pi-tools",
      scope: "user",
      reloadRequired: false,
    },
  );
  assert.deepEqual(removals, [{ sessionId: undefined, source: "npm:@example/pi-tools" }]);
});

test("reloads every loaded session before deleting a user Pi package", async () => {
  const lifecycle: string[] = [];
  const service = new InstalledPackageService({
    getLoadedSessions: () => [
      {
        id: "session-1",
        isRunning: false,
        session: {
          sessionManager: { getCwd: () => "/projects/one" },
          reload: async () => {
            lifecycle.push("reload:session-1");
          },
        },
      },
      {
        id: "session-2",
        isRunning: false,
        session: {
          sessionManager: { getCwd: () => "/projects/two" },
          reload: async () => {
            lifecycle.push("reload:session-2");
          },
        },
      },
    ],
    prepareUserPackageRemoval: async () => {
      lifecycle.push("configuration-removed");
      return async () => {
        lifecycle.push("files-removed");
      };
    },
  });

  await service.remove({
    source: "npm:@example/pi-tools",
    target: { scope: "user", sessionId: "session-1" },
  });

  assert.deepEqual(lifecycle, [
    "configuration-removed",
    "reload:session-1",
    "reload:session-2",
    "files-removed",
  ]);
});

test("removes a configured package from an imported project", async () => {
  const removals: Array<{ workspacePath: string; source: string }> = [];
  const service = new InstalledPackageService({
    isProjectTrusted: () => true,
    getWorkspace: async (workspaceId) =>
      workspaceId === "workspace-1" ? { path: "/projects/example" } : undefined,
    prepareProjectPackageRemoval: async (workspacePath, source) => async () => {
      removals.push({ workspacePath, source });
    },
  });

  assert.deepEqual(
    await service.remove({
      source: "git:github.com/example/pi-tools",
      target: { scope: "project", workspaceId: "workspace-1" },
    }),
    {
      source: "git:github.com/example/pi-tools",
      scope: "project",
      workspaceId: "workspace-1",
      reloadRequired: false,
    },
  );
  assert.deepEqual(removals, [
    { workspacePath: "/projects/example", source: "git:github.com/example/pi-tools" },
  ]);
});

test("reloads only sessions from the affected project after removing a project Pi package", async () => {
  const reloaded: string[] = [];
  const service = new InstalledPackageService({
    getWorkspace: async () => ({ path: "/projects/example" }),
    getLoadedSessions: () => [
      {
        id: "project-session",
        isRunning: false,
        session: {
          sessionManager: { getCwd: () => "/projects/example" },
          reload: async () => {
            reloaded.push("project-session");
          },
        },
      },
      {
        id: "other-session",
        isRunning: false,
        session: {
          sessionManager: { getCwd: () => "/projects/other" },
          reload: async () => {
            reloaded.push("other-session");
          },
        },
      },
    ],
    isProjectTrusted: () => true,
    prepareProjectPackageRemoval: async () => async () => undefined,
  });

  await service.remove({
    source: "git:github.com/example/pi-tools",
    target: { scope: "project", workspaceId: "workspace-1" },
  });

  assert.deepEqual(reloaded, ["project-session"]);
});

test("rejects package removal before persistence when an affected session is running", async () => {
  let removalAttempted = false;
  const service = new InstalledPackageService({
    getLoadedSessions: () => [
      {
        id: "session-busy",
        isRunning: true,
        session: {
          sessionManager: { getCwd: () => "/projects/example" },
          reload: async () => undefined,
        },
      },
    ],
    prepareUserPackageRemoval: async () => {
      removalAttempted = true;
      return async () => undefined;
    },
  });

  await assert.rejects(
    service.remove({
      source: "npm:pi-tools",
      target: { scope: "user", sessionId: "session-1" },
    }),
    (error: unknown) => {
      assert.ok(error instanceof InstalledPackageServiceError);
      assert.equal(error.code, "session-busy");
      assert.deepEqual(error.details, { sessionId: "session-busy" });
      return true;
    },
  );
  assert.equal(removalAttempted, false);
});

test("reports a stable error when the package is no longer configured", async () => {
  const service = new InstalledPackageService({
    prepareUserPackageRemoval: async () => undefined,
  });

  await assert.rejects(
    service.remove({
      source: "npm:pi-tools",
      target: { scope: "user", sessionId: "session-1" },
    }),
    (error: unknown) => {
      assert.ok(error instanceof InstalledPackageServiceError);
      assert.equal(error.code, "package-not-installed");
      assert.deepEqual(error.details, { source: "npm:pi-tools", scope: "user" });
      return true;
    },
  );
});

test("rejects project removals while project-local Pi resources are untrusted", async () => {
  const service = new InstalledPackageService({
    getWorkspace: async () => ({ path: "/projects/untrusted" }),
    isProjectTrusted: () => false,
  });

  await assert.rejects(
    service.remove({
      source: "npm:pi-tools",
      target: { scope: "project", workspaceId: "workspace-1" },
    }),
    (error: unknown) => {
      assert.ok(error instanceof InstalledPackageServiceError);
      assert.equal(error.code, "project-untrusted");
      assert.deepEqual(error.details, { workspaceId: "workspace-1" });
      return true;
    },
  );
});

test("translates package cleanup failures without exposing command output", async () => {
  const service = new InstalledPackageService({
    prepareUserPackageRemoval: async () => async () => {
      throw new Error("private npm stderr and filesystem path");
    },
  });

  await assert.rejects(
    service.remove({
      source: "npm:pi-tools",
      target: { scope: "user", sessionId: "session-1" },
    }),
    (error: unknown) => {
      assert.ok(error instanceof InstalledPackageServiceError);
      assert.equal(error.code, "remove-failed");
      assert.deepEqual(error.details, { source: "npm:pi-tools", scope: "user" });
      assert.equal(error.message.includes("private npm stderr"), false);
      return true;
    },
  );
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
  let markFirstStarted!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  const firstPending = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const service = new InstalledPackageService({
    installUserPackage: async (_sessionId, source) => {
      calls.push(`start:${source}`);
      if (source === "npm:first-package") {
        markFirstStarted();
        await firstPending;
      }
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
  await firstStarted;
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
