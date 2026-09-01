import assert from "node:assert/strict";
import test from "node:test";

import { MemoryFileDiffService } from "./file-diff-service";
import {
  BufferedFileWorkspaceService,
  fileWorkspaceContext,
  fileWorkspaceOpenableResource,
  MemoryFileWorkspaceService,
  resolveFileWorkspaceSession,
  workspaceRelativePath,
  type FileWorkspaceBackend,
} from "./workspace-file-service";

const firstScope = { type: "thread" as const, key: "thread-1" };
const secondScope = { type: "thread" as const, key: "thread-2" };
const path = "/workspace/app.ts";
const firstContext = { scope: firstScope, rootPath: "/workspace" };
const secondContext = { scope: secondScope, rootPath: "/workspace" };

test("file buffers and notifications are isolated by workspace scope", async () => {
  const files = new MemoryFileWorkspaceService();
  let firstNotifications = 0;
  const unsubscribe = files.watchPath(firstContext, path, () => {
    firstNotifications += 1;
  });

  files.attachFile(firstContext, path, "first");
  files.attachFile(secondContext, path, "second");

  assert.equal(files.getSnapshot(firstContext, path)?.content, "first");
  assert.equal(files.getSnapshot(secondContext, path)?.content, "second");
  assert.equal(firstNotifications, 1);
  assert.deepEqual((await files.listDirectory(firstContext, "/workspace")).nodes, [
    {
      path,
      relativePath: "app.ts",
      name: "app.ts",
      kind: "file",
      hidden: false,
    },
  ]);

  files.updateBuffer(secondContext, path, "second edit");
  assert.equal(firstNotifications, 1);
  assert.equal(files.getSnapshot(firstContext, path)?.content, "first");

  files.updateBuffer(firstContext, path, "first edit");
  assert.equal(firstNotifications, 2);
  assert.equal(files.getSnapshot(firstContext, path)?.content, "first edit");

  unsubscribe();
});

test("separate Workbench installations do not share file buffers, listeners, or diffs", () => {
  const firstFiles = new MemoryFileWorkspaceService();
  const secondFiles = new MemoryFileWorkspaceService();
  const firstDiffs = new MemoryFileDiffService();
  const secondDiffs = new MemoryFileDiffService();
  const sameContext = {
    scope: { type: "thread" as const, key: "same-thread" },
    rootPath: "/workspace",
  };
  let firstNotifications = 0;
  const unsubscribe = firstFiles.watchPath(sameContext, path, () => {
    firstNotifications += 1;
  });

  firstFiles.attachFile(sameContext, path, "from-first-sidecar");
  secondFiles.attachFile(sameContext, path, "from-second-sidecar");
  firstDiffs.upsert(path, { id: "same-diff", lines: [{ kind: "added", text: "first" }] });
  secondDiffs.upsert(path, { id: "same-diff", lines: [{ kind: "removed", text: "second" }] });

  assert.equal(firstFiles.getSnapshot(sameContext, path)?.content, "from-first-sidecar");
  assert.equal(secondFiles.getSnapshot(sameContext, path)?.content, "from-second-sidecar");
  assert.equal(firstNotifications, 1);
  assert.deepEqual(firstDiffs.get("same-diff")?.lines, [{ kind: "added", text: "first" }]);
  assert.deepEqual(secondDiffs.get("same-diff")?.lines, [{ kind: "removed", text: "second" }]);
  unsubscribe();
});

test("file notifications normalize Windows paths and include parent watchers", () => {
  const files = new MemoryFileWorkspaceService();
  const context = { scope: firstScope, rootPath: "C:\\work" };
  let directoryNotifications = 0;
  let fileNotifications = 0;
  const unsubscribeDirectory = files.watchPath(context, "c:/WORK/src", () => {
    directoryNotifications += 1;
  });
  const unsubscribeFile = files.watchPath(context, "C:\\work\\src\\app.ts", () => {
    fileNotifications += 1;
  });

  files.attachFile(context, "C:/work/src/app.ts", "source");

  assert.equal(directoryNotifications, 1);
  assert.equal(fileNotifications, 1);
  assert.equal(files.getSnapshot(context, "c:\\WORK\\src\\app.ts")?.content, "source");

  unsubscribeDirectory();
  unsubscribeFile();
});

test("workspace root watchers receive descendant notifications", () => {
  const files = new MemoryFileWorkspaceService();
  const context = { scope: firstScope, rootPath: "/" };
  let notifications = 0;
  const unsubscribe = files.watchPath(context, "/", () => {
    notifications += 1;
  });

  files.attachFile(context, "/src/app.ts", "source");

  assert.equal(notifications, 1);
  unsubscribe();
});

test("memory listings synthesize direct directories instead of flattening descendants", async () => {
  const files = new MemoryFileWorkspaceService();
  files.attachFile(firstContext, "/workspace/src/nested/app.ts", "source");
  files.attachFile(firstContext, "/workspace/README.md", "readme");

  assert.deepEqual(
    (await files.listDirectory(firstContext, "/workspace")).nodes.map((node) => ({
      name: node.name,
      kind: node.kind,
      relativePath: node.relativePath,
    })),
    [
      { name: "src", kind: "directory", relativePath: "src" },
      { name: "README.md", kind: "file", relativePath: "README.md" },
    ],
  );
  assert.deepEqual(
    (await files.listDirectory(firstContext, "/workspace/src")).nodes.map((node) => ({
      name: node.name,
      kind: node.kind,
      relativePath: node.relativePath,
    })),
    [{ name: "nested", kind: "directory", relativePath: "src/nested" }],
  );
});

test("Pi-backed file operations use workspace identity while caching by UI scope", async () => {
  const calls: Array<{ method: string; payload: unknown }> = [];
  const snapshot = {
    workspaceId: "workspace-1",
    relativePath: "code/main.fixture",
    absolutePath: "/project/code/main.fixture",
    name: "main.fixture",
    content: "source",
    encoding: "utf-8" as const,
    version: "sha256:source",
    size: 6,
    modifiedAt: 1,
  };
  const descriptor = {
    workspaceId: snapshot.workspaceId,
    relativePath: snapshot.relativePath,
    absolutePath: snapshot.absolutePath,
    name: snapshot.name,
    mediaType: "text/typescript",
    encoding: "utf-8" as const,
    version: "stat-sha256:source",
    size: snapshot.size,
    modifiedAt: snapshot.modifiedAt,
  };
  const backend: FileWorkspaceBackend = {
    contentUrl: ({ workspaceId, relativePath }) =>
      `/api/workspace.files.content?workspaceId=${workspaceId}&relativePath=${encodeURIComponent(relativePath)}`,
    listDirectory: async (payload) => {
      calls.push({ method: "list", payload });
      return {
        workspaceId: "workspace-1",
        relativePath: "code",
        absolutePath: "/project/code",
        entries: [],
        truncated: false,
      };
    },
    describeFile: async (payload) => {
      calls.push({ method: "describe", payload });
      return descriptor;
    },
    readFile: async (payload) => {
      calls.push({ method: "read", payload });
      return snapshot;
    },
    writeFile: async (payload) => {
      calls.push({ method: "write", payload });
      return { ...snapshot, content: payload.content, version: "sha256:updated" };
    },
  };
  const files = new BufferedFileWorkspaceService(backend);
  const context = { ...firstContext, rootPath: "/project", workspaceId: "workspace-1" };

  await files.listDirectory(context, "/project/code");
  const described = await files.describeFile(context, "/project/code/main.fixture");
  const opened = await files.readFile(context, "/project/code/main.fixture");
  files.updateBuffer(context, opened.path, "edited");
  const saved = await files.writeFile(context, opened.path, "edited", opened.version);

  assert.equal(saved.content, "edited");
  assert.equal(
    described.contentUrl,
    "/api/workspace.files.content?workspaceId=workspace-1&relativePath=code%2Fmain.fixture",
  );
  assert.equal(files.getSnapshot(context, opened.path)?.source, "workspace");
  assert.deepEqual(calls, [
    {
      method: "list",
      payload: { workspaceId: "workspace-1", relativePath: "code" },
    },
    {
      method: "describe",
      payload: { workspaceId: "workspace-1", relativePath: "code/main.fixture" },
    },
    {
      method: "read",
      payload: { workspaceId: "workspace-1", relativePath: "code/main.fixture" },
    },
    {
      method: "write",
      payload: {
        workspaceId: "workspace-1",
        relativePath: "code/main.fixture",
        content: "edited",
        expectedVersion: "sha256:source",
      },
    },
  ]);
});

test("resource file sessions share directory, read, and opener behavior", async () => {
  const calls: Array<{ method: string; payload: unknown }> = [];
  const rootPath = "/home/user/.pi/agent/extensions/review";
  const backend: FileWorkspaceBackend = {
    listDirectory: async () => assert.fail("A resource session must not use workspace listing"),
    describeFile: async () => assert.fail("A resource session must not use workspace describe"),
    readFile: async () => assert.fail("A resource session must not use workspace reads"),
    writeFile: async () => assert.fail("A resource session must not use workspace writes"),
    listExtensionDirectory: async (payload) => {
      calls.push({ method: "list", payload });
      return {
        extensionName: "review",
        rootPath,
        relativePath: "lib",
        entries: [
          {
            name: "prompt.ts",
            relativePath: "lib/prompt.ts",
            kind: "file",
            hidden: false,
          },
        ],
        truncated: false,
      };
    },
    readExtensionFile: async (payload) => {
      calls.push({ method: "read", payload });
      return {
        extensionName: "review",
        rootPath,
        relativePath: "lib/prompt.ts",
        absolutePath: `${rootPath}/lib/prompt.ts`,
        name: "prompt.ts",
        content: "export const prompt = 'review';\n",
        mediaType: "text/typescript",
        encoding: "utf-8",
        version: "sha256:prompt",
        size: 32,
        modifiedAt: 1,
      };
    },
  };
  const files = new BufferedFileWorkspaceService(backend);
  const params = {
    source: "extension" as const,
    rootPath,
    resourceTarget: { scope: "user" as const },
    extensionName: "review",
    extensionFilePath: `${rootPath}/index.ts`,
    extensionSource: "auto",
    extensionScope: "user" as const,
    extensionOrigin: "top-level" as const,
  };
  const session = resolveFileWorkspaceSession(params);
  assert.ok(session);
  const context = fileWorkspaceContext(firstScope, session);

  const listing = await files.listDirectory(context, "lib");
  const opened = await files.readFile(context, "lib/prompt.ts");
  assert.equal(listing.nodes[0]?.path, `${rootPath}/lib/prompt.ts`);
  assert.equal(opened.source, "resource");
  assert.deepEqual(fileWorkspaceOpenableResource(context.session!, listing.nodes[0]!), {
    scheme: "extension-file",
    path: `${rootPath}/lib/prompt.ts`,
    label: "prompt.ts",
    metadata: {
      resourceTarget: { scope: "user" },
      extensionName: "review",
      extensionFilePath: `${rootPath}/index.ts`,
      extensionSource: "auto",
      extensionScope: "user",
      extensionOrigin: "top-level",
      relativePath: "lib/prompt.ts",
    },
  });
  assert.deepEqual(calls, [
    {
      method: "list",
      payload: {
        target: { scope: "user" },
        name: "review",
        filePath: `${rootPath}/index.ts`,
        source: "auto",
        scope: "user",
        origin: "top-level",
        relativePath: "lib",
      },
    },
    {
      method: "read",
      payload: {
        target: { scope: "user" },
        name: "review",
        filePath: `${rootPath}/index.ts`,
        source: "auto",
        scope: "user",
        origin: "top-level",
        relativePath: "lib/prompt.ts",
      },
    },
  ]);
});

test("file workspace sessions require complete identities and accept path aliases", () => {
  assert.equal(
    resolveFileWorkspaceSession({
      source: "extension",
      rootPath: "/home/user/.pi/agent/extensions/review",
      sessionId: "session-1",
      extensionName: "review",
      extensionFilePath: "/home/user/.pi/agent/extensions/review/index.ts",
      extensionSource: "auto",
      extensionScope: "user",
    }),
    undefined,
  );
  assert.deepEqual(
    resolveFileWorkspaceSession({
      source: "skill",
      rootPath: "/home/user/.pi/agent/skills/review",
      resourceTarget: { scope: "project", workspaceId: "project-1" },
      skillName: "review",
    }),
    {
      source: "skill",
      rootPath: "/home/user/.pi/agent/skills/review",
      resourceTarget: { scope: "project", workspaceId: "project-1" },
      skillName: "review",
    },
  );
  assert.equal(
    resolveFileWorkspaceSession({ absolutePath: "/project/code/main.fixture" }),
    undefined,
  );
  assert.deepEqual(
    resolveFileWorkspaceSession({
      source: "workspace",
      rootPath: "/project",
      workspaceId: "workspace-1",
      absolutePath: "/project/code/main.fixture",
    }),
    { source: "workspace", rootPath: "/project", workspaceId: "workspace-1" },
  );
  assert.deepEqual(
    resolveFileWorkspaceSession({
      source: "workspace",
      rootPath: "/home/user/project",
      workspaceId: "workspace-1",
      absolutePath: "/project/code/main.fixture",
    }),
    { source: "workspace", rootPath: "/home/user/project", workspaceId: "workspace-1" },
  );
});

test("workspaceRelativePath rejects paths outside the authoritative root", () => {
  assert.equal(
    workspaceRelativePath("/project", "/project/code/main.fixture"),
    "code/main.fixture",
  );
  assert.equal(workspaceRelativePath("C:\\work", "C:\\work\\src\\app.ts"), "src/app.ts");
  assert.throws(() => workspaceRelativePath("/workspace", "/other/app.ts"), /outside/);
  assert.throws(() => workspaceRelativePath("/workspace", "../other/app.ts"), /outside/);
});
