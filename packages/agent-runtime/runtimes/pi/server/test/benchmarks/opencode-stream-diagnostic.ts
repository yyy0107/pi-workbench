import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { Readable } from "node:stream";
import type { TLSSocket } from "node:tls";

import {
  getSupportedThinkingLevels,
  type AssistantMessage,
  type FetchFunction,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

import { SessionContextTraceJournal } from "../../src/sessions/session-context-trace-journal";

// Explicit live diagnostic, excluded from the automatic test suite. No tools are executed.
// Run with --self-test for an offline check of fragmented SSE decoding.
const { values } = parseArgs({
  options: {
    session: { type: "string" },
    "timeout-seconds": { type: "string", default: "300" },
    "self-test": { type: "boolean", default: false },
    transport: { type: "string", default: "pi" },
    "connect-ip": { type: "string" },
    "local-address": { type: "string" },
  },
});

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Observes SSE frames without changing the bytes consumed by the SDK. */
function sseObserver(onFrame: (data: string) => void) {
  const decoder = new TextDecoder();
  let buffer = "";
  const observe = (bytes: Uint8Array) => {
    buffer += decoder.decode(bytes, { stream: true });
    let boundary: RegExpExecArray | null;
    while ((boundary = /\r\n\r\n|\n\n|\r\r/u.exec(buffer))) {
      const frame = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary[0].length);
      onFrame(
        frame
          .split(/\r\n|\n|\r/u)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /u, ""))
          .join("\n"),
      );
    }
  };
  return Object.assign(observe, {
    end: () => {
      const trailing = buffer + decoder.decode();
      return {
        trailingBytes: Buffer.byteLength(trailing),
        trailingSha256: hash(trailing),
        trailingHasDone: trailing.includes("[DONE]"),
        trailingHasFinishReason: /"finish_reason"\s*:\s*"/u.test(trailing),
      };
    },
  });
}

async function initialRequest(sessionFile: string) {
  // Read the source without SessionManager.open(), which can migrate old session files.
  const entries = (await readFile(sessionFile, "utf8")).split("\n").flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
  const sessionId = entries[0]?.id;
  const user = entries.find(
    (entry) => entry.type === "message" && entry.message.role === "user",
  )?.message;
  assert.equal(typeof sessionId, "string", "Missing session header");
  assert.ok(user, "Missing initial user message");
  const activations = await SessionContextTraceJournal.listActivations(sessionId);
  for (const activation of activations.toReversed()) {
    // The first request normally follows round/start, turn/start and context/snapshot.
    const page = await SessionContextTraceJournal.readActivation(
      sessionId,
      activation.activationId,
    );
    const request = page.events.find((event) => event.kind === "provider-request");
    if (!request) continue;
    const context = page.events.find(
      (event) => event.kind === "context-snapshot" && event.seq < request.seq,
    );
    assert.ok(context, "Missing original context snapshot; refusing to regenerate prompts");
    const recorded = await SessionContextTraceJournal.readEvent(sessionId, request.traceId);
    const snapshot = await SessionContextTraceJournal.readEvent(sessionId, context.traceId);
    assert.equal(recorded?.detail.type, "provider-request");
    assert.equal(snapshot?.detail.type, "context-snapshot");
    if (
      recorded?.detail.type !== "provider-request" ||
      snapshot?.detail.type !== "context-snapshot"
    )
      throw new Error("Unexpected trace record");
    const payload = recorded.detail.payload.value as Record<string, unknown>;
    const messages = snapshot.detail.messages.value as Array<Record<string, unknown>>;
    const systemPrompt = snapshot.detail.systemPrompt?.text;
    assert.equal(typeof systemPrompt, "string", "Missing original system prompt");
    assert.deepEqual(
      messages.find((message) => message.role === "user"),
      user,
    );
    assert.equal(payload.model, "deepseek-v4-flash");
    assert.equal(snapshot.detail.model?.provider, "opencode-go");
    assert.ok(Array.isArray(payload.messages));
    assert.equal(payload.messages[0]?.role, "system");
    assert.equal(payload.messages[0]?.content, systemPrompt);
    assert.equal(recorded.truncated, false);
    assert.equal(snapshot.truncated, false);
    return {
      payload,
      user,
      systemPrompt,
      provenance: {
        sessionFile: path.resolve(sessionFile),
        sessionId,
        requestTraceId: request.traceId,
        contextTraceId: context.traceId,
        systemPromptCharacters: systemPrompt!.length,
        systemPromptSha256: hash(systemPrompt),
        userMessageSha256: hash(user),
        originalPayloadSha256: hash(payload),
      },
    };
  }
  throw new Error("Original provider request not found in Context Trace");
}

interface Observation {
  lane: string;
  timeMs: number;
  gapMs?: number;
  bytes?: number;
  lagMs?: number;
  status?: number;
  request?: number;
}

async function main() {
  assert.ok(values.session, "Pass --session /absolute/path/to/session.jsonl");
  const timeoutSeconds = Number(values["timeout-seconds"]);
  const raw = values.transport === "raw";
  assert.ok(raw || values.transport === "pi", "Transport must be pi or raw");
  for (const address of [values["connect-ip"], values["local-address"]]) {
    assert.ok(
      address === undefined || (raw && isIP(address)),
      "IP overrides require raw transport and a valid IP",
    );
  }
  assert.ok(Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 && timeoutSeconds <= 1800);
  const source = await initialRequest(values.session);
  const runtime = await ModelRuntime.create({ allowModelNetwork: false });
  const model = runtime.getModel("opencode-go", "deepseek-v4-flash");
  assert.ok(model && getSupportedThinkingLevels(model).includes("max"));
  const outputDirectory = await mkdtemp(path.join(tmpdir(), "opencode-stream-diagnostic-"));
  const observations: Observation[] = [];
  const last = new Map<string, number>();
  const pending = {
    thinking: [] as Array<{ time: number; bytes: number }>,
    text: [] as Array<{ time: number; bytes: number }>,
  };
  const started = performance.now();
  const now = () => performance.now() - started;
  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
  let requests = 0;
  let mismatchedDeltas = 0;
  let malformedSse = 0;
  let payloadVerified = false;
  let providerError: string | undefined;
  let transportError: string | undefined;
  let responseMetadata: Record<string, unknown> | undefined;
  let trailingSse: ReturnType<ReturnType<typeof sseObserver>["end"]> | undefined;
  let nativeResponseComplete: boolean | undefined;
  let nativeConnection: Record<string, unknown> | undefined;
  const payload: Record<string, unknown> = {
    ...source.payload,
    thinking: { type: "enabled" },
    reasoning_effort: "max",
    stream: true,
  };
  const clientHeaders = {
    "x-opencode-session": source.provenance.sessionId,
    "user-agent": "workbench-stream-diagnostic/0.1",
  };
  const secrets: string[] = [];
  const sanitizeError = (message: string) => {
    const userParts = Array.isArray(source.user.content)
      ? source.user.content
      : [{ type: "text", text: source.user.content }];
    for (const value of [
      ...secrets,
      source.systemPrompt!,
      JSON.stringify(source.payload),
      ...userParts
        .filter((part: { type: string }) => part.type === "text")
        .map((part: { text: string }) => part.text),
    ]) {
      if (value) message = message.replaceAll(value, "[redacted]");
    }
    return message.slice(0, 500);
  };
  const record = (lane: string, fields: Partial<Observation> = {}) => {
    const timeMs = now();
    const previous = last.get(lane);
    const entry = {
      lane,
      timeMs,
      ...(previous === undefined ? {} : { gapMs: timeMs - previous }),
      ...fields,
    };
    observations.push(entry);
    last.set(lane, timeMs);
    if ((entry.gapMs ?? 0) >= 3000) console.log(JSON.stringify({ gap: entry }));
    return timeMs;
  };
  const observedFetch: FetchFunction = async (input, init) => {
    const request = ++requests;
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    for (const [name, value] of headers) {
      if (/authorization|api.?key|cookie/iu.test(name)) {
        secrets.push(value);
        if (value.startsWith("Bearer ")) secrets.push(value.slice(7));
      }
    }
    record("http_request", { request });
    const url = new URL(input instanceof Request ? input.url : String(input));
    const response = raw
      ? await new Promise<Response>((resolve, reject) => {
          const body = String(init?.body ?? "");
          headers.set("content-length", String(Buffer.byteLength(body)));
          headers.set("accept-encoding", "identity");
          headers.set("host", url.host);
          const request = httpsRequest(
            url,
            {
              method: "POST",
              headers: Object.fromEntries(headers),
              signal: init?.signal ?? undefined,
              hostname: values["connect-ip"] ?? url.hostname,
              servername: url.hostname,
              localAddress: values["local-address"],
            },
            (res) => {
              const socket = res.socket as TLSSocket;
              nativeConnection = {
                remoteAddress: socket.remoteAddress,
                localAddress: socket.localAddress,
                httpVersion: res.httpVersion,
                tlsAuthorized: socket.authorized,
                tlsIssuer: socket.getPeerCertificate().issuer,
              };
              res.once("end", () => {
                nativeResponseComplete = res.complete;
              });
              res.once("aborted", () => record("http_aborted"));
              resolve(
                new Response(Readable.toWeb(res) as ReadableStream<Uint8Array>, {
                  status: res.statusCode,
                  headers: Object.fromEntries(
                    Object.entries(res.headers).flatMap(([name, value]) =>
                      value === undefined
                        ? []
                        : [[name, Array.isArray(value) ? value.join(", ") : value]],
                    ),
                  ),
                }),
              );
            },
          );
          request.once("error", reject);
          request.end(body);
        })
      : await fetch(input, init);
    record("http_headers", { request, status: response.status });
    responseMetadata = {
      url: url.origin + url.pathname,
      status: response.status,
      headers: Object.fromEntries(
        [...response.headers].filter(([name]) =>
          /^(content-type|content-encoding|transfer-encoding|content-length|server|date|cf-ray|x-request-id|x-vercel-id|via|x-opencode-.+)$/u.test(
            name,
          ),
        ),
      ),
      requestUserAgent: headers.get("user-agent"),
      sessionHeader: headers.get("x-opencode-session"),
    };
    console.log(JSON.stringify({ response: responseMetadata }));
    if (!response.ok && response.headers.get("content-type")?.includes("application/json")) {
      const body = await response.clone().json();
      const message = body?.error?.message ?? body?.message;
      if (typeof message === "string") {
        providerError = sanitizeError(message);
        console.log(JSON.stringify({ providerError }));
      }
    }
    if (!response.body) return response;
    const observeSse = sseObserver((data) => {
      record("sse_frame", { request });
      if (!data) {
        record("sse_empty_frame", { request });
        return;
      }
      if (data === "[DONE]") {
        record("sse_done", { request });
        return;
      }
      let value;
      try {
        value = JSON.parse(data);
      } catch {
        malformedSse++;
        return;
      }
      if (value?.error) {
        record("sse_error", { request });
        if (typeof value.error.message === "string")
          providerError = sanitizeError(value.error.message);
      }
      if (value?.choices?.[0]?.finish_reason) record("sse_finish", { request });
      if (value?.usage) record("sse_usage", { request });
      const delta = value?.choices?.[0]?.delta;
      if (!delta) return;
      for (const call of delta.tool_calls ?? []) {
        if (typeof call.function?.arguments === "string") {
          record("sse_tool_args", { bytes: Buffer.byteLength(call.function.arguments), request });
        }
      }
      const thinking = [delta.reasoning_content, delta.reasoning, delta.reasoning_text].find(
        (value) => typeof value === "string" && value.length > 0,
      );
      for (const [kind, text] of [
        ["thinking", thinking],
        ["text", delta.content],
      ] as const) {
        if (typeof text !== "string" || text.length === 0) continue;
        const bytes = Buffer.byteLength(text);
        const time = record(`sse_${kind}`, { bytes, request });
        if (!raw) pending[kind].push({ time, bytes });
      }
    });
    return new Response(
      response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(bytes, controller) {
            record("http_body", { bytes: bytes.byteLength, request });
            observeSse(bytes);
            controller.enqueue(bytes);
          },
          flush() {
            trailingSse = observeSse.end();
            record("http_body_end", { request });
          },
        }),
      ),
      { status: response.status, statusText: response.statusText, headers: response.headers },
    );
  };
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt);
  const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  const progress = setInterval(
    () =>
      console.log(
        JSON.stringify({
          progress: {
            elapsedMs: Math.round(now()),
            httpIdleMs: Math.round(now() - (last.get("http_body") ?? 0)),
            thinkingIdleMs: Math.round(
              now() - (last.get(raw ? "sse_thinking" : "pi_thinking") ?? 0),
            ),
            eventLoopMaxMs: Math.round(loop.max / 1e6),
            latestContent: ["sse_thinking", "sse_text", "sse_tool_args"]
              .filter((lane) => last.has(lane))
              .sort((a, b) => last.get(b)! - last.get(a)!)[0],
          },
        }),
      ),
    10_000,
  );
  console.log(
    JSON.stringify({
      outputDirectory,
      source: source.provenance,
      reasoning: "max",
      transport: values.transport,
      connectIp: values["connect-ip"],
      localAddress: values["local-address"],
      timeoutSeconds,
    }),
  );
  let result: AssistantMessage | undefined;
  try {
    if (raw) {
      const resolved = await runtime.getAuth(model);
      assert.ok(resolved, "Missing provider authentication");
      const headers = new Headers({ ...model.headers, ...resolved.auth.headers, ...clientHeaders });
      if (resolved.auth.apiKey) headers.set("authorization", `Bearer ${resolved.auth.apiKey}`);
      headers.set("content-type", "application/json");
      headers.set("accept", "text/event-stream");
      payloadVerified = true;
      const response = await observedFetch(
        `${(resolved.auth.baseUrl ?? model.baseUrl).replace(/\/$/u, "")}/chat/completions`,
        { method: "POST", headers, body: JSON.stringify(payload), signal: controller.signal },
      );
      assert.ok(response.body, "Missing HTTP response body");
      for await (const _bytes of response.body) {
        /* observed before this raw drain */
      }
    } else {
      const stream = runtime.streamSimple(
        model,
        { systemPrompt: source.systemPrompt, messages: [source.user] },
        {
          reasoning: "max",
          // OpenCode Go requires a stable routing identity even for standalone SDK requests.
          headers: clientHeaders,
          signal: controller.signal,
          timeoutMs: timeoutSeconds * 1000,
          maxRetries: 0,
          fetch: observedFetch,
          onPayload(generated) {
            const configured = generated as Record<string, unknown>;
            assert.equal(configured.reasoning_effort, "max");
            assert.deepEqual(payload.messages, source.payload.messages);
            payloadVerified = true;
            return payload;
          },
        },
      );
      for await (const event of stream) {
        if (event.type === "thinking_delta" || event.type === "text_delta") {
          const kind = event.type === "thinking_delta" ? "thinking" : "text";
          const raw = pending[kind].shift();
          const bytes = Buffer.byteLength(event.delta);
          if (!raw || raw.bytes !== bytes) mismatchedDeltas++;
          record(`pi_${kind}`, { bytes, ...(raw ? { lagMs: now() - raw.time } : {}) });
        } else {
          record(`pi_${event.type}`);
        }
      }
      result = await stream.result();
    }
  } catch (error) {
    transportError = sanitizeError(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    clearInterval(progress);
    process.off("SIGINT", interrupt);
    loop.disable();
    const durationMs = now();
    const lanes = Object.fromEntries(
      [...last.keys()].map((lane) => {
        const items = observations.filter((item) => item.lane === lane);
        return [
          lane,
          {
            count: items.length,
            firstMs: items[0]?.timeMs,
            lastMs: items.at(-1)?.timeMs,
            tailIdleMs: durationMs - items.at(-1)!.timeMs,
            bytes: items.reduce((sum, item) => sum + (item.bytes ?? 0), 0),
            maxGapMs: items.reduce((max, item) => Math.max(max, item.gapMs ?? 0), 0),
            gapsOver3s: items.filter((item) => (item.gapMs ?? 0) >= 3000).length,
            maxLagMs: items.reduce((max, item) => Math.max(max, item.lagMs ?? 0), 0),
          },
        ];
      }),
    );
    const summary = {
      source: source.provenance,
      nodeVersion: process.version,
      provider: model.provider,
      model: model.id,
      reasoning: "max",
      transport: values.transport,
      payloadSha256: hash(payload),
      connectIp: values["connect-ip"],
      localAddress: values["local-address"],
      payloadVerified,
      originalMaxTokens: source.payload.max_tokens,
      toolCount: Array.isArray(source.payload.tools) ? source.payload.tools.length : 0,
      durationMs,
      timeoutSeconds,
      requests,
      aborted: controller.signal.aborted,
      stopReason: result?.stopReason,
      sdkError: result?.errorMessage ? sanitizeError(result.errorMessage) : undefined,
      rawStopReason: result?.rawStopReason,
      providerError,
      transportError,
      responseMetadata,
      nativeResponseComplete,
      nativeConnection,
      trailingSse,
      usage: result?.usage,
      malformedSse,
      mismatchedDeltas,
      unmatchedRawDeltas: pending.thinking.length + pending.text.length,
      eventLoopMaxMs: loop.max / 1e6,
      lanes,
    };
    await writeFile(
      path.join(outputDirectory, "events.jsonl"),
      observations.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
      { mode: 0o600 },
    );
    await writeFile(
      path.join(outputDirectory, "summary.json"),
      JSON.stringify(summary, null, 2) + "\n",
      { mode: 0o600 },
    );
    console.log(JSON.stringify({ summary, outputDirectory }));
  }
  if (result?.stopReason === "error" || result?.stopReason === "aborted") process.exitCode = 1;
  if (raw && (!last.has("sse_finish") || providerError || controller.signal.aborted))
    process.exitCode = 1;
}

if (values["self-test"]) {
  const frames: string[] = [];
  const observe = sseObserver((data) => frames.push(data));
  const input =
    ': ping\r\n\r\ndata: {"text":"思考"}\r\n\r\ndata: first\ndata: second\n\ndata: [DONE]\r\r';
  for (const byte of new TextEncoder().encode(input)) observe(Uint8Array.of(byte));
  assert.deepEqual(frames, ["", '{"text":"思考"}', "first\nsecond", "[DONE]"]);
  assert.equal(observe.end().trailingBytes, 0);
  const incomplete = sseObserver(() => assert.fail("Unterminated SSE frame was dispatched"));
  incomplete(new TextEncoder().encode('data: {"choices":[{"finish_reason":"stop"}]}'));
  assert.equal(incomplete.end().trailingHasFinishReason, true);
  console.log(
    "SSE observer self-test passed (UTF-8, CRLF, multiline, keepalive, split boundaries).",
  );
} else {
  await main().catch((error: unknown) => {
    // Upstream exception messages may contain request headers or payloads.
    console.error(JSON.stringify({ error: error instanceof Error ? error.name : "UnknownError" }));
    process.exitCode = 1;
  });
}
