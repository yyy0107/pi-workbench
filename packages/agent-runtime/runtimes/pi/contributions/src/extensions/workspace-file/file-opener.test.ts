import assert from "node:assert/strict";
import test from "node:test";

import type { OpenSurfaceRequest } from "@workbench/extension-sdk";
import {
  listPiExtensionFiles,
  listPiSkillFiles,
  readPiExtensionFile,
  readPiSkillFile,
} from "@workbench/agent-runtime-pi-client/resources";
import {
  describePiWorkspaceFile,
  listPiWorkspaceFiles,
  readPiWorkspaceFile,
  writePiWorkspaceFile,
} from "@workbench/agent-runtime-pi-client/workspace";
import { MemoryFileDiffService } from "@workbench/shell/workspace-files";
import { BufferedFileWorkspaceService } from "../../services/workspace-file-service";

import { createFileOpenHandlers } from "./file-opener";

const resourceClient = {
  listExtensionFiles: listPiExtensionFiles,
  listSkillFiles: listPiSkillFiles,
  readExtensionFile: readPiExtensionFile,
  readSkillFile: readPiSkillFile,
};

function fileOpenHandlers() {
  const files = new BufferedFileWorkspaceService({
    listDirectory: listPiWorkspaceFiles,
    describeFile: describePiWorkspaceFile,
    readFile: readPiWorkspaceFile,
    writeFile: writePiWorkspaceFile,
    listSkillDirectory: resourceClient.listSkillFiles,
    readSkillFile: resourceClient.readSkillFile,
    listExtensionDirectory: resourceClient.listExtensionFiles,
    readExtensionFile: resourceClient.readExtensionFile,
  });
  return createFileOpenHandlers(files, resourceClient, new MemoryFileDiffService());
}

test("the workspace opener rejects the legacy generic file scheme", () => {
  assert.equal(
    fileOpenHandlers().fileOpenHandler.canOpen({
      resource: { scheme: "file", path: "/workspace/src/index.ts" },
      context: {
        applicationId: "pi-workbench",
        threadId: "thread-opener",
        worktreeId: "workspace-opener",
        rootPath: "/workspace",
      },
    }),
    0,
  );
});

test("factory-created file openers keep same-ID installation state and descriptors isolated", async () => {
  const installationFiles = (label: string) =>
    new BufferedFileWorkspaceService({
      listDirectory: async () => ({
        workspaceId: "shared-workspace",
        relativePath: "",
        absolutePath: "/workspace",
        entries: [],
        truncated: false,
      }),
      describeFile: async (payload) => ({
        workspaceId: payload.workspaceId,
        relativePath: payload.relativePath,
        absolutePath: `/workspace/${payload.relativePath}`,
        name: `${label}-${payload.relativePath}`,
        mediaType: "text/plain",
        encoding: "utf-8" as const,
        version: `${label}:version`,
        size: label.length,
        modifiedAt: 1,
      }),
      readFile: async () => {
        throw new Error("The opener only describes files");
      },
      writeFile: async () => {
        throw new Error("The opener only describes files");
      },
    });
  const first = createFileOpenHandlers(
    installationFiles("first-sidecar"),
    resourceClient,
    new MemoryFileDiffService(),
  );
  const second = createFileOpenHandlers(
    installationFiles("second-sidecar"),
    resourceClient,
    new MemoryFileDiffService(),
  );
  const request = {
    resource: { scheme: "workspace-file" as const, path: "src/index.ts" },
    context: {
      applicationId: "pi-workbench",
      threadId: "same-thread",
      worktreeId: "shared-workspace",
      rootPath: "/workspace",
    },
    scope: { type: "thread" as const, key: "same-thread" },
  };
  const revealTitle = async (handler: ReturnType<typeof fileOpenHandlers>["fileOpenHandler"]) => {
    let title: string | undefined;
    await handler.open(request, {
      surfaces: {
        open: () => assert.fail("The file opener should reveal instead of opening duplicates"),
        reveal: (surface) => {
          if (typeof surface.title !== "string") {
            return assert.fail("The file opener title should be a string");
          }
          title = surface.title;
          return "file-surface";
        },
      },
    });
    if (title === undefined) return assert.fail("The file opener did not reveal a Surface");
    return title;
  };

  assert.equal(await revealTitle(first.fileOpenHandler), "first-sidecar-src/index.ts");
  assert.equal(await revealTitle(second.fileOpenHandler), "second-sidecar-src/index.ts");
});

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
  const result = await fileOpenHandlers().fileOpenHandler.open(
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
      source: "workspace",
      rootPath: "/workspace",
      workspaceId: "workspace-opener",
      absolutePath: "/workspace/src/index.ts",
      relativePath: "src/index.ts",
      name: "index.ts",
      mediaType: "text/typescript",
      encoding: "utf-8",
      version: "stat-sha256:index",
      size: 11,
      modifiedAt: 1,
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
  await fileOpenHandlers().fileOpenHandler.open(
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
  const result = await fileOpenHandlers().skillFileOpenHandler.open(
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
  assert.equal(revealed?.params.viewMode, "source");
  assert.equal(revealed?.policy, "force-focus");
});

test("resource directory openers create a file workspace without selecting a file", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const methods: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      rpcId: string;
      method: string;
      payload: Record<string, unknown>;
    };
    methods.push(request.method);
    const extension = request.method === "extension.files.list";
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: {
        ok: true,
        value: {
          ...(extension ? { extensionName: "review" } : { name: "review" }),
          rootPath: extension
            ? "/home/user/.pi/agent/extensions/review"
            : "/home/user/.pi/agent/skills/review",
          relativePath: "",
          entries: [],
          truncated: false,
        },
      },
    });
  };

  const context = {
    applicationId: "pi-workbench",
    threadId: "thread-opener",
    projectId: "workspace-opener",
    rootPath: "/workspace",
  };
  const revealed: OpenSurfaceRequest[] = [];
  const surfaces = {
    open: () => assert.fail("A resource directory should reuse the File Surface"),
    reveal: (request: OpenSurfaceRequest) => {
      revealed.push(request);
      return `file-workspace-${revealed.length}`;
    },
  };

  await fileOpenHandlers().skillDirectoryOpenHandler.open(
    {
      resource: {
        scheme: "skill-directory",
        path: "/home/user/.pi/agent/skills/review",
        label: "review",
        metadata: {
          resourceTarget: { scope: "user" },
          skillName: "review",
        },
      },
      context,
    },
    { surfaces },
  );
  await fileOpenHandlers().extensionDirectoryOpenHandler.open(
    {
      resource: {
        scheme: "extension-directory",
        path: "/home/user/.pi/agent/extensions/review/index.ts",
        label: "review",
        metadata: {
          resourceTarget: { scope: "user" },
          extensionName: "review",
          extensionFilePath: "/home/user/.pi/agent/extensions/review/index.ts",
          extensionSource: "auto",
          extensionScope: "user",
          extensionOrigin: "top-level",
        },
      },
      context,
    },
    { surfaces },
  );

  assert.deepEqual(methods, ["skill.files.list", "extension.files.list"]);
  assert.deepEqual(revealed[0]?.params, {
    source: "skill",
    rootPath: "/home/user/.pi/agent/skills/review",
    resourceTarget: { scope: "user" },
    skillName: "review",
  });
  assert.deepEqual(revealed[1]?.params, {
    source: "extension",
    rootPath: "/home/user/.pi/agent/extensions/review",
    resourceTarget: { scope: "user" },
    extensionName: "review",
    extensionFilePath: "/home/user/.pi/agent/extensions/review/index.ts",
    extensionSource: "auto",
    extensionScope: "user",
    extensionOrigin: "top-level",
  });
  assert.equal(
    revealed.some((request) => "absolutePath" in request.params),
    false,
  );
});

test("the extension file opener reuses the read-only File Surface for nested files", async (t) => {
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
          extensionName: "review",
          rootPath: "/home/user/.pi/agent/extensions/review",
          relativePath: "lib/prompt.ts",
          absolutePath: "/home/user/.pi/agent/extensions/review/lib/prompt.ts",
          name: "prompt.ts",
          content: "export const prompt = 'review';\n",
          mediaType: "video/mp2t",
          encoding: "utf-8",
          version: "sha256:review",
          size: 36,
          modifiedAt: 2,
        },
      },
    });
  };

  const identity = {
    sessionId: "session-1",
    extensionName: "review",
    extensionFilePath: "/home/user/.pi/agent/extensions/review/index.ts",
    extensionSource: "auto",
    extensionScope: "user",
    extensionOrigin: "top-level",
  };
  const context = {
    applicationId: "pi-workbench",
    threadId: "thread-opener",
    projectId: "workspace-opener",
    rootPath: "/workspace",
  };
  assert.equal(
    fileOpenHandlers().extensionFileOpenHandler.canOpen({
      resource: {
        scheme: "extension-file",
        path: identity.extensionFilePath,
        metadata: identity,
      },
      context,
    }),
    0,
  );
  assert.equal(
    fileOpenHandlers().extensionFileOpenHandler.canOpen({
      resource: {
        scheme: "extension-file",
        path: "/home/user/.pi/agent/extensions/review/index.ts",
        metadata: { ...identity, relativePath: "index.ts" },
      },
      context,
    }),
    100,
  );
  let revealed: OpenSurfaceRequest | undefined;
  const result = await fileOpenHandlers().extensionFileOpenHandler.open(
    {
      resource: {
        scheme: "extension-file",
        path: "/home/user/.pi/agent/extensions/review/lib/prompt.ts",
        label: "prompt.ts",
        metadata: { ...identity, relativePath: "lib/prompt.ts" },
      },
      context,
      policy: "force-focus",
    },
    {
      surfaces: {
        open: () => assert.fail("An extension file should reuse the File Surface"),
        reveal: (request) => {
          revealed = request;
          return "extension-file-surface";
        },
      },
    },
  );

  assert.equal(result, "extension-file-surface");
  assert.equal(rpcMethod, "extension.files.read");
  assert.deepEqual(rpcPayload, {
    sessionId: "session-1",
    name: "review",
    filePath: identity.extensionFilePath,
    source: "auto",
    scope: "user",
    origin: "top-level",
    relativePath: "lib/prompt.ts",
  });
  assert.equal(revealed?.kind, "file");
  assert.equal(revealed?.title, "prompt.ts");
  assert.equal(revealed?.params.source, "extension");
  assert.equal(revealed?.params.rootPath, "/home/user/.pi/agent/extensions/review");
  assert.equal(
    revealed?.params.absolutePath,
    "/home/user/.pi/agent/extensions/review/lib/prompt.ts",
  );
  assert.equal(revealed?.params.relativePath, "lib/prompt.ts");
  assert.equal(revealed?.params.viewMode, "source");
  assert.equal(revealed?.policy, "force-focus");
});
