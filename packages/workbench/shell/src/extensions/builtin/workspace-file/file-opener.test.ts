import assert from "node:assert/strict";
import test from "node:test";
import type { OpenSurfaceRequest } from "@workbench/extension-sdk";
import {
  BufferedFileWorkspaceService,
  MemoryFileDiffService,
} from "@workbench/shell/workspace-files";
import { createFileOpenHandler } from "./file-opener";

test("workspace file openers preserve descriptors, diffs, and installation isolation", async () => {
  for (const label of ["first", "second"]) {
    const calls: unknown[] = [];
    const files = new BufferedFileWorkspaceService({
      listDirectory: async () => assert.fail("Only metadata is needed"),
      readFile: async () => assert.fail("Opening must not eagerly buffer text"),
      writeFile: async () => assert.fail("Opening must not write"),
      contentUrl: () => `/content/${label}`,
      describeFile: async (request) => {
        calls.push(request);
        return {
          ...request,
          absolutePath: "/workspace/src/index.ts",
          name: label,
          mediaType: "text/typescript",
          encoding: "utf-8",
          version: label,
          size: 12,
          modifiedAt: 1,
        };
      },
    });
    const diffs = new MemoryFileDiffService();
    const opener = createFileOpenHandler(files, diffs);
    const context = {
      applicationId: "workbench",
      threadId: "shared",
      projectId: "workspace-1",
      rootPath: "/workspace",
    };
    assert.equal(
      opener.canOpen({ resource: { scheme: "file", path: "/workspace/src/index.ts" }, context }),
      0,
    );
    let revealed: OpenSurfaceRequest | undefined;
    for (const metadata of [
      undefined,
      { viewMode: "diff", diffId: "edit-1", lines: [{ kind: "added", text: label }] },
    ]) {
      await opener.open(
        {
          resource: { scheme: "workspace-file", path: "src/index.ts", metadata },
          context,
        },
        {
          surfaces: {
            open: () => assert.fail("Should reveal the existing surface"),
            reveal: (request) => {
              revealed = request;
              return "file-1";
            },
          },
        },
      );
      assert.equal(revealed?.title, label);
      assert.equal(revealed?.params.version, label);
      assert.equal(revealed?.params.contentUrl, `/content/${label}`);
      assert.equal(revealed?.params.viewMode, metadata ? "diff" : "source");
      assert.equal(revealed?.params.absolutePath, "/workspace/src/index.ts");
      assert.deepEqual(revealed?.scope, { type: "thread", key: "shared" });
    }
    assert.equal(diffs.get("edit-1")?.lines[0]?.text, label);
    assert.deepEqual(
      calls,
      Array(2).fill({ workspaceId: "workspace-1", relativePath: "src/index.ts" }),
    );
    await assert.rejects(
      async () =>
        opener.open(
          {
            resource: { scheme: "workspace-file", path: "src/index.ts" },
            context: { applicationId: "workbench" },
          },
          { surfaces: { open: () => "", reveal: () => "" } },
        ),
      /explicit workspace root/u,
    );
  }
});
