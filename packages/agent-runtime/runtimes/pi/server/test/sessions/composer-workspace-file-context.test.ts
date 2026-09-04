import assert from "node:assert/strict";
import test from "node:test";

import type { WorkspaceFileSnapshotValue } from "@workbench/agent-runtime-pi-protocol/rpc";
import type { WorkbenchResolvedContext } from "@workbench/contracts/composer/request";

import {
  boundedWorkspaceFileContent,
  resolveWorkspaceFileReferenceContexts,
} from "../../src/sessions/composer-workspace-file-context";

function reference(relativePath = "src/app.ts"): WorkbenchResolvedContext {
  return {
    source: "workbench.workspace-file",
    trust: "untrusted-context",
    value: {
      version: 1,
      workspaceId: "workspace-1",
      relativePath,
      name: relativePath,
    },
  };
}

function snapshot(relativePath = "src/app.ts"): WorkspaceFileSnapshotValue {
  return {
    workspaceId: "workspace-1",
    relativePath,
    absolutePath: `/projects/one/${relativePath}`,
    name: relativePath.split("/").at(-1)!,
    content: "export const value = 1;\n",
    encoding: "utf-8",
    version: "sha256:version",
    size: 24,
    modifiedAt: 1,
  };
}

test("resolves Workspace file references to bounded untrusted file content", async () => {
  const calls: unknown[] = [];
  const [resolved] = await resolveWorkspaceFileReferenceContexts({
    contexts: [reference()],
    readFile: async (input) => {
      calls.push(input);
      return snapshot(input.relativePath);
    },
  });

  assert.deepEqual(calls, [{ workspaceId: "workspace-1", relativePath: "src/app.ts" }]);
  assert.deepEqual(resolved, {
    source: "workbench.workspace-file",
    trust: "untrusted-context",
    value: {
      version: 1,
      kind: "workspace-file-reference",
      workspaceId: "workspace-1",
      relativePath: "src/app.ts",
      name: "src/app.ts",
      status: "available",
      file: {
        name: "app.ts",
        content: "export const value = 1;\n",
        truncated: false,
        version: "sha256:version",
        size: 24,
        modifiedAt: 1,
      },
    },
  });
});

test("keeps unavailable Workspace file references explicit without throwing", async () => {
  const ordinary: WorkbenchResolvedContext = {
    source: "ordinary",
    trust: "untrusted-context",
    value: "preserved",
  };
  const resolved = await resolveWorkspaceFileReferenceContexts({
    contexts: [ordinary, reference("missing.ts")],
    readFile: async () => {
      throw new Error("missing");
    },
  });

  assert.equal(resolved[0], ordinary);
  assert.deepEqual(resolved[1]?.value, {
    version: 1,
    kind: "workspace-file-reference",
    workspaceId: "workspace-1",
    relativePath: "missing.ts",
    name: "missing.ts",
    status: "unavailable",
  });
});

test("bounds Workspace file content independently of the source snapshot", () => {
  const content = "x".repeat(80_000);
  const bounded = boundedWorkspaceFileContent(content);

  assert.equal(bounded.content.length, 60_000);
  assert.equal(bounded.truncated, true);
  assert.equal(content.length, 80_000);
});
