import assert from "node:assert/strict";
import test from "node:test";

const {
  createRpcError,
  createRpcPostHandler,
  DEFAULT_MAX_RPC_REQUEST_BODY_BYTES,
  handleRpcPost,
  rpcArray,
  rpcBusinessError,
  rpcEnum,
  rpcInteger,
  rpcLiteral,
  rpcNullable,
  rpcObject,
  rpcOptional,
  rpcRecord,
  rpcRefine,
  rpcString,
  rpcUnion,
} = (await import(
  new URL("../../src/transport/rpc-transport.ts", import.meta.url).href
)) as typeof import("../../src/transport/rpc-transport");

type JsonObject = Record<string, unknown>;

function request(
  body: string,
  options: {
    contentType?: string | null;
    headers?: Record<string, string>;
    method?: string;
    url?: string;
  } = {},
): Request {
  const headers = new Headers({ host: "127.0.0.1:3080", ...options.headers });
  if (options.contentType !== null) {
    headers.set("content-type", options.contentType ?? "application/json");
  }
  return new Request(options.url ?? "http://127.0.0.1:3080/api/test.echo", {
    method: options.method ?? "POST",
    headers,
    body: options.method === "GET" || options.method === "HEAD" ? undefined : body,
  });
}

function streamedRequest(chunks: readonly string[]): Request {
  const encoder = new TextEncoder();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunk));
    },
  });
  return new Request("http://127.0.0.1:3080/api/test.echo", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3080",
      "content-type": "application/json",
    },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

function clientRequest(
  payload: unknown,
  options: { method?: unknown; rpcId?: unknown; type?: unknown } = {},
): string {
  return JSON.stringify({
    type: options.type ?? "client-request",
    rpcId: options.rpcId ?? "rpc-1",
    method: options.method ?? "test.echo",
    payload,
  });
}

async function json(response: Response): Promise<JsonObject> {
  return (await response.json()) as JsonObject;
}

const echoPayload = rpcObject({
  name: rpcString({ minLength: 1 }),
  count: rpcOptional(rpcInteger({ minimum: 0 })),
});

test("returns a server response, echoes rpcId, and strips legacy object extras", async () => {
  let received: unknown;
  const response = await handleRpcPost(
    request(
      JSON.stringify({
        type: "client-request",
        rpcId: "echo-1",
        method: "test.echo",
        payload: { name: "Ada", count: 2, ignored: "legacy-compatible" },
        ignoredEnvelopeField: true,
      }),
      { contentType: "Application/JSON; Charset=UTF-8" },
    ),
    {
      method: "test.echo",
      payload: echoPayload,
      handler: (payload, context) => {
        received = payload;
        assert.equal(context.rpcId, "echo-1");
        assert.equal(context.method, "test.echo");
        return { greeting: `Hello, ${payload.name}` };
      },
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
  assert.deepEqual(received, { name: "Ada", count: 2 });
  assert.deepEqual(await json(response), {
    type: "server-response",
    rpcId: "echo-1",
    result: { ok: true, value: { greeting: "Hello, Ada" } },
  });
});

test("the generated POST handler uses the same transport behavior", async () => {
  const post = createRpcPostHandler({
    method: "test.echo",
    payload: echoPayload,
    handler: ({ name }) => name.toUpperCase(),
  });

  const response = await post(request(clientRequest({ name: "Grace" })));
  assert.deepEqual(await json(response), {
    type: "server-response",
    rpcId: "rpc-1",
    result: { ok: true, value: "GRACE" },
  });
});

test("rejects untrusted local API requests before reading RPC input", async () => {
  const options = {
    method: "test.echo",
    payload: echoPayload,
    handler: () => assert.fail("handler must not run"),
  };

  const nonLoopback = await handleRpcPost(
    request(clientRequest({ name: "Ada" }), { headers: { host: "example.com:3080" } }),
    options,
  );
  assert.equal(nonLoopback.status, 403);

  const crossSite = await handleRpcPost(
    request(clientRequest({ name: "Ada" }), {
      headers: {
        origin: "http://127.0.0.1:3080",
        "sec-fetch-site": "cross-site",
      },
    }),
    options,
  );
  assert.equal(crossSite.status, 403);
});

test("allows configured trusted hosts but enforces loopback-only capabilities", async () => {
  const trustedRequest = () =>
    request(clientRequest({ name: "Ada" }), {
      headers: {
        host: "workbench.example:3080",
        origin: "http://workbench.example:3080",
      },
    });
  const trustedHosts = ["workbench.example:3080"];

  assert.equal(
    (
      await handleRpcPost(trustedRequest(), {
        method: "test.echo",
        payload: echoPayload,
        trustedHosts,
        handler: ({ name }) => name,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await handleRpcPost(trustedRequest(), {
        method: "test.echo",
        payload: echoPayload,
        trustedHosts,
        loopbackOnly: true,
        handler: () => assert.fail("loopback-only handler must not run"),
      })
    ).status,
    403,
  );
});

test("requires POST and application/json while allowing JSON parameters", async () => {
  const options = {
    method: "test.echo",
    payload: echoPayload,
    handler: () => "unused",
  };

  const wrongMethod = await handleRpcPost(
    request("", { method: "GET", contentType: null }),
    options,
  );
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "POST");

  const missingType = await handleRpcPost(
    request(clientRequest({ name: "Ada" }), { contentType: null }),
    options,
  );
  assert.equal(missingType.status, 415);

  const wrongType = await handleRpcPost(
    request(clientRequest({ name: "Ada" }), { contentType: "text/json" }),
    options,
  );
  assert.equal(wrongType.status, 415);

  const parameterized = await handleRpcPost(
    request(clientRequest({ name: "Ada" }), {
      contentType: "application/json;charset=utf-8",
    }),
    options,
  );
  assert.equal(parameterized.status, 200);
});

test("enforces both declared Content-Length and accumulated body limits", async () => {
  const options = {
    method: "test.echo",
    payload: echoPayload,
    handler: () => "unused",
    maxRequestBodyBytes: 64,
  };

  const declared = await handleRpcPost(
    request(clientRequest({ name: "A" }), { headers: { "content-length": "65" } }),
    options,
  );
  assert.equal(declared.status, 413);
  assert.equal(declared.headers.get("connection"), "close");

  const actual = await handleRpcPost(request(clientRequest({ name: "A".repeat(80) })), options);
  assert.equal(actual.status, 413);

  const malformedLength = await handleRpcPost(
    request(clientRequest({ name: "A" }), { headers: { "content-length": "12x" } }),
    options,
  );
  assert.equal(malformedLength.status, 400);
});

test("ordinary RPCs reject declared and streamed bodies above the default budget", async () => {
  const options = {
    method: "test.echo",
    payload: echoPayload,
    handler: () => assert.fail("handler must not run"),
  };

  const declared = await handleRpcPost(
    request(clientRequest({ name: "Ada" }), {
      headers: { "content-length": String(DEFAULT_MAX_RPC_REQUEST_BODY_BYTES + 1) },
    }),
    options,
  );
  assert.equal(declared.status, 413);

  const oversizedUnknownField = JSON.stringify({
    type: "client-request",
    rpcId: "rpc-oversized-unknown",
    method: "test.echo",
    payload: { name: "Ada" },
    ignoredEnvelopeField: "x".repeat(DEFAULT_MAX_RPC_REQUEST_BODY_BYTES),
  });
  const midpoint = Math.floor(oversizedUnknownField.length / 2);
  const streamed = streamedRequest([
    oversizedUnknownField.slice(0, midpoint),
    oversizedUnknownField.slice(midpoint),
  ]);
  assert.equal(streamed.headers.has("content-length"), false);

  const accumulated = await handleRpcPost(streamed, options);
  assert.equal(accumulated.status, 413);
  assert.equal(accumulated.headers.get("connection"), "close");
});

test("uses HTTP 400 only when the JSON text itself cannot be parsed", async () => {
  const response = await handleRpcPost(request('{"type":"client-request",'), {
    method: "test.echo",
    payload: echoPayload,
    handler: () => assert.fail("handler must not run"),
  });

  assert.equal(response.status, 400);
  assert.equal(await response.text(), "Bad Request");
});

test("maps valid JSON with invalid envelope, endpoint, or payload to bad-request", async (t) => {
  const cases: Array<{
    name: string;
    body: string;
    expectedRpcId: string;
    expectedPath: Array<string | number>;
  }> = [
    {
      name: "non-object envelope",
      body: JSON.stringify([]),
      expectedRpcId: "",
      expectedPath: [],
    },
    {
      name: "wrong discriminator",
      body: clientRequest({ name: "Ada" }, { type: "request", rpcId: "bad-type" }),
      expectedRpcId: "bad-type",
      expectedPath: ["type"],
    },
    {
      name: "non-string rpcId",
      body: clientRequest({ name: "Ada" }, { rpcId: 42 }),
      expectedRpcId: "",
      expectedPath: ["rpcId"],
    },
    {
      name: "method does not equal endpoint",
      body: clientRequest({ name: "Ada" }, { method: "test.other", rpcId: "wrong-method" }),
      expectedRpcId: "wrong-method",
      expectedPath: ["method"],
    },
    {
      name: "invalid payload",
      body: clientRequest({ name: 7 }, { rpcId: "bad-payload" }),
      expectedRpcId: "bad-payload",
      expectedPath: ["payload", "name"],
    },
    {
      name: "missing payload",
      body: JSON.stringify({
        type: "client-request",
        rpcId: "missing-payload",
        method: "test.echo",
      }),
      expectedRpcId: "missing-payload",
      expectedPath: ["payload"],
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      let calls = 0;
      const response = await handleRpcPost(request(item.body), {
        method: "test.echo",
        payload: echoPayload,
        handler: () => {
          calls += 1;
          return "unexpected";
        },
      });

      assert.equal(response.status, 200);
      const body = await json(response);
      assert.equal(body.type, "server-response");
      assert.equal(body.rpcId, item.expectedRpcId);
      const result = body.result as JsonObject;
      assert.equal(result.ok, false);
      const error = result.error as JsonObject;
      assert.equal(error.code, "bad-request");
      const details = error.details as JsonObject;
      const issues = details.issues as JsonObject[];
      assert.ok(
        issues.some((issue) => assert.deepEqual(issue.path, item.expectedPath) === undefined),
      );
      assert.equal(calls, 0);
    });
  }
});

test("returns structured business failures with HTTP 200 and the caller rpcId", async () => {
  const response = await handleRpcPost(request(clientRequest({ name: "Ada" })), {
    method: "test.echo",
    payload: echoPayload,
    handler: () => {
      throw rpcBusinessError("workspace-not-found", "workspace not found", {
        workspaceId: "workspace-1",
      });
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), {
    type: "server-response",
    rpcId: "rpc-1",
    result: {
      ok: false,
      error: createRpcError("workspace-not-found", "workspace not found", {
        workspaceId: "workspace-1",
      }),
    },
  });
});

test("turns unknown exceptions into detail-free HTTP 500 responses", async () => {
  const expected = new Error("database password is secret");
  let reported: unknown;
  const response = await handleRpcPost(request(clientRequest({ name: "Ada" })), {
    method: "test.echo",
    payload: echoPayload,
    handler: () => {
      throw expected;
    },
    onUnexpectedError: (error) => {
      reported = error;
    },
  });

  assert.equal(reported, expected);
  assert.equal(response.status, 500);
  const body = await response.text();
  assert.equal(body, "Internal Server Error");
  assert.doesNotMatch(body, /password|secret|database/i);
});

test("payload primitives compose and report nested paths", () => {
  const schema = rpcRefine(
    rpcObject({
      mode: rpcEnum(["fast", "safe"]),
      values: rpcArray(rpcInteger({ minimum: 0 }), { minLength: 1, maxLength: 2 }),
      label: rpcOptional(rpcNullable(rpcString({ minLength: 1, trim: true }))),
      metadata: rpcRecord(rpcString()),
      selection: rpcUnion([rpcLiteral("auto"), rpcInteger({ minimum: 1 })]),
    }),
    (value) => value.mode !== "safe" || value.values.length === 1,
    { message: "Safe mode accepts one value", path: ["values"] },
  );

  const valid = schema({
    mode: "fast",
    values: [1, 2],
    label: "  example  ",
    metadata: { source: "test" },
    selection: "auto",
    ignored: true,
  });
  assert.deepEqual(valid, {
    ok: true,
    value: {
      mode: "fast",
      values: [1, 2],
      label: "example",
      metadata: { source: "test" },
      selection: "auto",
    },
  });

  const nestedFailure = schema({
    mode: "fast",
    values: [1, -1],
    metadata: { source: "test" },
    selection: "auto",
  });
  assert.equal(nestedFailure.ok, false);
  if (!nestedFailure.ok) assert.deepEqual(nestedFailure.issues[0]?.path, ["values", 1]);

  const refinementFailure = schema({
    mode: "safe",
    values: [1, 2],
    metadata: {},
    selection: 1,
  });
  assert.equal(refinementFailure.ok, false);
  if (!refinementFailure.ok) assert.deepEqual(refinementFailure.issues[0]?.path, ["values"]);
});
