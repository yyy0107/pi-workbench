import assert from "node:assert/strict";
import test from "node:test";

import { ExtensionManager } from "@/platform/extensions/internal";

import { terminalExtension } from "./terminal";
import { browserSurfaceDefinition, workspaceBrowserExtension } from "./workspace-browser";
import { explorerSurfaceDefinition, workspaceExplorerExtension } from "./workspace-explorer";
import { fileSurfaceDefinition, workspaceFileExtension } from "./workspace-file";
import { reviewSurfaceDefinition, workspaceReviewExtension } from "./workspace-review";
import { workspaceArtifactExtension } from "./workspace-artifact";

test("all built-in workspace capabilities are extension contributions", () => {
  const manager = new ExtensionManager();
  const extensions = [
    workspaceReviewExtension,
    workspaceExplorerExtension,
    workspaceFileExtension,
    workspaceBrowserExtension,
    workspaceArtifactExtension,
    terminalExtension,
  ];

  for (const extension of extensions) manager.activate(extension);

  assert.deepEqual(
    manager.workspace
      .getAll()
      .map((definition) => definition.kind)
      .sort(),
    ["artifact", "browser", "explorer", "file", "review", "terminal"],
  );
  assert.equal(
    manager.workspace.getAll().every((definition) => definition.render),
    true,
  );
  assert.equal(manager.workspace.get("explorer")?.defaultPlacement, "auxiliary");
  assert.equal(manager.workspace.get("explorer")?.menuItem, undefined);
  assert.equal(typeof manager.workspace.get("explorer")?.runtime, "function");
  assert.equal(typeof manager.workspace.get("file")?.header, "function");
  assert.equal(typeof manager.workspace.get("file")?.menuItem, "function");
  assert.equal(manager.workspace.get("browser")?.menuItem, undefined);
  assert.equal(manager.workspace.get("artifact")?.menuItem, undefined);
  assert.equal(manager.workspace.get("browser")?.persistence, "session");
  assert.equal(manager.workspace.get("artifact")?.persistence, "session");
  assert.equal(
    manager.slots
      .get("workspace.actions")
      .some((contribution) => contribution.id.includes("workspace-explorer")),
    false,
  );

  manager.dispose();
  assert.equal(manager.workspace.getAll().length, 0);
});

test("the file launcher is a stable resource distinct from real files", () => {
  assert.equal(
    fileSurfaceDefinition.getResourceKey({ launcher: true }, first),
    fileSurfaceDefinition.getResourceKey({ launcher: true }, first),
  );
  assert.notEqual(
    fileSurfaceDefinition.getResourceKey({ launcher: true }, first),
    fileSurfaceDefinition.getResourceKey({ absolutePath: "/workspace/app.ts" }, first),
  );
  assert.notEqual(
    fileSurfaceDefinition.getResourceKey({ launcher: true }, first),
    fileSurfaceDefinition.getResourceKey({ launcher: true }, second),
  );
});

const first = {
  applicationId: "workbench",
  threadId: "thread-1",
  projectId: "project-1",
  worktreeId: "project-1",
  rootPath: "/workspace",
};
const second = { ...first, threadId: "thread-2" };

test("built-in workspace resources and scopes are conversation-exclusive", () => {
  const cases = [
    {
      definition: explorerSurfaceDefinition,
      params: { rootPath: "/workspace" },
    },
    {
      definition: fileSurfaceDefinition,
      params: { absolutePath: "/workspace/app.ts" },
    },
    {
      definition: browserSurfaceDefinition,
      params: { browserSessionId: "browser-1", url: "https://example.com" },
    },
    {
      definition: reviewSurfaceDefinition,
      params: {
        repositoryId: "project-1",
        reviewScope: "unstaged" as const,
      },
    },
  ] as const;

  for (const entry of cases) {
    const definition = entry.definition as {
      getResourceKey(params: Record<string, unknown>, context: typeof first): string;
      getDefaultScope?(
        params: Record<string, unknown>,
        context: typeof first,
      ): {
        type: string;
        key: string;
      };
    };
    assert.notEqual(
      definition.getResourceKey(entry.params, first),
      definition.getResourceKey(entry.params, second),
    );
    assert.deepEqual(definition.getDefaultScope?.(entry.params, first), {
      type: "thread",
      key: "thread-1",
    });
  }
});
