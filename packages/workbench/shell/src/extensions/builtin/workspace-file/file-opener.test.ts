import assert from "node:assert/strict";
import test from "node:test";
import type { OpenSurfaceRequest } from "@workbench/extension-sdk";
import {
  OpenerRegistryImpl,
  WorkspaceSurfaceRegistryImpl,
} from "@workbench/extension-sdk/internal";
import { DefaultOpenerService } from "@workbench/extension-host/services";
import { isLocalizableText } from "@workbench/shell/i18n";
import {
  DefaultRightWorkspaceController,
  createRightWorkspaceStore,
} from "@workbench/shell/right-workspace";
import {
  BufferedFileWorkspaceService,
  MemoryFileDiffService,
  fileWorkspaceContext,
  openFileLink,
} from "@workbench/shell/workspace-files";
import { createFileOpenHandler } from "./file-opener";
import { fileSurfaceDefinition } from "./extension";

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
      100,
    );
    let revealed: OpenSurfaceRequest | undefined;
    for (const metadata of [
      undefined,
      { viewMode: "diff", diffId: "edit-1", lines: [{ kind: "added", text: label }] },
    ]) {
      await opener.open(
        {
          resource: {
            scheme: metadata ? "workspace-file" : "file",
            path: metadata ? "src/index.ts" : "/workspace/src/index.ts",
            metadata,
          },
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
    await assert.rejects(
      async () =>
        opener.open(
          {
            resource: {
              scheme: "workspace-file",
              path: "/projects/testpro/test-0826/test_multiplication_table.py",
              metadata: {
                viewMode: "diff",
                diffId: "outside-workspace-diff",
                lines: [{ kind: "added", text: "print(1)" }],
              },
            },
            context,
          },
          {
            surfaces: {
              open: () => assert.fail("Outside-workspace files must not open"),
              reveal: () => assert.fail("Outside-workspace files must not be revealed"),
            },
          },
        ),
      /File path is outside the workspace/u,
    );
    assert.equal(calls.length, 2, "Outside-workspace paths must not reach the backend");
    assert.equal(diffs.get("outside-workspace-diff"), undefined);
  }
});

test("local links reveal the existing File surface outside a project and preserve dirty buffers", async () => {
  const metadataCalls: string[] = [];
  const files = new BufferedFileWorkspaceService(undefined, undefined, {
    listDirectory: async () => assert.fail("Opening does not list directories"),
    readFile: async () => assert.fail("Opening does not eagerly read content"),
    writeFile: async () => assert.fail("Opening does not write"),
    contentUrl: (path) => `/api/host.files.content?${new URLSearchParams({ path })}`,
    describeFile: async (path) => {
      metadataCalls.push(path);
      return {
        absolutePath: path,
        name: path.split("/").at(-1)!,
        mediaType: path.endsWith(".png") ? "image/png" : "text/plain",
        encoding: path.endsWith(".png") ? null : "utf-8",
        version: "version-1",
        size: 12,
        modifiedAt: 1,
      };
    },
  });
  const registry = new WorkspaceSurfaceRegistryImpl();
  registry.register(fileSurfaceDefinition);
  const store = createRightWorkspaceStore();
  const controller = new DefaultRightWorkspaceController(store, registry, {
    validateLocalizableText: isLocalizableText,
  });
  const handlers = new OpenerRegistryImpl();
  handlers.register(createFileOpenHandler(files, new MemoryFileDiffService()));
  const opener = new DefaultOpenerService(handlers, controller);
  const context = {
    applicationId: "test",
    threadId: "thread",
    projectId: "project",
    rootPath: "/project",
  };
  const first = await openFileLink(opener, context, "../external/a.md:12");
  assert.equal(typeof first, "string");
  const fileContext = fileWorkspaceContext(
    { type: "thread", key: "thread" },
    { source: "local", rootPath: "/external" },
  );
  files.attachFile(fileContext, "/external/a.md", "saved");
  files.updateBuffer(fileContext, "/external/a.md", "unsaved edits");
  controller.update(first!, { dirty: true });
  assert.equal(await openFileLink(opener, context, "file:///external/a.md#L30"), first);
  assert.equal(files.getSnapshot(fileContext, "/external/a.md")?.content, "unsaved edits");
  assert.deepEqual(store.getState().surfaceOrder, [first]);
  assert.equal(store.getState().surfaces[first!]?.dirty, true);
  assert.equal(store.getState().surfaces[first!]?.params.source, "local");
  assert.equal(store.getState().open, true);
  const image = await openFileLink(opener, { applicationId: "test" }, "/external/a.png");
  assert.equal(store.getState().surfaces[image!]?.params.encoding, null);
  assert.equal(store.getState().surfaces[image!]?.params.viewMode, "preview");
  assert.deepEqual(metadataCalls, ["/external/a.md", "/external/a.png"]);
  controller.dispose();
});
