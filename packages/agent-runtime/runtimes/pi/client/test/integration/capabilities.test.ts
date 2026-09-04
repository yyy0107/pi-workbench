import { createTestServices } from "./services-fixture";
import type {
  ModelProvidersValue,
  ModelCatalogValue,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import assert from "node:assert/strict";
import test from "node:test";

import { WorkbenchAgentCapabilityError } from "@workbench/agent-runtime-client/capabilities";
import type { WorkbenchContextPolicyValue } from "@workbench/agent-runtime-contracts/runtime-capabilities";

import {
  createPiAgentRuntimeCapabilities as createCapabilities,
  projectPiCapabilityError,
} from "../../src/integration/capabilities";
import type { PiSessionManager } from "../../src/runtime/manager";
import { PiApiError, type PiHttpTransport } from "../../src/transport/api";

const contextValue: WorkbenchContextPolicyValue = {
  policy: { mode: "inherit" },
  overridden: false,
  compaction: { enabled: true, reserveTokens: 1_000, keepRecentTokens: 2_000 },
  usage: { tokens: 300, percent: 3 },
  nearingCompaction: false,
};

function transportFor(values: Readonly<Record<string, unknown>>): PiHttpTransport {
  return async (_path, init) => {
    const request = JSON.parse(String(init?.body)) as { rpcId: string; method: string };
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: { ok: true, value: values[request.method] },
    });
  };
}

function fixtureManager(transportOverride?: PiHttpTransport): PiSessionManager {
  const transport = transportFor({
    "host.listDirectory": {
      path: "/workspace",
      home: "/home/test",
      crumbs: [{ name: "workspace", path: "/workspace", hidden: false }],
      entries: [],
      truncated: false,
    },
    "workspace.create": {
      workspace: {
        workspaceId: "workspace-1",
        title: "Workspace",
        path: "/workspace",
        sessionIds: [],
        createdAt: "2026-09-04T00:00:00.000Z",
        updatedAt: "2026-09-04T00:00:00.000Z",
      },
      created: true,
    },
    "llm.models": { groups: [], failures: [] },
    "automation.list": { items: [] },
    "imageUnderstanding.describe": {
      revision: 4,
      value: { routing: "disabled" },
    },
  });
  const interaction = {
    kind: "question" as const,
    rpcId: "request-1",
    sessionId: "session-1",
    questions: [{ id: "answer", question: "Continue?" }],
  };
  const session = {
    setDraftModelSelection: () => undefined,
    reload: async () => undefined,
  };

  return {
    rpcTransportOptions: { transport: transportOverride ?? transport },
    modelCatalogInvalidation: {
      getRevision: () => 2,
      subscribe: () => () => undefined,
      getSessionSelectionRevision: () => 3,
      subscribeSessionSelection: () => () => undefined,
    },
    getSnapshot: () => 7,
    subscribe: () => () => undefined,
    getPendingInteractions: () => [interaction],
    respondInteraction: async () => ({ accepted: true as const }),
    createScratchSession: async ({ sourceSessionId }: { sourceSessionId: string }) => ({
      sessionId: "scratch-1",
      sourceSessionId,
      expiresAt: 100,
    }),
    restoreScratchSession: () => true,
    releaseScratchSession: async () => undefined,
    promoteScratchSession: async ({ sessionId }: { sessionId: string }) => ({
      sessionId,
      sourceSessionId: "session-1",
    }),
    contextPolicies: {
      getSnapshot: () => ({ status: "ready" as const, value: contextValue }),
      subscribe: () => () => undefined,
      load: async () => contextValue,
      update: async () => contextValue,
      compact: async () => contextValue,
    },
    selectSessionModel: async ({
      provider,
      model,
      reasoningEffort,
    }: {
      provider: string;
      model: string;
      reasoningEffort?: string;
    }) => ({ selected: { provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) } }),
    session: () => session,
  } as unknown as PiSessionManager;
}

test("projects every Pi implementation capability through the Workbench contract", async () => {
  const capabilities = createPiAgentRuntimeCapabilities(fixtureManager());
  assert.ok(capabilities.host);
  assert.ok(capabilities.workspace);
  assert.ok(capabilities.models);
  assert.ok(capabilities.interactions);
  assert.ok(capabilities.scratchSessions);
  assert.ok(capabilities.context);
  assert.ok(capabilities.automation);
  assert.ok(capabilities.attachmentUnderstanding);

  assert.equal((await capabilities.host.listDirectory()).path, "/workspace");
  assert.deepEqual(await capabilities.workspace.createWorkspace("/workspace"), {
    workspace: { id: "workspace-1", name: "Workspace", rootPath: "/workspace" },
    created: true,
  });
  assert.deepEqual(await capabilities.models.listCatalog(), { groups: [], failures: [] });
  assert.deepEqual(capabilities.interactions.getPendingInteractions(), [
    {
      kind: "question",
      requestId: "request-1",
      sessionId: "session-1",
      questions: [{ id: "answer", question: "Continue?" }],
    },
  ]);
  await capabilities.interactions.respondInteraction("request-1", {
    kind: "question",
    answers: [{ id: "answer", selected: ["yes"] }],
  });
  assert.equal(
    (await capabilities.scratchSessions.createScratchSession({ sourceSessionId: "session-1" }))
      .sessionId,
    "scratch-1",
  );
  assert.equal((await capabilities.context.load("session-1")).usage.tokens, 300);
  assert.deepEqual(await capabilities.automation.list({}), { items: [] });
  assert.equal((await capabilities.attachmentUnderstanding.describe()).revision, 4);
});

test("host, trust, files, and Git preserve RPC payloads while projecting results and failures", async () => {
  const calls: unknown[] = [];
  let value: unknown;
  let failure: string | undefined;
  const capabilities = createPiAgentRuntimeCapabilities(
    fixtureManager(async (_path, init) => {
      const { rpcId, method, payload } = JSON.parse(String(init?.body));
      calls.push({ method, payload });
      return Response.json({
        type: "server-response",
        rpcId,
        result: failure
          ? { ok: false, error: { code: failure, message: failure, details: {} } }
          : { ok: true, value },
      });
    }),
  );
  const host = capabilities.host!;
  const workspace = capabilities.workspace!;
  const trust = { path: "/workspace", requiresTrust: true, trusted: true, promptRequired: false };
  const app = { id: "editor", name: "Editor", kind: "editor", supportedFileKinds: ["text"] };
  const request = { workspaceId: "workspace-1", relativePath: "src/app.ts" };
  const file = {
    ...request,
    absolutePath: "/workspace/src/app.ts",
    name: "app.ts",
    content: "source",
    encoding: "utf-8",
    version: "v1",
    size: 6,
    modifiedAt: 1,
  };
  const write = { ...request, content: "edited", expectedVersion: "v1" };
  const git = {
    repository: true,
    branch: "main",
    branches: ["main"],
    changedFileCount: 0,
    changedFiles: [],
    changedFilesTruncated: false,
  };
  const branch = { workspaceId: "workspace-1", branch: "feature" };
  const cases = [
    {
      method: "host.pickDirectory",
      payload: {},
      value: { path: "/workspace" },
      expected: "/workspace",
      run: () => host.pickDirectory(),
      failure: "directory-picker-unavailable",
      code: "unavailable",
    },
    {
      method: "host.createDirectory",
      payload: { path: "/", name: "workspace" },
      value: { path: "/workspace" },
      expected: "/workspace",
      run: () => host.createDirectory("/", "workspace"),
      failure: "permission-denied",
      code: "permission-denied",
    },
    {
      method: "projectTrust.describe",
      payload: { path: "/workspace" },
      value: trust,
      expected: trust,
      run: () => host.describeProjectTrust("/workspace"),
      failure: "project-path-invalid",
      code: "invalid-request",
    },
    {
      method: "projectTrust.update",
      payload: { path: "/workspace", trusted: true },
      value: trust,
      expected: trust,
      run: () => host.updateProjectTrust("/workspace", true),
      failure: "permission-denied",
      code: "permission-denied",
    },
    {
      method: "host.localApps.list",
      payload: {},
      value: { apps: [app] },
      expected: [app],
      run: () => host.listLocalApps(),
      failure: "local-app-unavailable",
      code: "unavailable",
    },
    {
      method: "host.localApps.open",
      payload: { appId: "editor", target: file.absolutePath },
      value: { opened: true },
      expected: undefined,
      run: () => host.openLocalApp({ appId: "editor", target: file.absolutePath }),
      failure: "local-app-not-found",
      code: "not-found",
    },
    {
      method: "workspace.files.read",
      payload: request,
      value: file,
      expected: file,
      run: () => workspace.readFile(request),
      failure: "workspace-file-not-found",
      code: "not-found",
    },
    {
      method: "workspace.files.write",
      payload: write,
      value: { ...file, content: "edited" },
      expected: { ...file, content: "edited" },
      run: () => workspace.writeFile(write),
      failure: "workspace-file-conflict",
      code: "conflict",
    },
    {
      method: "workspace.git.describe",
      payload: { workspaceId: "workspace-1" },
      value: git,
      expected: git,
      run: () => workspace.describeGit("workspace-1"),
      failure: "workspace-not-found",
      code: "not-found",
    },
    {
      method: "workspace.git.switchBranch",
      payload: branch,
      value: git,
      expected: git,
      run: () => workspace.switchGitBranch("workspace-1", "feature"),
      failure: "session-busy",
      code: "busy",
    },
    {
      method: "workspace.git.createBranch",
      payload: branch,
      value: git,
      expected: git,
      run: () => workspace.createGitBranch("workspace-1", "feature"),
      failure: "git-branch-exists",
      code: "conflict",
    },
  ];
  for (const entry of cases) {
    value = entry.value;
    failure = undefined;
    assert.deepEqual(await entry.run(), entry.expected);
    failure = entry.failure;
    await assert.rejects(entry.run, { code: entry.code });
    assert.deepEqual(
      calls.splice(0),
      Array(2).fill({ method: entry.method, payload: entry.payload }),
    );
  }
  value = { path: null };
  failure = undefined;
  assert.equal(await host.pickDirectory(), undefined);
});

test("file preview capability uses the installation transport for blobs, streams, and cancellation", async () => {
  const request = { workspaceId: "workspace-1", relativePath: "src/文档.txt" };
  const text = "streamed 文档";
  const bytes = new TextEncoder().encode(text).byteLength;
  const controller = new AbortController();
  const workspace = createPiAgentRuntimeCapabilities(
    fixtureManager(async (path, init): Promise<Response> => {
      assert.equal(path, workspace.fileContentUrl(request));
      assert.equal(init?.signal, controller.signal);
      return new Response(text, { headers: { "Content-Length": String(bytes) } });
    }),
  ).workspace!;
  assert.equal(
    await (await workspace.fetchFileContent(request, { signal: controller.signal })).text(),
    text,
  );
  const chunks: unknown[] = [];
  assert.deepEqual(
    await workspace.streamFileText(request, {
      signal: controller.signal,
      onChunk: (chunk) => {
        chunks.push(chunk);
      },
    }),
    { loadedBytes: bytes, totalBytes: bytes },
  );
  assert.deepEqual(chunks, [{ text, loadedBytes: bytes, totalBytes: bytes }]);
  await assert.rejects(
    () =>
      workspace.streamFileText(request, {
        signal: controller.signal,
        onChunk: () => controller.abort(),
      }),
    { code: "cancelled" },
  );
});

test("maps Pi implementation failures to stable Workbench capability errors", () => {
  const cases = [
    ["workspace-file-conflict", 409, "conflict"],
    ["agent-busy", 409, "busy"],
    ["directory-picker-unavailable", 501, "unavailable"],
    ["session-not-found", 404, "not-found"],
    ["pi_interaction_not_found", 404, "request-ended"],
    ["git-branch-invalid", 400, "invalid-request"],
    ["workspace_file_content_failed", 404, "not-found"],
  ] as const;

  for (const [piCode, status, expected] of cases) {
    const error = projectPiCapabilityError(new PiApiError(piCode, status, { marker: piCode }));
    assert.ok(error instanceof WorkbenchAgentCapabilityError);
    assert.equal(error.code, expected);
    assert.deepEqual(error.details, { marker: piCode });
  }

  assert.equal(
    projectPiCapabilityError(new PiApiError("pi_rpc_invalid_response", 200, { method: "x" })).code,
    "failed",
  );
  assert.equal(
    projectPiCapabilityError(new PiApiError("pi_rpc_transport_failed", 503, { method: "x" }))
      .details,
    undefined,
  );
});

test("session capabilities preserve interaction, scratch, model, and context behavior across the Pi boundary", async () => {
  const manager = fixtureManager();
  const calls: unknown[] = [];
  const question = manager.getPendingInteractions()[0]!;
  Object.assign(manager, {
    getPendingInteractions: () => [
      question,
      {
        kind: "approval",
        rpcId: "approval-request",
        sessionId: "session-1",
        approvalId: "approval-1",
        toolName: "bash",
        callId: "call-1",
      },
    ],
    restoreScratchSession: (scratch: unknown) => {
      calls.push(["restore", scratch]);
      return true;
    },
    releaseScratchSession: async (id: string) => {
      calls.push(["release", id]);
    },
    promoteScratchSession: async (request: { sessionId: string; title?: string }) => {
      calls.push(["promote", request]);
      return { sessionId: request.sessionId, sourceSessionId: "session-1" };
    },
    respondInteraction: async (...args: unknown[]) => {
      calls.push(["respond", ...args]);
      return { accepted: true };
    },
    selectSessionModel: async ({
      sessionId,
      ...selection
    }: {
      sessionId: string;
      provider: string;
      model: string;
      reasoningEffort?: string;
    }) => {
      calls.push(["select", sessionId, selection]);
      return { selected: selection };
    },
  });
  const {
    interactions,
    scratchSessions: scratch,
    models,
    context,
  } = createPiAgentRuntimeCapabilities(manager);
  assert.ok(interactions && scratch && models && context);
  assert.deepEqual(interactions.getPendingInteractions()[1], {
    kind: "approval",
    requestId: "approval-request",
    sessionId: "session-1",
    approvalId: "approval-1",
    toolName: "bash",
    callId: "call-1",
  });
  await interactions.respondInteraction("approval-request", {
    kind: "approval",
    outcome: "allowed-once",
  });
  await interactions.respondInteraction("request-1", { kind: "cancel" });
  const created = await scratch.createScratchSession({ sourceSessionId: "session-1" });
  assert.equal(scratch.restoreScratchSession(created), true);
  await scratch.releaseScratchSession(created.sessionId);
  assert.deepEqual(
    await scratch.promoteScratchSession({ sessionId: created.sessionId, title: "Kept" }),
    { sessionId: "scratch-1", sourceSessionId: "session-1" },
  );
  assert.deepEqual(calls, [
    ["respond", "approval-request", { kind: "approval", outcome: "allowed-once" }],
    ["respond", "request-1", { kind: "cancel" }],
    ["restore", created],
    ["release", "scratch-1"],
    ["promote", { sessionId: "scratch-1", title: "Kept" }],
  ]);
  for (const [reason, code] of [
    ["not-pending", "request-ended"],
    ["bad-response", "invalid-request"],
  ] as const) {
    Object.assign(manager, { respondInteraction: async () => ({ accepted: false, reason }) });
    await assert.rejects(
      interactions.respondInteraction("request-1", { kind: "question", answers: [] }),
      { name: "WorkbenchAgentCapabilityError", code },
    );
  }
  assert.equal(models.getCatalogRevision(), 2);
  assert.equal(models.getSessionSelectionRevision("session-1"), 3);
  const selection = { provider: "provider", model: "model", reasoningEffort: "high" };
  assert.deepEqual(await models.selectSessionModel("session-1", selection), selection);
  assert.deepEqual(calls.at(-1), ["select", "session-1", selection]);
  models.setDraftSelection("draft-1", selection);
  await models.reloadSession("session-1");
  assert.equal(
    await context.update("session-1", { mode: "custom", desiredContextTokens: 1000 }),
    contextValue,
  );
  assert.equal(await context.compact("session-1"), contextValue);
  const failed = { status: "failed", error: new PiApiError("agent-busy", 409) };
  Object.assign(manager.contextPolicies, {
    getSnapshot: () => failed,
    compact: async () => {
      throw failed.error;
    },
  });
  const snapshot = context.getSnapshot("session-1");
  assert.equal(
    snapshot,
    context.getSnapshot("session-1"),
    "external-store snapshots retain identity",
  );
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.error?.code, "busy");
  await assert.rejects(context.compact("session-1"), {
    name: "WorkbenchAgentCapabilityError",
    code: "busy",
  });
  Object.assign(manager, {
    releaseScratchSession: async () => {
      throw new PiApiError("session-not-found", 404);
    },
  });
  await assert.rejects(scratch.releaseScratchSession("missing"), {
    name: "WorkbenchAgentCapabilityError",
    code: "not-found",
  });
});

test("configured model catalogs filter Pi provider configuration before crossing into Workbench", async () => {
  const directory = {
    providers: [
      {
        provider: "configured",
        displayName: "Configured Provider",
        kind: "built-in",
        settingsNs: "llm.configured",
        settingsPath: [],
        active: true,
        configured: true,
        apiKeyConfigurable: true,
        removable: false,
        configurationDefined: false,
      },
      {
        provider: "custom",
        displayName: "Custom Provider",
        kind: "custom",
        settingsNs: "",
        settingsPath: [],
        active: true,
        configured: false,
        apiKeyConfigurable: true,
        removable: true,
        configurationDefined: true,
      },
      {
        provider: "unconfigured",
        displayName: "Unconfigured Provider",
        kind: "built-in",
        settingsNs: "llm.unconfigured",
        settingsPath: [],
        active: true,
        configured: false,
        apiKeyConfigurable: true,
        removable: false,
        configurationDefined: false,
      },
      {
        provider: "configured-text",
        displayName: "Configured Text Provider",
        kind: "custom",
        settingsNs: "",
        settingsPath: [],
        active: true,
        configured: true,
        apiKeyConfigurable: true,
        removable: true,
        configurationDefined: true,
      },
      {
        provider: "configured-unknown",
        displayName: "Configured Unknown Provider",
        kind: "custom",
        settingsNs: "",
        settingsPath: [],
        active: true,
        configured: true,
        apiKeyConfigurable: true,
        removable: true,
        configurationDefined: true,
      },
    ],
  } as const satisfies ModelProvidersValue;

  const catalog = {
    groups: [
      {
        id: "configured",
        name: "Catalog Provider Name",
        models: [
          {
            id: "vision",
            name: "Vision Model",
            input: ["text", "image"],
            imageInput: "supported",
          },
          { id: "text", name: "Text Model", input: ["text"], imageInput: "unsupported" },
        ],
      },
      {
        id: "custom",
        name: "Custom Provider",
        models: [
          {
            id: "custom-vision",
            name: "Custom Vision",
            input: ["image"],
            imageInput: "supported",
          },
        ],
      },
      {
        id: "unconfigured",
        name: "Unconfigured Provider",
        models: [
          {
            id: "hidden-vision",
            name: "Hidden Vision",
            input: ["image"],
            imageInput: "supported",
          },
        ],
      },
      {
        id: "configured-text",
        name: "Configured Text Provider",
        models: [
          {
            id: "text-only",
            name: "Text Only",
            input: ["text"],
            imageInput: "unsupported",
          },
        ],
      },
      {
        id: "configured-unknown",
        name: "Configured Unknown Provider",
        models: [{ id: "unknown", name: "Unknown", imageInput: "unknown" }],
      },
    ],
    failures: [],
  } as const satisfies ModelCatalogValue;

  const capabilities = createPiAgentRuntimeCapabilities(
    fixtureManager(
      transportFor({
        "llm.providers": directory,
        "llm.models": catalog,
      }),
    ),
  );
  const ordinary = await capabilities.models!.listCatalog();
  assert.deepEqual(ordinary, catalog);
  const configured = await capabilities.models!.listCatalog({ configuredOnly: true });
  assert.deepEqual(
    configured.groups.map(({ id, name }) => [id, name]),
    [
      ["configured", "Configured Provider"],
      ["custom", "Custom Provider"],
      ["configured-text", "Configured Text Provider"],
      ["configured-unknown", "Configured Unknown Provider"],
    ],
  );
  assert.deepEqual(configured.groups[0]?.models, catalog.groups[0].models);
  assert.equal("providers" in configured, false);
});

function createPiAgentRuntimeCapabilities(manager: PiSessionManager) {
  return createCapabilities(manager, createTestServices(manager.rpcTransportOptions));
}
