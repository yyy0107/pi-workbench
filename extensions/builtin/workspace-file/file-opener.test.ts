import assert from "node:assert/strict";
import test from "node:test";

import type { OpenSurfaceRequest } from "@/platform/extensions";

import { fileOpenHandler, skillFileOpenHandler } from "./file-opener";

test("the file opener describes an unattached workspace file before revealing its Surface", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let rpcMethod = "";
  let rpcPayload: unknown;
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      rpcId: string;
      method: string;
      payload: unknown;
    };
    rpcMethod = request.method;
    rpcPayload = request.payload;
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: {
        ok: true,
        value: {
          workspaceId: "workspace-opener",
          relativePath: "src/index.ts",
          absolutePath: "/workspace/src/index.ts",
          name: "index.ts",
          mediaType: "text/typescript",
          encoding: "utf-8",
          version: "stat-sha256:index",
          size: 11,
          modifiedAt: 1,
        },
      },
    });
  };

  let revealed: OpenSurfaceRequest | undefined;
  const result = await fileOpenHandler.open(
    {
      resource: { scheme: "workspace-file", path: "src/index.ts", label: "index.ts" },
      context: {
        applicationId: "pi-workbench",
        threadId: "thread-opener",
        worktreeId: "workspace-opener",
        rootPath: "/workspace",
      },
      scope: { type: "thread", key: "thread-opener" },
      policy: "reveal",
    },
    {
      surfaces: {
        open: () => assert.fail("The file opener should reveal instead of opening duplicates"),
        reveal: (request) => {
          revealed = request;
          return "file-surface";
        },
      },
    },
  );

  assert.equal(result, "file-surface");
  assert.equal(rpcMethod, "workspace.files.describe");
  assert.deepEqual(rpcPayload, {
    workspaceId: "workspace-opener",
    relativePath: "src/index.ts",
  });
  assert.deepEqual(revealed, {
    kind: "file",
    title: "index.ts",
    params: {
      absolutePath: "/workspace/src/index.ts",
      relativePath: "src/index.ts",
      workspaceId: "workspace-opener",
      name: "index.ts",
      mediaType: "text/typescript",
      encoding: "utf-8",
      version: "stat-sha256:index",
      size: 11,
      modifiedAt: 1,
      contentUrl:
        "/api/workspace.files.content?workspaceId=workspace-opener&relativePath=src%2Findex.ts",
      viewMode: "source",
      diffId: undefined,
      diffCycle: undefined,
    },
    context: {
      applicationId: "pi-workbench",
      threadId: "thread-opener",
      worktreeId: "workspace-opener",
      rootPath: "/workspace",
    },
    scope: { type: "thread", key: "thread-opener" },
    status: "ready",
    policy: "reveal",
  });
});

test("the file opener reveals tool diffs in the existing File Surface", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { rpcId: string };
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: {
        ok: true,
        value: {
          workspaceId: "workspace-opener",
          relativePath: "src/index.ts",
          absolutePath: "/workspace/src/index.ts",
          name: "index.ts",
          mediaType: "text/typescript",
          encoding: "utf-8",
          version: "stat-sha256:index-diff",
          size: 17,
          modifiedAt: 2,
        },
      },
    });
  };

  let revealed: OpenSurfaceRequest | undefined;
  await fileOpenHandler.open(
    {
      resource: {
        scheme: "workspace-file",
        path: "src/index.ts",
        label: "index.ts",
        metadata: {
          viewMode: "diff",
          diffId: "tool-1",
          lines: [
            { kind: "removed", text: "const value = 1;" },
            { kind: "added", text: "const value = 2;" },
          ],
        },
      },
      context: {
        applicationId: "pi-workbench",
        threadId: "thread-opener",
        worktreeId: "workspace-opener",
        rootPath: "/workspace",
      },
      scope: { type: "thread", key: "thread-opener" },
      policy: "force-focus",
    },
    {
      surfaces: {
        open: () => assert.fail("The file opener should reveal instead of opening duplicates"),
        reveal: (request) => {
          revealed = request;
          return "file-surface";
        },
      },
    },
  );

  assert.equal(revealed?.kind, "file");
  assert.equal(revealed?.params.absolutePath, "/workspace/src/index.ts");
  assert.equal(revealed?.params.viewMode, "diff");
  assert.equal(revealed?.params.diffId, "tool-1");
  assert.equal(typeof revealed?.params.diffCycle, "number");
  assert.equal(revealed?.policy, "force-focus");
});

test("the skill file opener reads nested Skill files into the read-only File Surface", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let rpcMethod = "";
  let rpcPayload: unknown;
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      rpcId: string;
      method: string;
      payload: unknown;
    };
    rpcMethod = request.method;
    rpcPayload = request.payload;
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: {
        ok: true,
        value: {
          skillName: "example-skill",
          rootPath: "/home/user/.pi/agent/skills/example-skill",
          relativePath: "references/packages.md",
          absolutePath: "/home/user/.pi/agent/skills/example-skill/references/packages.md",
          name: "packages.md",
          content: "# Packages\n",
          mediaType: "text/markdown",
          encoding: "utf-8",
          version: "sha256:packages",
          size: 11,
          modifiedAt: 2,
        },
      },
    });
  };

  let revealed: OpenSurfaceRequest | undefined;
  const result = await skillFileOpenHandler.open(
    {
      resource: {
        scheme: "skill-file",
        path: "/home/user/.pi/agent/skills/example-skill/references/packages.md",
        label: "packages.md",
        metadata: {
          sessionId: "session-1",
          skillName: "example-skill",
          relativePath: "references/packages.md",
        },
      },
      context: {
        applicationId: "pi-workbench",
        threadId: "thread-opener",
        projectId: "workspace-opener",
        rootPath: "/workspace",
      },
      policy: "force-focus",
    },
    {
      surfaces: {
        open: () => assert.fail("A Skill file should reuse the File Surface"),
        reveal: (request) => {
          revealed = request;
          return "skill-file-surface";
        },
      },
    },
  );

  assert.equal(result, "skill-file-surface");
  assert.equal(rpcMethod, "skill.files.read");
  assert.deepEqual(rpcPayload, {
    sessionId: "session-1",
    name: "example-skill",
    relativePath: "references/packages.md",
  });
  assert.equal(revealed?.kind, "file");
  assert.equal(revealed?.title, "packages.md");
  assert.equal(revealed?.params.source, "skill");
  assert.equal(revealed?.params.rootPath, "/home/user/.pi/agent/skills/example-skill");
  assert.equal(
    revealed?.params.absolutePath,
    "/home/user/.pi/agent/skills/example-skill/references/packages.md",
  );
  assert.equal(revealed?.params.relativePath, "references/packages.md");
  assert.equal(revealed?.params.mediaType, "text/markdown");
  assert.equal(revealed?.params.readOnly, true);
  assert.equal(revealed?.params.viewMode, "source");
  assert.equal(revealed?.policy, "force-focus");
});
