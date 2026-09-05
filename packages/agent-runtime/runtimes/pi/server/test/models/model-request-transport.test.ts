import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { InMemoryCredentialStore, type StreamOptions } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import {
  type AgentSession,
  createAgentSessionFromServices,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

import { createWorkbenchAgentSessionServices } from "../../src/agent-runtime/agent-session-services";

function sendEvent(response: ServerResponse, event: Record<string, unknown>) {
  response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

test(
  "model streams survive an extension buffering global fetch, including concurrent sessions and reload",
  { timeout: 20_000 },
  async (t) => {
    const originalFetch = globalThis.fetch;
    const agentDir = await mkdtemp(path.join(tmpdir(), "workbench-model-transport-"));
    const sessions: AgentSession[] = [];
    const pendingResponses = new Set<() => void>();
    const server = createServer(async (request, response) => {
      for await (const _chunk of request) {
        /* consume request */
      }
      if (request.url === "/tool") {
        response.end("tool result");
        return;
      }
      response.writeHead(200, { "content-type": "text/event-stream" });
      sendEvent(response, {
        type: "message_start",
        message: {
          id: "test-message",
          type: "message",
          role: "assistant",
          model: "test-model",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      });
      sendEvent(response, {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      });
      sendEvent(response, {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "first " },
      });
      const finish = () => {
        pendingResponses.delete(finish);
        sendEvent(response, {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "second" },
        });
        sendEvent(response, { type: "content_block_stop", index: 0 });
        sendEvent(response, {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: 2 },
        });
        sendEvent(response, { type: "message_stop" });
        response.end();
      };
      pendingResponses.add(finish);
      response.on("close", () => pendingResponses.delete(finish));
    });
    t.after(async () => {
      globalThis.fetch = originalFetch;
      for (const finish of pendingResponses) finish();
      for (const session of sessions) {
        await session.abort();
        session.dispose();
      }
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(agentDir, { recursive: true, force: true });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;
    let extensionFetchCalls = 0;
    const bufferingFetch: typeof fetch = async (input, init) => {
      extensionFetchCalls++;
      const response = await originalFetch(input, init);
      return new Response(await response.arrayBuffer(), {
        status: response.status,
        headers: response.headers,
      });
    };
    const createSession = async () => {
      const modelRuntime = await ModelRuntime.create({
        credentials: new InMemoryCredentialStore(),
        modelsPath: null,
        refreshOnCreate: false,
      });
      modelRuntime.registerProvider("transport-test", {
        api: "anthropic-messages",
        baseUrl: origin,
        apiKey: "test-only-key",
        models: [
          {
            id: "test-model",
            name: "Test",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 100_000,
            maxTokens: 100,
          },
        ],
      });
      const services = await createWorkbenchAgentSessionServices({
        cwd: agentDir,
        agentDir,
        modelRuntime,
        settingsManager: SettingsManager.inMemory({
          compaction: { enabled: false },
          retry: { enabled: false },
        }),
        resourceLoaderOptions: {
          noExtensions: true,
          noSkills: true,
          noPromptTemplates: true,
          noThemes: true,
          extensionFactories: [
            () => {
              globalThis.fetch = bufferingFetch;
            },
          ],
        },
      });
      const model = modelRuntime.getModel("transport-test", "test-model");
      assert.ok(model);
      const { session } = await createAgentSessionFromServices({
        services,
        sessionManager: SessionManager.inMemory(agentDir),
        model,
        tools: [],
      });
      sessions.push(session);
      await session.bindExtensions({ mode: "rpc" });
      return session;
    };
    const first = await createSession();
    assert.equal(globalThis.fetch, bufferingFetch);
    // The second runtime starts after the global fetch has already been replaced.
    const second = await createSession();

    const checkStreaming = async (targets: AgentSession[], abort = false) => {
      const deltas = targets.map(() => [] as string[]);
      const unsubscribes: Array<() => void> = [];
      const firstDeltas = targets.map(
        (session, index) =>
          new Promise<void>((resolve) => {
            unsubscribes.push(
              session.subscribe((event) => {
                if (
                  event.type === "message_update" &&
                  event.assistantMessageEvent.type === "text_delta"
                ) {
                  deltas[index]!.push(event.assistantMessageEvent.delta);
                  resolve();
                }
              }),
            );
          }),
      );
      const runs = targets.map((session) => session.prompt("Test streaming"));
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.all(firstDeltas),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("No model delta before the final SSE chunk was released")),
              3_000,
            );
          }),
        ]);
        assert.equal(pendingResponses.size, targets.length);
        assert.deepEqual(
          deltas,
          targets.map(() => ["first "]),
        );
        if (abort) await Promise.all(targets.map((session) => session.abort()));
      } finally {
        clearTimeout(timeout);
        for (const finish of pendingResponses) finish();
        await Promise.all(runs);
        for (const unsubscribe of unsubscribes) unsubscribe();
      }
      assert.deepEqual(
        deltas,
        targets.map(() => (abort ? ["first "] : ["first ", "second"])),
      );
      for (const session of targets) {
        const last = session.messages.at(-1);
        assert.equal(last?.role, "assistant");
        if (last?.role === "assistant") {
          assert.equal(last.stopReason, abort ? "aborted" : "stop");
          assert.deepEqual(
            last.content.filter((part) => part.type === "text").map((part) => part.text),
            [abort ? "first " : "first second"],
          );
        }
      }
    };
    await checkStreaming([first, second]);
    await first.reload();
    await checkStreaming([first]);
    await checkStreaming([second], true);
    assert.equal(extensionFetchCalls, 0);
    assert.equal(globalThis.fetch, bufferingFetch);
    assert.equal(await (await fetch(`${origin}/tool`)).text(), "tool result");
    assert.equal(extensionFetchCalls, 1);
  },
);

test("all model entry points preserve explicit fetch, request options, and unsupported adapter transports", async (t) => {
  const hostFetch = globalThis.fetch;
  const agentDir = await mkdtemp(path.join(tmpdir(), "workbench-transport-options-"));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false,
  });
  const faux = fauxProvider({ api: "anthropic-messages", tokensPerSecond: Infinity });
  let observed: StreamOptions | undefined;
  const observe = (_context: unknown, options: StreamOptions | undefined) => {
    observed = options;
    return fauxAssistantMessage("complete");
  };
  faux.provider.fetchDeferred = (model, context, options) => {
    observed = options;
    faux.setResponses([fauxAssistantMessage("deferred complete")]);
    return faux.provider.streamSimple(model, { messages: [] }, options);
  };
  faux.provider.cancelDeferred = async (_model, _handle, options) => {
    observed = options;
  };
  modelRuntime.registerNativeProvider(faux.provider);
  const serviceOptions = {
    cwd: agentDir,
    agentDir,
    modelRuntime,
    settingsManager: SettingsManager.inMemory(),
    resourceLoaderOptions: {
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
    },
  };
  const services = await createWorkbenchAgentSessionServices(serviceOptions);
  assert.equal(services.modelRuntime, modelRuntime);
  const stream = modelRuntime.stream;
  await createWorkbenchAgentSessionServices(serviceOptions);
  assert.equal(modelRuntime.stream, stream, "a shared runtime is protected only once");
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("extension transport must not handle model requests");
  });

  const model = faux.getModel();
  const context = { messages: [] };
  const handle = { api: model.api, provider: model.provider, modelId: model.id, id: "test" };
  const controller = new AbortController();
  const onPayload = (payload: unknown) => payload;
  const options = {
    signal: controller.signal,
    headers: { "x-test": "preserved" },
    env: { HTTPS_PROXY: "http://configured-model-proxy:8080", NO_PROXY: "localhost" },
    maxRetries: 0,
    timeoutMs: 1234,
    transport: "websocket" as const,
    onPayload,
  };
  const explicitFetch: typeof fetch = async () => new Response("explicit transport");
  for (const fetchOverride of [undefined, explicitFetch]) {
    const input = { ...options, fetch: fetchOverride };
    const calls = [
      () => modelRuntime.stream(model, context, input).result(),
      () => modelRuntime.streamSimple(model, context, input).result(),
      () => modelRuntime.complete(model, context, input),
      () => modelRuntime.completeSimple(model, context, input),
      () => modelRuntime.fetchDeferred(model, handle, input),
      () => modelRuntime.cancelDeferred(model, handle, input),
    ];
    for (const call of calls) {
      observed = undefined;
      faux.setResponses([observe]);
      await call();
      assert.ok(observed);
      const actual = observed as StreamOptions;
      assert.equal(actual.fetch, fetchOverride ?? hostFetch);
      assert.equal(actual.signal, controller.signal);
      assert.deepEqual(actual.headers, options.headers);
      assert.deepEqual(actual.env, options.env);
      assert.equal(actual.maxRetries, 0);
      assert.equal(actual.timeoutMs, 1234);
      assert.equal(actual.transport, "websocket");
      assert.equal(actual.onPayload, onPayload);
      assert.equal(input.fetch, fetchOverride, "caller options are not mutated");
    }
  }
  for (const api of [
    "google-generative-ai",
    "google-vertex",
    "bedrock-converse-stream",
    "custom-extension-api",
  ]) {
    faux.setResponses([observe]);
    await modelRuntime.completeSimple({ ...model, api }, context);
    assert.equal(observed?.fetch, undefined, `${api} must retain its own transport`);
  }
});
