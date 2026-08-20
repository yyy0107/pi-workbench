import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { ServerResponse, WorkspaceView } from "../../rpc-contracts";

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

test("routes workspace CRUD through the shared RPC transport", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-rpc-router-"));
  const workspacePath = path.join(root, "project");
  await mkdir(workspacePath);
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
