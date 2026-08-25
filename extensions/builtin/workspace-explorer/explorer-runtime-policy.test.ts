import assert from "node:assert/strict";
import test from "node:test";

import type { WorkspaceContext, WorkspaceSurfaceInstance } from "@/components/right-workspace";

import {
  activeFileWorkspaceSession,
  contextExplorerSurfaces,
  explorerMatchesFileWorkspace,
} from "./explorer-runtime-policy";

const context: WorkspaceContext = {
  applicationId: "app",
  threadId: "thread-1",
  worktreeId: "workspace-1",
  rootPath: "/workspace",
};

function surface(
  id: string,
  kind: string,
  params: Readonly<Record<string, unknown>> = {},
  scopeKey = "thread-1",
): WorkspaceSurfaceInstance {
  return {
    id,
    kind,
    placement: kind === "explorer" ? "auxiliary" : "primary",
    title: id,
    resourceKey: id,
    scope: { type: "thread", key: scopeKey },
    params,
    status: "ready",
    createdAt: 1,
    lastActiveAt: 1,
  };
}

test("requires an explicit complete directory session for every File Surface", () => {
  assert.deepEqual(
    activeFileWorkspaceSession(
      surface("file:workspace", "file", {
        source: "workspace",
        rootPath: "/workspace",
        workspaceId: "workspace-1",
        absolutePath: "/workspace/src/index.ts",
      }),
    ),
    { source: "workspace", rootPath: "/workspace", workspaceId: "workspace-1" },
  );
  assert.deepEqual(
    activeFileWorkspaceSession(
      surface("file:skill", "file", {
        source: "skill",
        rootPath: "/home/user/.pi/agent/skills/example",
        sessionId: "session-1",
        skillName: "example",
      }),
    ),
    {
      source: "skill",
      rootPath: "/home/user/.pi/agent/skills/example",
      sessionId: "session-1",
      skillName: "example",
    },
  );
  assert.equal(
    activeFileWorkspaceSession(
      surface("file:legacy", "file", { absolutePath: "/workspace/src/index.ts" }),
    ),
    undefined,
  );
  assert.equal(
    activeFileWorkspaceSession(surface("file:incomplete", "file", { source: "skill" })),
    undefined,
  );
  assert.equal(activeFileWorkspaceSession(surface("terminal:1", "terminal")), undefined);
});

test("selects all Explorer Surfaces owned by the current context through one policy", () => {
  const workspaceExplorer = surface("explorer:workspace", "explorer", {
    source: "workspace",
    rootPath: "/workspace",
    workspaceId: "workspace-1",
  });
  const skillExplorer = surface("explorer:skill", "explorer", {
    source: "skill",
    rootPath: "/home/user/.pi/agent/skills/example",
    sessionId: "session-1",
    skillName: "example",
  });
  const other = surface("explorer:other", "explorer", workspaceExplorer.params, "thread-2");

  assert.deepEqual(contextExplorerSurfaces([workspaceExplorer, skillExplorer, other], context), [
    workspaceExplorer,
    skillExplorer,
  ]);
});

test("matches workspace, Skill, and Extension Explorers with the same session key", () => {
  const workspaceSession = {
    source: "workspace" as const,
    rootPath: "/workspace",
    workspaceId: "workspace-1",
  };
  const skillSession = {
    source: "skill" as const,
    rootPath: "/home/user/.pi/agent/skills/example",
    sessionId: "session-1",
    skillName: "example",
  };
  const extensionSession = {
    source: "extension" as const,
    rootPath: "/home/user/.pi/agent/extensions/review",
    sessionId: "session-1",
    extensionName: "review",
    extensionFilePath: "/home/user/.pi/agent/extensions/review/index.ts",
    extensionSource: "auto",
    extensionScope: "user" as const,
    extensionOrigin: "top-level" as const,
  };

  assert.equal(
    explorerMatchesFileWorkspace(
      surface("explorer:workspace", "explorer", workspaceSession),
      workspaceSession,
    ),
    true,
  );
  assert.equal(
    explorerMatchesFileWorkspace(surface("explorer:skill", "explorer", skillSession), skillSession),
    true,
  );
  assert.equal(
    explorerMatchesFileWorkspace(
      surface("explorer:extension", "explorer", extensionSession),
      extensionSession,
    ),
    true,
  );
  assert.equal(
    explorerMatchesFileWorkspace(
      surface("explorer:other-extension", "explorer", {
        ...extensionSession,
        extensionOrigin: "package",
      }),
      extensionSession,
    ),
    false,
  );
});
