import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimeFetch } from "@workbench/host-client";
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
