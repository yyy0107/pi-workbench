import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeFetch as createPiHttpTransport } from "@workbench/host-client";
import { fetchWorkspaceFileContent as fetchPiWorkspaceFileContent } from "../src/workspace";

test("workspace binary content keeps same-instance sidecar URL and bearer credentials bound", async () => {
  const calls: Array<{ input: URL; authorization: string | null }> = [];
  const transport = (port: number, token: string) =>
    createPiHttpTransport(
      {
        kind: "desktop-sidecar",
        protocolVersion: 1,
        httpOrigin: `http://127.0.0.1:${port}`,
        instanceId: "same-runtime-id",
        accessToken: token,
      },
      async (input, init) => {
        calls.push({ input, authorization: new Headers(init?.headers).get("Authorization") });
        return new Response("binary-preview", { status: 200 });
      },
    );

  const first = transport(41_273, "first-preview-secret");
  const second = transport(53_919, "second-preview-secret");
  await Promise.all([
    fetchPiWorkspaceFileContent(
      { workspaceId: "workspace", relativePath: "assets/preview.png" },
      { transport: first },
    ),
    fetchPiWorkspaceFileContent(
      { workspaceId: "workspace", relativePath: "assets/preview.png" },
      { transport: second },
    ),
  ]);

  assert.deepEqual(calls, [
    {
      input: new URL(
        "http://127.0.0.1:41273/api/workspace.files.content?workspaceId=workspace&relativePath=assets%2Fpreview.png",
      ),
      authorization: "Bearer first-preview-secret",
    },
    {
      input: new URL(
        "http://127.0.0.1:53919/api/workspace.files.content?workspaceId=workspace&relativePath=assets%2Fpreview.png",
      ),
      authorization: "Bearer second-preview-secret",
    },
  ]);
  assert.equal(
    calls.some(({ input }) => input.href.includes("preview-secret")),
    false,
  );
});
