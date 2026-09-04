import {
  createRuntimeHttpRouter,
  type RuntimeHttpRouterDependencies,
} from "../src/composition/runtime-http-router";
type TestRuntimeHttpRouterDependencies = PiRuntimeHttpRouterDependencies &
  Omit<RuntimeHttpRouterDependencies, "handlePiRequest">;
import { RPC_REQUEST_BODY_LIMITS } from "@workbench/agent-runtime-pi-server/legacy";
import assert from "node:assert/strict";
import test from "node:test";

import { PiServerError } from "@workbench/agent-runtime-pi-server/legacy";
import {
  createPiRuntimeHttpRouter,
  type PiRuntimeHttpRouterDependencies,
} from "@workbench/agent-runtime-pi-server/http";

function request(pathname: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("host", "127.0.0.1:3000");
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return new Request(`http://127.0.0.1:3000${pathname}`, { ...init, headers });
}

function harness(overrides: Partial<TestRuntimeHttpRouterDependencies> = {}) {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const call = (name: string, ...args: unknown[]): void => {
    calls.push({ name, args });
  };
  const dependencies: TestRuntimeHttpRouterDependencies = {
    async handleRpcPost(_request, method) {
      call("handleRpcPost", method);
      return new Response(`rpc:${method}`, { status: 201 });
    },
    async listModels(cwd) {
      call("listModels", cwd);
      return { cwd };
    },
    createRunningEventResponse(runtimeRequest) {
      call("createRunningEventResponse", runtimeRequest);
      return new Response("running", { headers: { "content-type": "text/event-stream" } });
    },
    createSessionEventResponse(runtimeRequest, sessionId) {
      call("createSessionEventResponse", runtimeRequest, sessionId);
      return new Response("session-events", {
        headers: { "content-type": "text/event-stream" },
      });
    },
    cancelSession(sessionId) {
      call("cancelSession", sessionId);
    },
    queuePrompt(sessionId, mode, prompt) {
      call("queuePrompt", sessionId, mode, prompt);
    },
    replacePromptQueue(sessionId, steering, followUp) {
      call("replacePromptQueue", sessionId, steering, followUp);
    },
    sendPrompt(sessionId, message, images, model) {
      call("sendPrompt", sessionId, message, images, model);
    },
    setPromptQueuePaused(sessionId, paused, steering, followUp) {
      call("setPromptQueuePaused", sessionId, paused, steering, followUp);
    },
    steerQueuedPrompt(sessionId, prompt, steering, followUp) {
      call("steerQueuedPrompt", sessionId, prompt, steering, followUp);
    },
    deleteSession(sessionId) {
      call("deleteSession", sessionId);
    },
    async getSessionHistory(sessionId) {
      call("getSessionHistory", sessionId);
      return { sessionId };
    },
    renameSession(sessionId, name) {
      call("renameSession", sessionId, name);
    },
    async createSession(cwd) {
      call("createSession", cwd);
      return { summary: () => ({ id: "created", cwd }) };
    },
    async listSessions() {
      call("listSessions");
      return { sessions: [], runningSessionIds: [] };
    },
    async pickWorkspaceDirectory(signal) {
      call("pickWorkspaceDirectory", signal);
      return { cwd: "/workspace" };
    },
    handleSessionExportRequest(runtimeRequest) {
      call("handleSessionExportRequest", runtimeRequest);
      return new Response("zip", {
        headers: { "content-type": "application/zip" },
      });
    },
    handleWorkspaceFileContentRequest(runtimeRequest) {
      call("handleWorkspaceFileContentRequest", runtimeRequest);
      return new Response("bytes", {
        status: 206,
        headers: { "content-range": "bytes 1-2/3" },
      });
    },
    ...overrides,
  };
  return {
    calls,
    router: createRuntimeHttpRouter({
      ...dependencies,
      handlePiRequest: createPiRuntimeHttpRouter(dependencies),
    }),
  };
}

test("dispatches RPC and passes streaming responses through without cloning or buffering", async () => {
  const runningResponse = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: running\n\n"));
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
  const sessionResponse = new Response("session-events", {
    headers: { "content-type": "text/event-stream" },
  });
  const exportResponse = new Response(null, {
    headers: { "content-disposition": 'attachment; filename="session.zip"' },
  });
  const contentResponse = new Response("bc", {
    status: 206,
    headers: {
      "accept-ranges": "bytes",
      "content-range": "bytes 1-2/3",
      etag: '"version"',
    },
  });
  const seenRequests: Request[] = [];
  const { router, calls } = harness({
    createRunningEventResponse(runtimeRequest) {
      seenRequests.push(runtimeRequest);
      return runningResponse;
    },
    createSessionEventResponse(runtimeRequest, sessionId) {
      seenRequests.push(runtimeRequest);
      assert.equal(sessionId, "session one");
      return sessionResponse;
    },
    handleSessionExportRequest(runtimeRequest) {
      seenRequests.push(runtimeRequest);
      return exportResponse;
    },
    handleWorkspaceFileContentRequest(runtimeRequest) {
      seenRequests.push(runtimeRequest);
      return contentResponse;
    },
  });

  const rpc = request("/api/session.list", { method: "POST", body: "{}" });
  assert.equal(await (await router(rpc)).text(), "rpc:session.list");

  const running = request("/api/pi/running/events");
  assert.equal(await router(running), runningResponse);
  const events = request("/api/pi/sessions/session%20one/events");
  assert.equal(await router(events), sessionResponse);
  const exported = request("/api/session.export?sessionId=one", { method: "HEAD" });
  assert.equal(await router(exported), exportResponse);
  const content = request("/api/workspace.files.content?workspaceId=one&relativePath=a.bin", {
    headers: { range: "bytes=1-2" },
  });
  assert.equal(await router(content), contentResponse);

  assert.deepEqual(seenRequests, [running, events, exported, content]);
  assert.deepEqual(calls, [{ name: "handleRpcPost", args: ["session.list"] }]);
});

test("owns legacy model, session collection, session resource and picker validation", async () => {
  const controller = new AbortController();
  const { router, calls } = harness();

  assert.deepEqual(await (await router(request("/api/pi/models?cwd=%2Fproject"))).json(), {
    cwd: "/project",
  });
  assert.equal((await router(request("/api/pi/models"))).status, 400);

  assert.deepEqual(await (await router(request("/api/pi/sessions"))).json(), {
    sessions: [],
    runningSessionIds: [],
  });
  assert.equal(
    (
      await router(
        request("/api/pi/sessions", {
          method: "POST",
          body: JSON.stringify({ cwd: "/project" }),
        }),
      )
    ).status,
    201,
  );
  assert.equal(
    (
      await router(
        request("/api/pi/sessions/session%20one", {
          method: "PATCH",
          body: JSON.stringify({ name: "Renamed" }),
        }),
      )
    ).status,
    200,
  );
  assert.equal(
    (await router(request("/api/pi/sessions/session%20one", { method: "DELETE" }))).status,
    204,
  );
  assert.deepEqual(await (await router(request("/api/pi/sessions/session%20one"))).json(), {
    sessionId: "session one",
  });

  const pickerRequest = request("/api/pi/workspaces/pick", {
    method: "POST",
    signal: controller.signal,
  });
  assert.deepEqual(await (await router(pickerRequest)).json(), {
    workspace: { cwd: "/workspace" },
  });

  assert.deepEqual(
    calls.map(({ name }) => name),
    [
      "listModels",
      "listSessions",
      "createSession",
      "renameSession",
      "deleteSession",
      "getSessionHistory",
      "pickWorkspaceDirectory",
    ],
  );
  assert.equal(calls.at(-1)?.args[0], pickerRequest.signal);
});

test("preserves every legacy session command and the 80 MiB carrier budget", async (t) => {
  const cases = [
    {
      body: { type: "cancel" },
      expected: "cancelSession",
      status: 200,
    },
    {
      body: { type: "steer", message: "Steer" },
      expected: "queuePrompt",
      status: 202,
    },
    {
      body: { type: "replaceQueue", steering: [], followUp: [] },
      expected: "replacePromptQueue",
      status: 202,
    },
    {
      body: { type: "setQueuePaused", paused: true, steering: [], followUp: [] },
      expected: "setPromptQueuePaused",
      status: 202,
    },
    {
      body: {
        type: "steerQueued",
        prompt: { message: "Now" },
        steering: [],
        followUp: [],
      },
      expected: "steerQueuedPrompt",
      status: 202,
    },
    {
      body: {
        type: "prompt",
        message: "Hello",
        images: [],
        model: { provider: "provider", modelId: "model", thinkingLevel: "medium" },
      },
      expected: "sendPrompt",
      status: 202,
    },
  ] as const;

  for (const item of cases) {
    await t.test(item.expected, async () => {
      const { router, calls } = harness();
      const response = await router(
        request("/api/pi/sessions/session-1/commands", {
          method: "POST",
          body: JSON.stringify(item.body),
        }),
      );
      assert.equal(response.status, item.status);
      assert.deepEqual(
        calls.map(({ name }) => name),
        [item.expected],
      );
    });
  }

  const { router, calls } = harness();
  const oversized = await router(
    request("/api/pi/sessions/session-1/commands", {
      method: "POST",
      headers: {
        "content-length": String(RPC_REQUEST_BODY_LIMITS.inlineAttachment + 1),
      },
      body: "{}",
    }),
  );
  assert.equal(oversized.status, 413);
  assert.deepEqual(calls, []);
});

test("keeps trust and Pi error projection inside the sole Runtime HTTP owner", async () => {
  let modelCalls = 0;
  const { router } = harness({
    listModels() {
      modelCalls += 1;
      throw new PiServerError("pi_model_failure", 409);
    },
  });

  const forbidden = await router(
    new Request("http://evil.example/api/pi/models?cwd=%2Fproject", {
      headers: { host: "evil.example" },
    }),
  );
  assert.equal(forbidden.status, 403);
  assert.equal(modelCalls, 0);

  const projected = await router(request("/api/pi/models?cwd=%2Fproject"));
  assert.equal(projected.status, 409);
  assert.deepEqual(await projected.json(), { error: { code: "pi_model_failure" } });
  assert.equal(modelCalls, 1);

  const nativeForbidden = await router(
    new Request("http://trusted.example/api/pi/workspaces/pick", {
      method: "POST",
      headers: { host: "trusted.example" },
    }),
  );
  assert.equal(nativeForbidden.status, 403);
  assert.deepEqual(await nativeForbidden.json(), {
    error: { code: "pi_workspace_picker_forbidden" },
  });
});

test("owns method negotiation while preserving the RPC OPTIONS compatibility response", async () => {
  const { router, calls } = harness();

  const options = await router(request("/api/pi/sessions", { method: "OPTIONS" }));
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("allow"), "GET, HEAD, OPTIONS, POST");

  const unsupported = await router(request("/api/pi/sessions", { method: "PUT" }));
  assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.get("allow"), null);
  assert.equal(await unsupported.text(), "");

  assert.equal((await router(request("/api/session.list", { method: "OPTIONS" }))).status, 404);
  assert.equal((await router(request("/api/pi/not-a-route"))).status, 404);
  assert.deepEqual(calls, []);
});

test("implements Next-compatible automatic HEAD without mutating or leaking SSE state", async () => {
  let streamCancelled = false;
  let streamSignal: AbortSignal | undefined;
  const { router, calls } = harness({
    createRunningEventResponse(runtimeRequest) {
      streamSignal = runtimeRequest.signal;
      return new Response(
        new ReadableStream({
          cancel() {
            streamCancelled = true;
          },
        }),
        { headers: { "content-type": "text/event-stream", "x-accel-buffering": "no" } },
      );
    },
  });

  const sessionHead = await router(request("/api/pi/sessions/session-1", { method: "HEAD" }));
  assert.equal(sessionHead.status, 200);
  assert.equal(sessionHead.body, null);
  assert.deepEqual(
    calls.map(({ name }) => name),
    ["getSessionHistory"],
  );

  const eventsHead = await router(request("/api/pi/running/events", { method: "HEAD" }));
  assert.equal(eventsHead.status, 200);
  assert.equal(eventsHead.body, null);
  assert.equal(eventsHead.headers.get("content-type"), "text/event-stream");
  assert.equal(eventsHead.headers.get("x-accel-buffering"), "no");
  assert.equal(streamCancelled, true);
  assert.equal(streamSignal?.aborted, true);
});
