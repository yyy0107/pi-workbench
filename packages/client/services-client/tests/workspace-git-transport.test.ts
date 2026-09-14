import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimeFetch } from "@workbench/runtime-transport-client";
import { createWorkspaceClient } from "../src/workspace";

test("Git diff uses the installation transport and forwards cancellation and comparison parameters", async () => {
  const signal = new AbortController().signal;
  const request = {
    workspaceId: "workspace",
    scope: "branch" as const,
    revision: "main",
    path: "file.ts",
    offset: 32_768,
    patchVersion: "a".repeat(64),
  };
  const expected = {
    repository: true,
    branches: ["main"],
    files: [],
    patch: "+value",
    patchVersion: request.patchVersion,
  };
  const transport = createRuntimeFetch(
    {
      kind: "desktop-sidecar",
      protocolVersion: 1,
      httpOrigin: "http://127.0.0.1:41273",
      instanceId: "review",
      accessToken: "fixture-token",
    },
    async (url, init) => {
      assert.equal(url.href, "http://127.0.0.1:41273/api/workspace.git.diff");
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fixture-token");
      assert.equal(init?.signal, signal);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.method, "workspace.git.diff");
      assert.deepEqual(body.payload, request);
      return Response.json({
        type: "server-response",
        rpcId: body.rpcId,
        result: { ok: true, value: expected },
      });
    },
  );
  const client = createWorkspaceClient({ transport });
  assert.deepEqual(await client.readGitDiff(request, { signal }), expected);
});

test("workspace FileChangeSet undo and redo use generic workspace RPC methods", async () => {
  const methods: string[] = [];
  const request = { workspaceId: "workspace", threadId: "thread", changeSetId: "change" };
  const transport = createRuntimeFetch(
    {
      kind: "desktop-sidecar",
      protocolVersion: 1,
      httpOrigin: "http://127.0.0.1:41273",
      instanceId: "file-changes",
      accessToken: "fixture-token",
    },
    async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      methods.push(body.method);
      assert.deepEqual(body.payload, request);
      return Response.json({
        type: "server-response",
        rpcId: body.rpcId,
        result: {
          ok: true,
          value: {
            applied: true,
            direction: body.method.endsWith("undo") ? "undo" : "redo",
            merged: false,
          },
        },
      });
    },
  );
  const fileChanges = createWorkspaceClient({ transport }).fileChanges;
  assert.ok(fileChanges);
  assert.equal((await fileChanges.undo(request)).direction, "undo");
  assert.equal((await fileChanges.redo(request)).direction, "redo");
  assert.deepEqual(methods, ["workspace.fileChanges.undo", "workspace.fileChanges.redo"]);
});
