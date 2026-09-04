import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { OpenSurfaceRequest } from "@workbench/extension-sdk";
import { ExtensionManager } from "@workbench/extension-sdk/internal";
import { createPiAgentRuntimeInstallation } from "@workbench/agent-runtime-pi-client/installation";
import {
  usePiResourceClient,
  type PiResourceClient,
} from "@workbench/agent-runtime-pi-client/resources";
import {
  createSameOriginRuntimeConnection,
  RuntimeConnectionProvider,
} from "@workbench/shell/runtime-connection";
import { createWorkspaceDirectoryStoreInstallation } from "@workbench/shell/workspace-directory-store";
import { useWorkspaceFileRuntime } from "@workbench/shell/workspace-files";
import { PiAgentRuntimeContributionsProvider } from "../../src/public/installation";
import { createPiResourceFileOpenHandlers } from "../../src/services/pi-resource-file-openers";
import {
  createPiResourceFileOpenersBinding,
  registerPiResourceFileOpeners,
} from "../../src/services/pi-resource-file-openers-bridge";
import { toolboxExtension } from "../../src/extensions/toolbox/extension";

test("Toolbox owns Pi resource opener registration, binding, rollback, and disposal", () => {
  const manager = new ExtensionManager();
  const activation = manager.activate(toolboxExtension);
  assert.deepEqual(
    manager.openers.getAll().map(({ id }) => id),
    [
      "workspace.file.skill",
      "workspace.directory.skill",
      "workspace.file.extension",
      "workspace.directory.extension",
    ],
  );
  assert.deepEqual(
    manager.slots.get("shell.overlay").map(({ id }) => id),
    ["workbench.toolbox.file-openers"],
  );
  activation.dispose();
  assert.deepEqual(manager.openers.getAll(), []);
  assert.deepEqual(manager.slots.get("shell.overlay"), []);

  const binding = createPiResourceFileOpenersBinding();
  const registration = registerPiResourceFileOpeners(manager.openers, binding);
  const opener = manager.openers.getAll()[0]!;
  const request = {
    resource: {
      scheme: "skill-file",
      path: "SKILL.md",
      metadata: {
        sessionId: "session-1",
        skillName: "example",
        relativePath: "SKILL.md",
      },
    },
    context: { applicationId: "test" },
  };
  assert.equal(opener.canOpen(request), 0);
  const runtime = { files: {} as never, diffs: {} as never };
  const first = binding.connect(runtime, {} as PiResourceClient);
  const second = binding.connect(runtime, {} as PiResourceClient);
  first.dispose();
  assert.equal(opener.canOpen(request), 100);
  second.dispose();
  second.dispose();
  assert.equal(opener.canOpen(request), 0);
  registration.dispose();

  const collision = manager.openers.register({
    id: "workspace.directory.skill",
    canOpen: () => 0,
    open: () => undefined,
  });
  assert.throws(
    () => registerPiResourceFileOpeners(manager.openers, binding),
    /already registered/u,
  );
  assert.deepEqual(
    manager.openers.getAll().map(({ id }) => id),
    ["workspace.directory.skill"],
  );
  collision.dispose();
});

function fileOpenHandlers() {
  let handlers: ReturnType<typeof createPiResourceFileOpenHandlers> | undefined;
  function Capture() {
    const runtime = useWorkspaceFileRuntime();
    const resources = usePiResourceClient();
    handlers = createPiResourceFileOpenHandlers(runtime.files, resources);
    return null;
  }
  const installation = createPiAgentRuntimeInstallation({
    copy: {
      titles: { attachment: "Attachment", image: "Image" },
      errors: {
        sessionBusy: "Busy",
        emptyPrompt: "Empty",
        sessionNotFound: "Missing",
        invalidWorkingDirectory: "Invalid directory",
        invalidWorkspace: "Invalid workspace",
        modelNotAvailable: "Model unavailable",
        requestFailed: "Request failed",
      },
    },
    workspaceDirectoryStore: createWorkspaceDirectoryStoreInstallation().port,
    transport: { http: (path, init) => globalThis.fetch(path, init) },
  });
  renderToStaticMarkup(
    createElement(RuntimeConnectionProvider, {
      connection: createSameOriginRuntimeConnection("http://localhost"),
      children: installation.render(
        createElement(PiAgentRuntimeContributionsProvider, { children: createElement(Capture) }),
      ),
    }),
  );
  assert.ok(handlers);
  return handlers;
}

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
