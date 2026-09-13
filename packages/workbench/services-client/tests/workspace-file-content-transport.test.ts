import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeFetch as createPiHttpTransport } from "@workbench/host-client";
import { fetchWorkspaceFileContent as fetchPiWorkspaceFileContent } from "../src/workspace";
import { createHostClient } from "../src/host";

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

test("local file previews and text streams retain the installation transport and UTF-8 decoding", async () => {
  const calls: URL[] = [];
  const content = new TextEncoder().encode("local 文本");
  const transport = createPiHttpTransport(
    {
      kind: "desktop-sidecar",
      protocolVersion: 1,
      httpOrigin: "http://127.0.0.1:41273",
      instanceId: "local",
      accessToken: "local-secret",
    },
    async (input, init) => {
      calls.push(input);
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer local-secret");
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(content.slice(0, 7));
            controller.enqueue(content.slice(7));
            controller.close();
          },
        }),
        { headers: { "content-length": String(content.length) } },
      );
    },
  );
  const files = createHostClient({ transport }).files!;
  assert.equal(await (await files.fetchFileContent("/tmp/a #.txt")).text(), "local 文本");
  const chunks: string[] = [];
  const result = await files.streamFileText("/tmp/a #.txt", {
    onChunk: (chunk) => chunks.push(chunk.text),
  });
  assert.equal(chunks.join(""), "local 文本");
  assert.equal(result.loadedBytes, content.length);
  assert.equal(result.totalBytes, content.length);
  assert.equal(calls.length, 2);
  for (const url of calls) {
    assert.equal(url.origin, "http://127.0.0.1:41273");
    assert.equal(url.pathname, "/api/host.files.content");
    assert.equal(url.searchParams.get("path"), "/tmp/a #.txt");
  }
});
