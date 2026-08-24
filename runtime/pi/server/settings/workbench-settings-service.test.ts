import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const moduleHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier.startsWith(".") &&
      !/\.[^/]+$/.test(specifier) &&
      context.parentURL?.includes("/runtime/pi/")
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
const { ImageUnderstandingSettingsStore } = (await import(
  new URL("../image-understanding/settings-store.ts", import.meta.url).href
)) as typeof import("../image-understanding/settings-store");
const { WorkspaceStore } = (await import(
  new URL("../workspaces/workspace-store.ts", import.meta.url).href
)) as typeof import("../workspaces/workspace-store");
const { WorkbenchSettingsService } = (await import(
  new URL("./workbench-settings-service.ts", import.meta.url).href
)) as typeof import("./workbench-settings-service");
moduleHooks.deregister();

test("describes empty preferences without mutating the agent directory", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-settings-readonly-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateFile = path.join(root, "agent", "workbench-settings.json");
  const service = new WorkbenchSettingsService(stateFile);

  assert.deepEqual(await service.describe(), { revision: 0, preferences: {} });
  await assert.rejects(readFile(stateFile, "utf8"), { code: "ENOENT" });
});

test("unifies preferences, workspaces, and image understanding with atomic legacy migration", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-settings-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateFile = path.join(root, "agent", "workbench-settings.json");
  const legacyWorkspaceFile = path.join(root, "legacy", "workspaces.json");
  const legacyImageFile = path.join(root, "legacy", "image-understanding.json");
  const workspaceId = "workspace-1";
  await mkdir(path.dirname(legacyWorkspaceFile), { recursive: true });
  await writeFile(
    legacyWorkspaceFile,
    `${JSON.stringify({
      schemaVersion: 1,
      legacyReconciled: true,
      workspaces: [
        {
          workspaceId,
          path: root,
          title: "Legacy workspace",
          sessionIds: ["session-1"],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      archivedSessionIds: ["session-1"],
      pinnedWorkspaceIds: [workspaceId],
      pinnedSessionIds: [],
      ignoredWorkspacePaths: [],
    })}\n`,
  );

  const legacyImageStore = new ImageUnderstandingSettingsStore({ stateFile: legacyImageFile });
  await legacyImageStore.update({
    patch: { routing: "always-preprocess", glm: { apiKey: "migration-secret" } },
  });

  const settings = new WorkbenchSettingsService(stateFile);
  await settings.update({
    patch: {
      locale: "zh-CN",
      appearance: { colorMode: "dark", showDiffMarkers: false },
    },
  });
  const workspaces = new WorkspaceStore({
    stateFile,
    documentSection: "workspaces",
    legacyStateFile: legacyWorkspaceFile,
  });
  const image = new ImageUnderstandingSettingsStore({
    stateFile,
    documentSection: "imageUnderstanding",
    legacyStateFile: legacyImageFile,
  });

  assert.deepEqual((await workspaces.list()).archivedSessionIds, ["session-1"]);
  assert.equal((await image.describe()).value.routing, "always-preprocess");
  assert.equal(await image.resolveCredential("glm-ocr"), "migration-secret");
  await assert.rejects(readFile(legacyWorkspaceFile, "utf8"), { code: "ENOENT" });
  await assert.rejects(readFile(legacyImageFile, "utf8"), { code: "ENOENT" });

  await Promise.all([
    settings.update({ patch: { sidebarOpen: false } }),
    workspaces.rename(workspaceId, "Unified workspace"),
    image.update({ patch: { routing: "native-only" } }),
  ]);

  const document = JSON.parse(await readFile(stateFile, "utf8")) as Record<string, unknown>;
  assert.equal(document.version, 1);
  assert.equal(typeof document.revision, "number");
  assert.equal((document.preferences as Record<string, unknown>).locale, "zh-CN");
  assert.equal((document.preferences as Record<string, unknown>).sidebarOpen, false);
  assert.equal(
    (
      (document.workspaces as Record<string, unknown>).workspaces as Array<Record<string, unknown>>
    )[0].title,
    "Unified workspace",
  );
  assert.equal(
    ((document.imageUnderstanding as Record<string, unknown>).settings as Record<string, unknown>)
      .routing,
    "native-only",
  );
  assert.equal((await stat(stateFile)).mode & 0o777, 0o600);
});
