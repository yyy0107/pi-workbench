import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { getAgentDir, VERSION as PI_VERSION } from "@earendil-works/pi-coding-agent";

import type {
  HostDescription,
  ImageUnderstandingDescribeValue,
  LocalAppsListValue,
  ServerResponse,
  WorkbenchSettingsDescribeValue,
  WorkspaceView,
} from "../../rpc-contracts";

const moduleHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier.startsWith(".") &&
      !/\.[^/]+$/.test(specifier) &&
      context.parentURL?.includes("/runtime/pi/")
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
const { handlePiRpcPost } = (await import(
  new URL("./rpc-router.ts", import.meta.url).href
)) as typeof import("./rpc-router");
const { DEFAULT_MAX_RPC_REQUEST_BODY_BYTES } = (await import(
  new URL("./rpc-transport.ts", import.meta.url).href
)) as typeof import("./rpc-transport");
moduleHooks.deregister();

function rpcRequest(
  method: string,
  payload: unknown,
  rpcId = "rpc-1",
  signal?: AbortSignal,
): Request {
  return new Request(`http://127.0.0.1:3000/api/${method}`, {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify({ type: "client-request", rpcId, method, payload }),
    signal,
  });
}

async function rpcValue<Value>(response: Response): Promise<Value> {
  assert.equal(response.status, 200);
  const body = (await response.json()) as ServerResponse<Value>;
  assert.equal(body.type, "server-response");
  if (!body.result.ok) assert.fail(`Unexpected RPC error: ${body.result.error.code}`);
  return body.result.value;
}

test("host.describe reports the embedded Pi version", async () => {
  const description = await rpcValue<HostDescription>(
    await handlePiRpcPost(rpcRequest("host.describe", {}), "host.describe"),
  );

  assert.equal(description.product, "pi-workbench");
  assert.equal(description.piVersion, PI_VERSION);
  assert.equal(description.userPackageDir, path.join(getAgentDir(), "npm"));
});

test("routes project trust decisions through Pi trust.json", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-rpc-project-trust-"));
  const agentDir = path.join(root, "agent");
  const projectPath = path.join(root, "project");
  await mkdir(path.join(projectPath, ".pi", "extensions"), { recursive: true });
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousTrustOverride = process.env.PI_WORKBENCH_TRUST_PROJECT;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  delete process.env.PI_WORKBENCH_TRUST_PROJECT;
  t.after(async () => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousTrustOverride === undefined) delete process.env.PI_WORKBENCH_TRUST_PROJECT;
    else process.env.PI_WORKBENCH_TRUST_PROJECT = previousTrustOverride;
    await rm(root, { recursive: true, force: true });
  });

  const pending = await rpcValue<{
    path: string;
    requiresTrust: boolean;
    trusted: boolean | null;
    promptRequired: boolean;
  }>(
    await handlePiRpcPost(
      rpcRequest("projectTrust.describe", { path: projectPath }),
      "projectTrust.describe",
    ),
  );
  assert.deepEqual(pending, {
    path: projectPath,
    requiresTrust: true,
    trusted: null,
    promptRequired: true,
  });

  const saved = await rpcValue<{ trusted: boolean; decisionPath: string }>(
    await handlePiRpcPost(
      rpcRequest(
        "projectTrust.update",
        { path: projectPath, trusted: true, ignored: true },
        "rpc-project-trust-update",
      ),
      "projectTrust.update",
    ),
  );
  assert.equal(saved.trusted, true);
  assert.equal(saved.decisionPath, projectPath);
  assert.deepEqual(JSON.parse(await readFile(path.join(agentDir, "trust.json"), "utf8")), {
    [projectPath]: true,
  });
});

test("backfills trust for preexisting workspaces without trusting later imports", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-rpc-trust-migration-"));
  const agentDir = path.join(root, "agent");
  const stateFile = path.join(root, "state", "workspaces.json");
  const existingPath = path.join(root, "existing");
  const laterPath = path.join(root, "later");
  await Promise.all([
    mkdir(path.join(existingPath, ".pi", "extensions"), { recursive: true }),
    mkdir(path.join(laterPath, ".pi", "extensions"), { recursive: true }),
    mkdir(path.dirname(stateFile), { recursive: true }),
  ]);
  await writeFile(
    stateFile,
    `${JSON.stringify({
      schemaVersion: 1,
      legacyReconciled: true,
      workspaces: [
        {
          workspaceId: "existing-workspace",
          path: existingPath,
          title: "Existing",
          sessionIds: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      archivedSessionIds: [],
      pinnedWorkspaceIds: [],
      pinnedSessionIds: [],
      ignoredWorkspacePaths: [],
    })}\n`,
  );
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousStateFile = process.env.PI_WORKBENCH_WORKSPACE_STATE_FILE;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_WORKBENCH_WORKSPACE_STATE_FILE = stateFile;
  t.after(async () => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousStateFile === undefined) delete process.env.PI_WORKBENCH_WORKSPACE_STATE_FILE;
    else process.env.PI_WORKBENCH_WORKSPACE_STATE_FILE = previousStateFile;
    await rm(root, { recursive: true, force: true });
  });

  await rpcValue(await handlePiRpcPost(rpcRequest("workspace.list", {}), "workspace.list"));
  assert.deepEqual(JSON.parse(await readFile(path.join(agentDir, "trust.json"), "utf8")), {
    [existingPath]: true,
  });
  assert.equal(
    (JSON.parse(await readFile(stateFile, "utf8")) as Record<string, unknown>)
      .projectTrustMigrationCompleted,
    true,
  );

  await rpcValue(
    await handlePiRpcPost(
      rpcRequest("workspace.create", { path: laterPath }, "rpc-create-later"),
      "workspace.create",
    ),
  );
  await rpcValue(
    await handlePiRpcPost(rpcRequest("workspace.list", {}, "rpc-list-later"), "workspace.list"),
  );
  assert.deepEqual(JSON.parse(await readFile(path.join(agentDir, "trust.json"), "utf8")), {
    [existingPath]: true,
  });
});

test("routes workspace CRUD through the shared RPC transport", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-rpc-router-"));
  const workspacePath = path.join(root, "project");
  await mkdir(workspacePath);
  await writeFile(path.join(workspacePath, "index.ts"), "export const value = 1;\n");
  const previousStateFile = process.env.PI_WORKBENCH_WORKSPACE_STATE_FILE;
  process.env.PI_WORKBENCH_WORKSPACE_STATE_FILE = path.join(root, "state", "workspaces.json");
  t.after(async () => {
    if (previousStateFile === undefined) delete process.env.PI_WORKBENCH_WORKSPACE_STATE_FILE;
    else process.env.PI_WORKBENCH_WORKSPACE_STATE_FILE = previousStateFile;
    await rm(root, { recursive: true, force: true });
  });

  const created = await rpcValue<{ workspace: WorkspaceView; created: boolean }>(
    await handlePiRpcPost(
      rpcRequest("workspace.create", { path: workspacePath, ignored: true }),
      "workspace.create",
    ),
  );
  assert.equal(created.created, true);
  assert.equal(created.workspace.title, "project");

  const duplicate = await rpcValue<{ workspace: WorkspaceView; created: boolean }>(
    await handlePiRpcPost(
      rpcRequest("workspace.create", { path: workspacePath }, "rpc-2"),
      "workspace.create",
    ),
  );
  assert.equal(duplicate.created, false);

  const renamed = await rpcValue<{ workspace: WorkspaceView }>(
    await handlePiRpcPost(
      rpcRequest(
        "workspace.rename",
        { workspaceId: created.workspace.workspaceId, title: "Renamed" },
        "rpc-3",
      ),
      "workspace.rename",
    ),
  );
  assert.equal(renamed.workspace.title, "Renamed");

  const workspaceList = await rpcValue<Record<string, unknown>>(
    await handlePiRpcPost(rpcRequest("workspace.list", {}, "rpc-list"), "workspace.list"),
  );
  assert.deepEqual(Object.keys(workspaceList), ["items", "pinnedWorkspaceIds", "pinnedSessionIds"]);
  const pinned = await rpcValue<{ workspaceId: string; pinned: boolean }>(
    await handlePiRpcPost(
      rpcRequest(
        "workspace.setPinned",
        { workspaceId: created.workspace.workspaceId, pinned: true },
        "rpc-pin",
      ),
      "workspace.setPinned",
    ),
  );
  assert.deepEqual(pinned, { workspaceId: created.workspace.workspaceId, pinned: true });
  const pinnedWorkspaceList = await rpcValue<{
    pinnedWorkspaceIds: string[];
    pinnedSessionIds: string[];
  }>(await handlePiRpcPost(rpcRequest("workspace.list", {}, "rpc-list-pinned"), "workspace.list"));
  assert.deepEqual(pinnedWorkspaceList.pinnedWorkspaceIds, [created.workspace.workspaceId]);
  assert.deepEqual(pinnedWorkspaceList.pinnedSessionIds, []);

  const fileListing = await rpcValue<{
    entries: Array<{ name: string; kind: string; relativePath: string }>;
  }>(
    await handlePiRpcPost(
      rpcRequest("workspace.files.list", { workspaceId: created.workspace.workspaceId }),
      "workspace.files.list",
    ),
  );
  assert.deepEqual(fileListing.entries, [
    {
      name: "index.ts",
      kind: "file",
      relativePath: "index.ts",
      absolutePath: path.join(workspacePath, "index.ts"),
      hidden: false,
    },
  ]);

  const describedFile = await rpcValue<{ mediaType: string; encoding: string | null }>(
    await handlePiRpcPost(
      rpcRequest("workspace.files.describe", {
        workspaceId: created.workspace.workspaceId,
        relativePath: "index.ts",
      }),
      "workspace.files.describe",
    ),
  );
  assert.equal(describedFile.mediaType, "text/plain");
  assert.equal(describedFile.encoding, "utf-8");

  const openedFile = await rpcValue<{ content: string; version: string }>(
    await handlePiRpcPost(
      rpcRequest("workspace.files.read", {
        workspaceId: created.workspace.workspaceId,
        relativePath: "index.ts",
      }),
      "workspace.files.read",
    ),
  );
  assert.equal(openedFile.content, "export const value = 1;\n");

  const savedFile = await rpcValue<{ content: string }>(
    await handlePiRpcPost(
      rpcRequest("workspace.files.write", {
        workspaceId: created.workspace.workspaceId,
        relativePath: "index.ts",
        content: "export const value = 2;\n",
        expectedVersion: openedFile.version,
      }),
      "workspace.files.write",
    ),
  );
  assert.equal(savedFile.content, "export const value = 2;\n");
  assert.equal(
    await readFile(path.join(workspacePath, "index.ts"), "utf8"),
    "export const value = 2;\n",
  );

  const archivedList = await rpcValue<{ sessionIds: string[] }>(
    await handlePiRpcPost(
      rpcRequest("workspace.listArchivedSessions", {}, "rpc-archived-list"),
      "workspace.listArchivedSessions",
    ),
  );
  assert.deepEqual(archivedList, { sessionIds: [] });

  assert.deepEqual(
    await rpcValue(
      await handlePiRpcPost(
        rpcRequest("workspace.delete", { workspaceId: created.workspace.workspaceId }, "rpc-4"),
        "workspace.delete",
      ),
    ),
    { deleted: true },
  );
});

test("routes Host directory listing and returns 404 for unknown methods", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-rpc-host-"));
  await mkdir(path.join(root, "child"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const listing = await rpcValue<{ path: string; entries: Array<{ name: string }> }>(
    await handlePiRpcPost(rpcRequest("host.listDirectory", { path: root }), "host.listDirectory"),
  );
  assert.equal(listing.path, root);
  assert.deepEqual(
    listing.entries.map((entry) => entry.name),
    ["child"],
  );

  assert.equal(
    (await handlePiRpcPost(rpcRequest("unknown.method", {}), "unknown.method")).status,
    404,
  );

  const openResponse = await handlePiRpcPost(
    rpcRequest("host.openPath", { path: path.join(root, "missing") }),
    "host.openPath",
  );
  assert.equal(openResponse.status, 200);
  const openBody = (await openResponse.json()) as ServerResponse<unknown>;
  assert.equal(openBody.result.ok, false);
  if (openBody.result.ok) assert.fail("Expected an open-path business error");
  assert.equal(openBody.result.error.code, "internal");
  assert.deepEqual(openBody.result.error.details, {});

  const localApps = await rpcValue<LocalAppsListValue>(
    await handlePiRpcPost(rpcRequest("host.localApps.list", {}), "host.localApps.list"),
  );
  assert.ok(localApps.apps.some((app) => app.id === "file-manager"));
  assert.ok(localApps.apps.every((app) => !("launcher" in app)));

  const unavailableAppResponse = await handlePiRpcPost(
    rpcRequest("host.localApps.open", { appId: "missing", target: root }),
    "host.localApps.open",
  );
  const unavailableAppBody = (await unavailableAppResponse.json()) as ServerResponse<unknown>;
  assert.equal(unavailableAppBody.result.ok, false);
  if (unavailableAppBody.result.ok) assert.fail("Expected a local-app business error");
  assert.equal(unavailableAppBody.result.error.code, "local-app-not-found");
  assert.deepEqual(unavailableAppBody.result.error.details, { appId: "missing" });

  const abortController = new AbortController();
  abortController.abort();
  const cancelledResponse = await handlePiRpcPost(
    rpcRequest("host.listDirectory", { path: root }, "rpc-cancelled", abortController.signal),
    "host.listDirectory",
  );
  assert.equal(cancelledResponse.status, 200);
  const cancelledBody = (await cancelledResponse.json()) as ServerResponse<unknown>;
  assert.equal(cancelledBody.result.ok, false);
  if (cancelledBody.result.ok) assert.fail("Expected a cancelled directory listing");
  assert.equal(cancelledBody.result.error.code, "cancelled");
  assert.deepEqual(cancelledBody.result.error.details, {});
});

test("routes session validation failures through the shared error envelope", async () => {
  const searchResponse = await handlePiRpcPost(
    rpcRequest("session.search", { query: "   " }),
    "session.search",
  );
  assert.equal(searchResponse.status, 200);
  const searchBody = (await searchResponse.json()) as ServerResponse<unknown>;
  assert.equal(searchBody.result.ok, false);
  if (searchBody.result.ok) assert.fail("Expected a session search error");
  assert.equal(searchBody.result.error.code, "bad-request");

  const promptResponse = await handlePiRpcPost(
    rpcRequest("session.prompt", {
      sessionId: "session-1",
      mode: "queue",
      content: [{ type: "image", mediaType: "image/svg+xml", data: "AAAA" }],
    }),
    "session.prompt",
  );
  assert.equal(promptResponse.status, 200);
  const promptBody = (await promptResponse.json()) as ServerResponse<unknown>;
  assert.equal(promptBody.result.ok, false);
  if (promptBody.result.ok) assert.fail("Expected a session prompt error");
  assert.equal(promptBody.result.error.code, "bad-request");

  const composerResponse = await handlePiRpcPost(
    rpcRequest("session.prompt", {
      sessionId: "session-1",
      mode: "queue",
      content: [],
      composer: {
        version: 1,
        sourceText: ":pi-command[plan|Plan] ",
        text: "",
        context: [],
        metadata: {},
        commands: [
          {
            id: "command:pi:plan:0",
            commandId: "plan",
            label: "Plan",
            scope: "message",
            source: "unknown",
          },
        ],
      },
    }),
    "session.prompt",
  );
  const composerBody = (await composerResponse.json()) as ServerResponse<unknown>;
  assert.equal(composerBody.result.ok, false);
  if (composerBody.result.ok) assert.fail("Expected a Composer validation error");
  assert.equal(composerBody.result.error.code, "bad-request");
  const issues = composerBody.result.error.details.issues as Array<{ path?: unknown }>;
  assert.deepEqual(issues[0]?.path, ["payload", "composer", "commands", 0, "source"]);

  const historicalArgumentResponse = await handlePiRpcPost(
    rpcRequest("session.prompt", {
      sessionId: "missing-session",
      mode: "queue",
      content: [{ type: "text", text: "summarize" }],
      composer: {
        version: 1,
        document: [
          {
            type: "command",
            id: "command:pi:plan:0",
            commandId: "plan",
            label: "Plan",
            scope: "message",
            source: "pi",
            inactive: true,
          },
          {
            type: "command",
            id: "command:pi:compact:0",
            commandId: "compact",
            label: "Compact",
            scope: "message",
            source: "pi",
            args: { customInstructions: "Focus on decisions" },
          },
          {
            type: "command-argument",
            id: "argument:compact:0",
            commandNodeId: "command:pi:compact:0",
            field: "customInstructions",
            text: "Focus on decisions",
          },
        ],
        sourceText: ":pi-command[plan|Plan] :pi-command[compact|Compact] Focus on decisions",
        text: "summarize",
        context: [],
        metadata: {},
        commands: [
          {
            id: "command:pi:compact:0",
            commandId: "compact",
            label: "Compact",
            scope: "message",
            source: "pi",
            args: { customInstructions: "Focus on decisions" },
          },
        ],
      },
    }),
    "session.prompt",
  );
  const historicalArgumentBody =
    (await historicalArgumentResponse.json()) as ServerResponse<unknown>;
  assert.equal(historicalArgumentBody.result.ok, false);
  if (historicalArgumentBody.result.ok) assert.fail("Expected the missing session error");
  assert.notEqual(historicalArgumentBody.result.error.code, "bad-request");
});

test("large domain payloads use endpoint-specific budgets above the ordinary RPC limit", async () => {
  const pdfBytes = Buffer.alloc(800 * 1024);
  pdfBytes.write("%PDF-1.7\n", 0, "ascii");
  const pdfData = pdfBytes.toString("base64");
  assert.ok(pdfData.length > DEFAULT_MAX_RPC_REQUEST_BODY_BYTES);

  const promptResponse = await handlePiRpcPost(
    rpcRequest("session.prompt", {
      sessionId: "transport-budget-missing-session",
      mode: "queue",
      content: [
        {
          type: "file",
          mediaType: "application/pdf",
          data: pdfData,
          name: "large.pdf",
        },
      ],
    }),
    "session.prompt",
  );
  assert.equal(promptResponse.status, 200);
  const promptBody = (await promptResponse.json()) as ServerResponse<unknown>;
  assert.equal(promptBody.result.ok, false);
  if (promptBody.result.ok) assert.fail("Expected the missing session error");
  assert.equal(promptBody.result.error.code, "session-not-found");

  const workspaceContent = "x".repeat(DEFAULT_MAX_RPC_REQUEST_BODY_BYTES + 1);
  const workspaceResponse = await handlePiRpcPost(
    rpcRequest("workspace.files.write", {
      workspaceId: "transport-budget-missing-workspace",
      relativePath: "large.txt",
      content: workspaceContent,
      expectedVersion: "missing",
    }),
    "workspace.files.write",
  );
  assert.equal(workspaceResponse.status, 200);
  const workspaceBody = (await workspaceResponse.json()) as ServerResponse<unknown>;
  assert.equal(workspaceBody.result.ok, false);
  if (workspaceBody.result.ok) assert.fail("Expected the missing workspace error");
  assert.equal(workspaceBody.result.error.code, "workspace-not-found");

  const systemPrompt = "界".repeat(400_000);
  assert.ok(Buffer.byteLength(systemPrompt, "utf8") > DEFAULT_MAX_RPC_REQUEST_BODY_BYTES);
  const settingsResponse = await handlePiRpcPost(
    rpcRequest("settings.update", {
      ns: "not-exposed",
      patch: { systemPrompt },
    }),
    "settings.update",
  );
  assert.equal(settingsResponse.status, 200);
  const settingsBody = (await settingsResponse.json()) as ServerResponse<unknown>;
  assert.equal(settingsBody.result.ok, false);
  if (settingsBody.result.ok) assert.fail("Expected the settings namespace error");
  assert.equal(settingsBody.result.error.code, "settings-not-exposed");
});

test("validates workspace.unarchiveSession at the shared RPC boundary", async () => {
  const response = await handlePiRpcPost(
    rpcRequest("workspace.unarchiveSession", { sessionId: "" }),
    "workspace.unarchiveSession",
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as ServerResponse<unknown>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected an unarchive validation error");
  assert.equal(body.result.error.code, "bad-request");
});

test("validates session.delete at the shared RPC boundary", async () => {
  const response = await handlePiRpcPost(
    rpcRequest("session.delete", { sessionId: "" }),
    "session.delete",
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as ServerResponse<unknown>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected a session.delete validation error");
  assert.equal(body.result.error.code, "bad-request");
  const issues = body.result.error.details.issues as Array<{ path?: unknown }>;
  assert.deepEqual(issues[0]?.path, ["payload", "sessionId"]);
});

test("validates session branch mutations at the shared RPC boundary", async () => {
  for (const [method, payload] of [
    ["session.regenerate", { sessionId: "session-1", messageId: "" }],
    ["session.selectBranch", { sessionId: "session-1", leafId: "" }],
  ] as const) {
    const response = await handlePiRpcPost(rpcRequest(method, payload), method);
    assert.equal(response.status, 200);
    const body = (await response.json()) as ServerResponse<unknown>;
    assert.equal(body.result.ok, false);
    if (body.result.ok) assert.fail(`Expected a ${method} validation error`);
    assert.equal(body.result.error.code, "bad-request");
  }
});

test("validates skill.list at the shared RPC boundary", async () => {
  const response = await handlePiRpcPost(rpcRequest("skill.list", { sessionId: "" }), "skill.list");
  assert.equal(response.status, 200);
  const body = (await response.json()) as ServerResponse<unknown>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected a skill.list validation error");
  assert.equal(body.result.error.code, "bad-request");
  const issues = body.result.error.details.issues as Array<{ path?: unknown }>;
  assert.deepEqual(issues[0]?.path, ["payload", "sessionId"]);
});

test("validates skill.describe at the shared RPC boundary", async () => {
  const response = await handlePiRpcPost(
    rpcRequest("skill.describe", { sessionId: "session-1", name: "" }),
    "skill.describe",
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as ServerResponse<unknown>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected a skill.describe validation error");
  assert.equal(body.result.error.code, "bad-request");
  const issues = body.result.error.details.issues as Array<{ path?: unknown }>;
  assert.deepEqual(issues[0]?.path, ["payload", "name"]);
});

test("validates skill management methods at the shared RPC boundary", async () => {
  const invalidRequests = [
    {
      method: "skill.setEnabled",
      payload: { sessionId: "session-1", name: "review", enabled: "yes" },
      expectedPath: ["payload", "enabled"],
    },
    {
      method: "skill.remove",
      payload: { sessionId: "session-1", name: "" },
      expectedPath: ["payload", "name"],
    },
    {
      method: "skill.files.list",
      payload: { sessionId: "session-1", name: "review", relativePath: 1 },
      expectedPath: ["payload", "relativePath"],
    },
    {
      method: "skill.files.read",
      payload: { sessionId: "session-1", name: "review", relativePath: "" },
      expectedPath: ["payload", "relativePath"],
    },
  ] as const;

  for (const { method, payload, expectedPath } of invalidRequests) {
    const response = await handlePiRpcPost(rpcRequest(method, payload), method);
    assert.equal(response.status, 200);
    const body = (await response.json()) as ServerResponse<unknown>;
    assert.equal(body.result.ok, false);
    if (body.result.ok) assert.fail(`Expected a ${method} validation error`);
    assert.equal(body.result.error.code, "bad-request");
    const issues = body.result.error.details.issues as Array<{ path?: unknown }>;
    assert.deepEqual(issues[0]?.path, expectedPath);
  }
});

test("validates command.list at the shared RPC boundary", async () => {
  const response = await handlePiRpcPost(
    rpcRequest("command.list", { sessionId: "" }),
    "command.list",
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as ServerResponse<unknown>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected a command.list validation error");
  assert.equal(body.result.error.code, "bad-request");
  const issues = body.result.error.details.issues as Array<{ path?: unknown }>;
  assert.deepEqual(issues[0]?.path, ["payload", "sessionId"]);
});

test("validates extension.list at the shared RPC boundary", async () => {
  const response = await handlePiRpcPost(
    rpcRequest("extension.list", { sessionId: "" }),
    "extension.list",
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as ServerResponse<unknown>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected an extension.list validation error");
  assert.equal(body.result.error.code, "bad-request");
  const issues = body.result.error.details.issues as Array<{ path?: unknown }>;
  assert.deepEqual(issues[0]?.path, ["payload", "sessionId"]);
});

test("validates extension management methods at the shared RPC boundary", async () => {
  const identity = {
    sessionId: "session-1",
    name: "review",
    filePath: "/home/test/.pi/agent/extensions/review.ts",
    source: "auto",
    scope: "user",
    origin: "top-level",
  };
  const invalidRequests = [
    {
      method: "extension.setEnabled",
      payload: { ...identity, enabled: "yes" },
      expectedPath: ["payload", "enabled"],
    },
    {
      method: "extension.remove",
      payload: { ...identity, filePath: "" },
      expectedPath: ["payload", "filePath"],
    },
    {
      method: "extension.files.read",
      payload: { ...identity, origin: "unknown" },
      expectedPath: ["payload", "origin"],
    },
    {
      method: "extension.files.list",
      payload: { ...identity, relativePath: 1 },
      expectedPath: ["payload", "relativePath"],
    },
    {
      method: "extension.files.read",
      payload: { ...identity, relativePath: "" },
      expectedPath: ["payload", "relativePath"],
    },
  ] as const;

  for (const { method, payload, expectedPath } of invalidRequests) {
    const response = await handlePiRpcPost(rpcRequest(method, payload), method);
    assert.equal(response.status, 200);
    const body = (await response.json()) as ServerResponse<unknown>;
    assert.equal(body.result.ok, false);
    if (body.result.ok) assert.fail(`Expected a ${method} validation error`);
    assert.equal(body.result.error.code, "bad-request");
    const issues = body.result.error.details.issues as Array<{ path?: unknown }>;
    assert.deepEqual(issues[0]?.path, expectedPath);
  }
});

test("validates package.list at the shared RPC boundary", async () => {
  const response = await handlePiRpcPost(
    rpcRequest("package.list", { sessionId: "" }),
    "package.list",
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as ServerResponse<unknown>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected a package.list validation error");
  assert.equal(body.result.error.code, "bad-request");
  const issues = body.result.error.details.issues as Array<{ path?: unknown }>;
  assert.deepEqual(issues[0]?.path, ["payload", "sessionId"]);
});

test("validates package.install targets and official npm package names", async () => {
  const response = await handlePiRpcPost(
    rpcRequest("package.install", {
      name: "https://example.com/arbitrary-source",
      target: { scope: "project", workspaceId: "" },
    }),
    "package.install",
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as ServerResponse<unknown>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected a package.install validation error");
  assert.equal(body.result.error.code, "bad-request");
  const issues = body.result.error.details.issues as Array<{ path?: unknown }>;
  assert.deepEqual(
    issues.map((issue) => issue.path),
    [
      ["payload", "name"],
      ["payload", "target"],
    ],
  );
});

test("validates package.remove targets and configured package sources", async () => {
  const response = await handlePiRpcPost(
    rpcRequest("package.remove", {
      source: "npm:pi-tools\nrm -rf /",
      target: { scope: "project", workspaceId: "" },
    }),
    "package.remove",
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as ServerResponse<unknown>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected a package.remove validation error");
  assert.equal(body.result.error.code, "bad-request");
  const issues = body.result.error.details.issues as Array<{ path?: unknown }>;
  assert.deepEqual(
    issues.map((issue) => issue.path),
    [
      ["payload", "source"],
      ["payload", "target"],
    ],
  );
});

test("validates packageCatalog.search at the shared RPC boundary", async () => {
  const response = await handlePiRpcPost(
    rpcRequest("packageCatalog.search", { type: "plugin", page: 0 }),
    "packageCatalog.search",
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as ServerResponse<unknown>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected a packageCatalog.search validation error");
  assert.equal(body.result.error.code, "bad-request");
  const issues = body.result.error.details.issues as Array<{ path?: unknown }>;
  assert.deepEqual(
    issues.map((issue) => issue.path),
    [
      ["payload", "type"],
      ["payload", "page"],
    ],
  );
});

test("validates packageCatalog.describe package names at the shared RPC boundary", async () => {
  const response = await handlePiRpcPost(
    rpcRequest("packageCatalog.describe", { name: "https://example.com/package" }),
    "packageCatalog.describe",
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as ServerResponse<unknown>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected a packageCatalog.describe validation error");
  assert.equal(body.result.error.code, "bad-request");
  const issues = body.result.error.details.issues as Array<{ path?: unknown }>;
  assert.deepEqual(issues[0]?.path, ["payload", "name"]);
});

test("validates and restricts the exposed agent settings namespace", async () => {
  const invalid = await handlePiRpcPost(
    rpcRequest("settings.update", {
      ns: "pi.agent",
      patch: { compaction: { reserveTokens: 0 } },
    }),
    "settings.update",
  );
  const invalidBody = (await invalid.json()) as ServerResponse<unknown>;
  assert.equal(invalidBody.result.ok, false);
  if (invalidBody.result.ok) assert.fail("Expected settings validation to fail");
  assert.equal(invalidBody.result.error.code, "bad-request");

  const hidden = await handlePiRpcPost(
    rpcRequest("settings.update", { ns: "private", patch: {} }, "rpc-settings-hidden"),
    "settings.update",
  );
  const hiddenBody = (await hidden.json()) as ServerResponse<unknown>;
  assert.equal(hiddenBody.result.ok, false);
  if (hiddenBody.result.ok) assert.fail("Expected an unexposed namespace error");
  assert.equal(hiddenBody.result.error.code, "settings-not-exposed");
});

test("updates image-understanding settings without returning provider credentials", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-image-understanding-rpc-"));
  const previousStateFile = process.env.PI_WORKBENCH_IMAGE_UNDERSTANDING_STATE_FILE;
  process.env.PI_WORKBENCH_IMAGE_UNDERSTANDING_STATE_FILE = path.join(root, "settings.json");
  t.after(async () => {
    if (previousStateFile === undefined) {
      delete process.env.PI_WORKBENCH_IMAGE_UNDERSTANDING_STATE_FILE;
    } else {
      process.env.PI_WORKBENCH_IMAGE_UNDERSTANDING_STATE_FILE = previousStateFile;
    }
    await rm(root, { recursive: true, force: true });
  });

  const secret = "private-image-provider-key";
  const updateResponse = await handlePiRpcPost(
    rpcRequest("imageUnderstanding.update", {
      expectedRevision: 0,
      patch: {
        routing: "always-preprocess",
        engine: "ocr",
        ocrProvider: "glm-ocr",
        glm: {
          endpoint: "https://ocr.example/layout",
          model: "glm-ocr",
          apiKey: secret,
        },
      },
    }),
    "imageUnderstanding.update",
  );
  assert.equal((await updateResponse.clone().text()).includes(secret), false);
  const updated = await rpcValue<ImageUnderstandingDescribeValue>(updateResponse);
  assert.equal(updated.revision, 1);
  assert.equal(updated.value.glm.credentialConfigured, true);
  assert.equal("apiKey" in updated.value.glm, false);

  const described = await rpcValue<ImageUnderstandingDescribeValue>(
    await handlePiRpcPost(
      rpcRequest("imageUnderstanding.describe", {}, "rpc-image-describe"),
      "imageUnderstanding.describe",
    ),
  );
  assert.deepEqual(described, updated);

  const conflict = await handlePiRpcPost(
    rpcRequest(
      "imageUnderstanding.update",
      { expectedRevision: 0, patch: { routing: "auto" } },
      "rpc-image-conflict",
    ),
    "imageUnderstanding.update",
  );
  const conflictBody = (await conflict.json()) as ServerResponse<unknown>;
  assert.equal(conflictBody.result.ok, false);
  if (conflictBody.result.ok) assert.fail("Expected an image settings revision conflict");
  assert.equal(conflictBody.result.error.code, "image-settings-conflict");
  assert.deepEqual(conflictBody.result.error.details, {
    expectedRevision: 0,
    actualRevision: 1,
  });
});

test("persists Workbench preferences through the shared RPC boundary", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-settings-rpc-"));
  const previousStateFile = process.env.PI_WORKBENCH_SETTINGS_FILE;
  process.env.PI_WORKBENCH_SETTINGS_FILE = path.join(root, "workbench-settings.json");
  t.after(async () => {
    if (previousStateFile === undefined) delete process.env.PI_WORKBENCH_SETTINGS_FILE;
    else process.env.PI_WORKBENCH_SETTINGS_FILE = previousStateFile;
    await rm(root, { recursive: true, force: true });
  });

  await rpcValue(
    await handlePiRpcPost(
      rpcRequest("workbenchSettings.update", {
        patch: {
          locale: "zh-CN",
          sidebarOpen: false,
          sidebarThreadSortMode: "manual",
          sidebarThreadOrderByScope: {
            pinned: ["session-b", "session-a"],
          },
          toolboxPins: ["skills", "skills"],
        },
      }),
      "workbenchSettings.update",
    ),
  );
  const described = await rpcValue<WorkbenchSettingsDescribeValue>(
    await handlePiRpcPost(
      rpcRequest("workbenchSettings.describe", {}, "rpc-workbench-settings-describe"),
      "workbenchSettings.describe",
    ),
  );
  assert.deepEqual(described.preferences, {
    locale: "zh-CN",
    sidebarThreadOrderByScope: { pinned: ["session-b", "session-a"] },
    sidebarThreadSortMode: "manual",
    toolboxPins: ["skills"],
    sidebarOpen: false,
  });

  const largeBackgroundData = "A".repeat(DEFAULT_MAX_RPC_REQUEST_BODY_BYTES);
  await rpcValue(
    await handlePiRpcPost(
      rpcRequest(
        "workbenchSettings.update",
        {
          patch: {
            backgroundImage: {
              name: "large.png",
              mimeType: "image/png",
              data: largeBackgroundData,
            },
          },
        },
        "rpc-workbench-settings-large",
      ),
      "workbenchSettings.update",
    ),
  );

  const invalid = await handlePiRpcPost(
    rpcRequest(
      "workbenchSettings.update",
      { patch: { backgroundImage: { name: "x", mimeType: "text/plain", data: "AAAA" } } },
      "rpc-workbench-settings-invalid",
    ),
    "workbenchSettings.update",
  );
  const invalidBody = (await invalid.json()) as ServerResponse<unknown>;
  assert.equal(invalidBody.result.ok, false);
  if (invalidBody.result.ok) assert.fail("Expected invalid Workbench settings to fail");
  assert.equal(invalidBody.result.error.code, "workbench-settings-invalid");
});

test("validates model context-window updates at the shared RPC boundary", async () => {
  const response = await handlePiRpcPost(
    rpcRequest("llm.updateModelContextWindow", {
      provider: "openai",
      model: "gpt-5",
      contextWindow: 0,
    }),
    "llm.updateModelContextWindow",
  );
  const body = (await response.json()) as ServerResponse<unknown>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected a model context-window validation error");
  assert.equal(body.result.error.code, "bad-request");
});

test("validates image-input model tests at the shared RPC boundary", async () => {
  const response = await handlePiRpcPost(
    rpcRequest("llm.testModelImageInput", {
      provider: "openai",
      model: "",
    }),
    "llm.testModelImageInput",
  );
  const body = (await response.json()) as ServerResponse<unknown>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected an image-input test validation error");
  assert.equal(body.result.error.code, "bad-request");
});

test("rejects blank provider credentials before invoking model configuration", async () => {
  const response = await handlePiRpcPost(
    rpcRequest("llm.configureProvider", { provider: "openai", apiKey: "   " }),
    "llm.configureProvider",
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as ServerResponse<unknown>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected a provider configuration validation error");
  assert.equal(body.result.error.code, "bad-request");
  assert.equal(JSON.stringify(body).includes('apiKey":"   '), false);
});

test("validates provider account-login interactions at the shared RPC boundary", async () => {
  const start = await handlePiRpcPost(
    rpcRequest("llm.startProviderLogin", {
      provider: "openai-codex",
      authType: "api_key",
    }),
    "llm.startProviderLogin",
  );
  const startBody = (await start.json()) as ServerResponse<unknown>;
  assert.equal(startBody.result.ok, false);
  if (startBody.result.ok) assert.fail("Expected an account-login validation error");
  assert.equal(startBody.result.error.code, "bad-request");

  const response = await handlePiRpcPost(
    rpcRequest("llm.respondProviderLogin", {
      loginId: "login-1",
      promptId: "",
      value: "browser",
    }),
    "llm.respondProviderLogin",
  );
  const responseBody = (await response.json()) as ServerResponse<unknown>;
  assert.equal(responseBody.result.ok, false);
  if (responseBody.result.ok) assert.fail("Expected a login-prompt validation error");
  assert.equal(responseBody.result.error.code, "bad-request");
});

test("rejects malformed custom provider catalogs at the RPC boundary", async () => {
  const response = await handlePiRpcPost(
    rpcRequest("llm.configureProvider", {
      provider: "acme",
      configuration: {
        baseURL: "https://api.acme.test/v1",
        api: "unsupported-protocol",
        models: [{ id: "acme-large", contextWindow: 0 }],
      },
    }),
    "llm.configureProvider",
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as ServerResponse<unknown>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected a provider catalog validation error");
  assert.equal(body.result.error.code, "bad-request");
});

test("rejects malformed model reasoning levels at the RPC boundary", async () => {
  const response = await handlePiRpcPost(
    rpcRequest("llm.configureProvider", {
      provider: "acme",
      configuration: {
        baseURL: "https://api.acme.test/v1",
        api: "openai-responses",
        models: [
          {
            id: "acme-large",
            reasoning: true,
            thinkingLevelMap: { medium: 8 },
          },
        ],
      },
    }),
    "llm.configureProvider",
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as ServerResponse<unknown>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected a reasoning-level validation error");
  assert.equal(body.result.error.code, "bad-request");
});

test("maps an aborted model discovery to the RPC cancelled envelope", async () => {
  const controller = new AbortController();
  controller.abort();
  const request = new Request("http://127.0.0.1:3000/api/llm.discoverModels", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      type: "client-request",
      rpcId: "rpc-model-cancel",
      method: "llm.discoverModels",
      payload: {
        settingsNs: "custom",
        baseURL: "https://models.example.test/v1",
      },
    }),
    signal: controller.signal,
  });

  const response = await handlePiRpcPost(request, "llm.discoverModels");
  assert.equal(response.status, 200);
  const body = (await response.json()) as ServerResponse<unknown>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected a cancelled model discovery");
  assert.equal(body.result.error.code, "cancelled");
  assert.deepEqual(body.result.error.details, {});
});

test("routes /api/respond outside the ClientRequest envelope", async () => {
  const request = new Request("http://127.0.0.1:3000/api/respond", {
    method: "POST",
    headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
    body: JSON.stringify({
      type: "client-response",
      rpcId: "not-pending",
      result: {
        ok: true,
        value: {
          sessionId: "session-1",
          answer: { answers: [{ id: "question", selected: [] }] },
        },
      },
    }),
  });
  const response = await handlePiRpcPost(request, "respond");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { accepted: false, reason: "not-pending" });

  const malformed = await handlePiRpcPost(
    new Request("http://127.0.0.1:3000/api/respond", {
      method: "POST",
      headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
      body: JSON.stringify({ type: "client-request" }),
    }),
    "respond",
  );
  assert.deepEqual(await malformed.json(), { accepted: false, reason: "bad-response" });
});
