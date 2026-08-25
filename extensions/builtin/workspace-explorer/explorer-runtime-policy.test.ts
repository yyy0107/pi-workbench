import assert from "node:assert/strict";
import test from "node:test";

import type { WorkspaceContext, WorkspaceSurfaceInstance } from "@/components/right-workspace";

import {
  contextExplorerSurfaces,
  contextSkillExplorerSurfaces,
  isFileSurfaceActive,
  skillExplorerMatchesFile,
  skillFileExplorerIdentity,
} from "./explorer-runtime-policy";

const context: WorkspaceContext = {
  applicationId: "app",
  threadId: "thread-1",
  worktreeId: "workspace-1",
  rootPath: "/workspace",
};

function surface(id: string, kind: string, scopeKey = "thread-1"): WorkspaceSurfaceInstance {
  return {
    id,
    kind,
    placement: kind === "explorer" ? "auxiliary" : "primary",
    title: id,
    resourceKey: id,
    scope: { type: "thread", key: scopeKey },
    params: {},
    status: "ready",
    createdAt: 1,
    lastActiveAt: 1,
  };
}

test("shows Explorer only while a File Surface is active", () => {
  assert.equal(
    isFileSurfaceActive({
      ...surface("file:1", "file"),
      params: { absolutePath: "/workspace/src/index.ts" },
    }),
    true,
  );
  assert.equal(isFileSurfaceActive(surface("file:launcher", "file")), false);
  assert.equal(
    isFileSurfaceActive({ ...surface("file:skill", "file"), params: { source: "skill" } }),
    false,
  );
  assert.equal(isFileSurfaceActive(surface("terminal:1", "terminal")), false);
  assert.equal(isFileSurfaceActive(surface("browser:1", "browser")), false);
  assert.equal(isFileSurfaceActive(undefined), false);
});

test("selects only Explorer Surfaces owned by the current context", () => {
  const current = surface("explorer:1", "explorer");
  const other = surface("explorer:other", "explorer", "thread-2");
  assert.deepEqual(contextExplorerSurfaces([current, other, surface("file:1", "file")], context), [
    current,
  ]);
});

test("keeps Skill Explorers in the paired file lifecycle", () => {
  const workspaceExplorer = surface("explorer:workspace", "explorer");
  const skillExplorer = {
    ...surface("explorer:skill", "explorer"),
    params: {
      source: "skill",
      rootPath: "/home/user/.pi/agent/skills/example",
      sessionId: "session-1",
      skillName: "example",
    },
  };

  assert.deepEqual(contextExplorerSurfaces([workspaceExplorer, skillExplorer], context), [
    workspaceExplorer,
  ]);
  assert.deepEqual(contextSkillExplorerSurfaces([workspaceExplorer, skillExplorer], context), [
    skillExplorer,
  ]);
});

test("matches a Skill Explorer only to its owning file tab", () => {
  const skillFile = {
    ...surface("file:skill", "file"),
    params: {
      source: "skill",
      rootPath: "/home/user/.pi/agent/skills/example",
      sessionId: "session-1",
      skillName: "example",
    },
  };
  const identity = skillFileExplorerIdentity(skillFile);
  assert.deepEqual(identity, {
    rootPath: "/home/user/.pi/agent/skills/example",
    sessionId: "session-1",
    skillName: "example",
  });
  assert.equal(
    identity
      ? skillExplorerMatchesFile(
          {
            ...surface("explorer:skill", "explorer"),
            params: { source: "skill", ...identity },
          },
          identity,
        )
      : false,
    true,
  );
  assert.equal(skillFileExplorerIdentity(surface("file:workspace", "file")), undefined);
});
