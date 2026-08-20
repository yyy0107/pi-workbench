import assert from "node:assert/strict";
import test from "node:test";

import { browserSurfaceDefinition } from "../workspace-browser/extension";
import { explorerSurfaceDefinition } from "../workspace-explorer/extension";
import { fileSurfaceDefinition } from "../workspace-file/extension";
import { reviewSurfaceDefinition } from "../workspace-review/extension";

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
