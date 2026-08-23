import assert from "node:assert/strict";
import test from "node:test";

import {
  handleWorkspaceFileContentRequest,
  type WorkspaceFileContentDependencies,
} from "./workspace-file-content";
import { WORKSPACE_FILE_PREVIEW_SIZE_LIMIT } from "./workspace-files";

const bytes = new TextEncoder().encode("0123456789");

function dependencies(
  overrides: Partial<WorkspaceFileContentDependencies> = {},
): WorkspaceFileContentDependencies {
  return {
    resolveFile: async ({ workspaceId, relativePath }) => ({
      workspaceId,
      relativePath,
      absolutePath: `/workspace/${relativePath}`,
      canonicalPath: `/workspace/${relativePath}`,
      name: "sample.pdf",
      mediaType: "application/pdf",
      encoding: null,
      version: "stat-sha256:sample",
      size: bytes.byteLength,
      modifiedAt: Date.UTC(2026, 0, 2),
    }),
    createStream: (_path, range) =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.subarray(range.start, range.end + 1));
          controller.close();
        },
      }),
    ...overrides,
  };
}

function request(
  method: "GET" | "HEAD",
  headers: HeadersInit = {},
  query = "workspaceId=workspace-1&relativePath=docs%2Fsample.pdf",
): Request {
  return new Request(`http://127.0.0.1:3000/api/workspace.files.content?${query}`, {
    method,
    headers: { host: "127.0.0.1:3000", ...headers },
  });
}

test("streams complete workspace files with inline and cache-safety headers", async () => {
  const response = await handleWorkspaceFileContentRequest(request("GET"), dependencies());

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "0123456789");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("content-length"), "10");
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(response.headers.get("etag"), '"stat-sha256:sample"');
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-disposition") ?? "", /^inline;/);
});

test("supports open, bounded, and suffix byte ranges", async () => {
  for (const [range, expected, contentRange] of [
    ["bytes=2-5", "2345", "bytes 2-5/10"],
    ["bytes=7-", "789", "bytes 7-9/10"],
    ["bytes=-3", "789", "bytes 7-9/10"],
  ]) {
    const response = await handleWorkspaceFileContentRequest(
      request("GET", { range }),
      dependencies(),
    );
    assert.equal(response.status, 206, range);
    assert.equal(await response.text(), expected, range);
    assert.equal(response.headers.get("content-range"), contentRange, range);
  }
});

test("returns bodyless HEAD and conditional responses without opening a stream", async () => {
  let streamCalls = 0;
  const source = dependencies({
    createStream: () => {
      streamCalls += 1;
      return new ReadableStream();
    },
  });
  const head = await handleWorkspaceFileContentRequest(request("HEAD"), source);
  const cached = await handleWorkspaceFileContentRequest(
    request("GET", { "if-none-match": '"stat-sha256:sample"' }),
    source,
  );

  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(cached.status, 304);
  assert.equal(streamCalls, 0);
});

test("rejects invalid ranges, oversized previews, malformed queries, and untrusted hosts", async () => {
  const invalidRange = await handleWorkspaceFileContentRequest(
    request("GET", { range: "bytes=20-30" }),
    dependencies(),
  );
  assert.equal(invalidRange.status, 416);
  assert.equal(invalidRange.headers.get("content-range"), "bytes */10");

  const oversized = await handleWorkspaceFileContentRequest(
    request("GET"),
    dependencies({
      resolveFile: async ({ workspaceId, relativePath }) => ({
        workspaceId,
        relativePath,
        absolutePath: "/workspace/huge.pdf",
        canonicalPath: "/workspace/huge.pdf",
        name: "huge.pdf",
        mediaType: "application/pdf",
        encoding: null,
        version: "stat-sha256:huge",
        size: WORKSPACE_FILE_PREVIEW_SIZE_LIMIT + 1,
        modifiedAt: 1,
      }),
    }),
  );
  assert.equal(oversized.status, 413);

  const malformed = await handleWorkspaceFileContentRequest(
    request("GET", {}, "workspaceId=workspace-1"),
    dependencies(),
  );
  assert.equal(malformed.status, 400);

  const untrusted = new Request(
    "http://evil.example/api/workspace.files.content?workspaceId=workspace-1&relativePath=a.pdf",
    { headers: { host: "evil.example" } },
  );
  assert.equal((await handleWorkspaceFileContentRequest(untrusted, dependencies())).status, 403);
});
