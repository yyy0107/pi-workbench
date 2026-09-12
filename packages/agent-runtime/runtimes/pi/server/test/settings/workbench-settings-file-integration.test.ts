import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { WorkbenchSettingsService } from "@workbench/settings-server/service";
import { WorkspaceStore } from "../../src/workspaces/workspace-store";

test("unifies preferences and workspaces with atomic legacy migration", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-settings-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateFile = path.join(root, "agent", "workbench-settings.json");
  const legacyWorkspaceFile = path.join(root, "legacy", "workspaces.json");
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

  const settings = new WorkbenchSettingsService({ stateFile });
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
  assert.deepEqual((await workspaces.list()).archivedSessionIds, ["session-1"]);
  await assert.rejects(readFile(legacyWorkspaceFile, "utf8"), { code: "ENOENT" });

  await Promise.all([
    settings.update({ patch: { sidebarOpen: false } }),
    workspaces.rename(workspaceId, "Unified workspace"),
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
  assert.equal((await stat(stateFile)).mode & 0o777, 0o600);
});
