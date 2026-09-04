import assert from "node:assert/strict";
import test from "node:test";

import type { RpcIssue, ServerResponse } from "@workbench/agent-runtime-pi-protocol/rpc";
import type { ExtensionProtocol } from "../../../src/extensions/extension-service";
import { rpcBusinessError } from "@workbench/host-server/rpc";
import { createExtensionRpcRoutes } from "../../../src/transport/routes/extension-rpc-routes";

function rpcRequest(
  method: string,
  payload: unknown,
  options: { host?: string; origin?: string; rpcId?: string } = {},
): Request {
  const host = options.host ?? "127.0.0.1:3000";
  return new Request(`http://${host}/api/${method}`, {
    method: "POST",
    headers: {
      host,
      "content-type": "application/json",
      ...(options.origin === undefined ? {} : { origin: options.origin }),
    },
    body: JSON.stringify({
      type: "client-request",
      rpcId: options.rpcId ?? "rpc-1",
      method,
      payload,
    }),
  });
}

function protocol(overrides: Partial<ExtensionProtocol>): ExtensionProtocol {
  return new Proxy(overrides, {
    get(target, property, receiver) {
      const implementation = Reflect.get(target, property, receiver);
      if (implementation !== undefined) return implementation;
      return async () => {
        throw new Error(`Unexpected Extension protocol call: ${String(property)}`);
      };
    },
  }) as ExtensionProtocol;
}

async function successValue<Value>(response: Response): Promise<Value> {
  assert.equal(response.status, 200);
  const body = (await response.json()) as ServerResponse<Value>;
  assert.equal(body.type, "server-response");
  if (!body.result.ok) assert.fail(`Unexpected RPC error: ${body.result.error.code}`);
  return body.result.value;
}

const unexpectedDomainError = (error: unknown): never => {
  throw error;
};

const sessionIdentity = {
  sessionId: "session-1",
  name: "review",
  filePath: "/home/test/.pi/agent/extensions/review.ts",
  source: "auto",
  scope: "user",
  origin: "top-level",
} as const;

test("claims only the Extension RPC subdomain", async () => {
  const routes = createExtensionRpcRoutes({
    service: protocol({ list: async () => ({ extensions: [], loadErrorCount: 0 }) }),
    projectDomainError: unexpectedDomainError,
  });
  const claimed = routes.handle(
    rpcRequest("extension.list", { sessionId: "session-1", ignored: true }),
    "extension.list",
  );

  assert.ok(claimed);
  assert.deepEqual(await successValue(await claimed), { extensions: [], loadErrorCount: 0 });
  for (const method of [
    "command.list",
    "extension.unknown",
    "package.list",
    "skill.list",
    "workspace.list",
  ]) {
    assert.equal(routes.handle(rpcRequest(method, {}), method), undefined);
  }
});

test("maps all five Extension methods to sanitized protocol inputs", async () => {
  const calls: Array<{ operation: PropertyKey; payload: unknown }> = [];
  const service = new Proxy(
    {},
    {
      get(_target, operation) {
        return async (payload: unknown) => {
          calls.push({ operation, payload });
          return {};
        };
      },
    },
  ) as ExtensionProtocol;
  const routes = createExtensionRpcRoutes({
    service,
    projectDomainError: unexpectedDomainError,
  });
  const cases = [
    {
      method: "extension.list",
      payload: { sessionId: "session-1", ignored: true },
      operation: "list",
      expectedPayload: { sessionId: "session-1" },
    },
    {
      method: "extension.files.read",
      payload: {
        target: { scope: "user", ignored: true },
        name: "  review  ",
        filePath: "/home/test/.pi/agent/extensions/review.ts",
        source: "auto",
        scope: "user",
        origin: "top-level",
        relativePath: "review.ts",
        ignored: true,
      },
      operation: "readFile",
      expectedPayload: {
        target: { scope: "user" },
        name: "review",
        filePath: "/home/test/.pi/agent/extensions/review.ts",
        source: "auto",
        scope: "user",
        origin: "top-level",
        relativePath: "review.ts",
      },
    },
    {
      method: "extension.files.list",
      payload: {
        target: { scope: "project", workspaceId: "workspace-1", ignored: true },
        name: "review",
        filePath: "/workspace/.pi/extensions/review/index.ts",
        source: "auto",
        scope: "project",
        origin: "top-level",
        relativePath: "references",
        ignored: true,
      },
      operation: "listFiles",
      expectedPayload: {
        target: { scope: "project", workspaceId: "workspace-1" },
        name: "review",
        filePath: "/workspace/.pi/extensions/review/index.ts",
        source: "auto",
        scope: "project",
        origin: "top-level",
        relativePath: "references",
      },
    },
    {
      method: "extension.setEnabled",
      payload: { ...sessionIdentity, enabled: false, ignored: true },
      operation: "setEnabled",
      expectedPayload: { ...sessionIdentity, enabled: false },
    },
    {
      method: "extension.remove",
      payload: {
        target: { scope: "user", ignored: true },
        name: "review",
        filePath: "/home/test/.pi/agent/extensions/review.ts",
        source: "auto",
        scope: "user",
        origin: "top-level",
        ignored: true,
      },
      operation: "remove",
      expectedPayload: {
        target: { scope: "user" },
        name: "review",
        filePath: "/home/test/.pi/agent/extensions/review.ts",
        source: "auto",
        scope: "user",
        origin: "top-level",
      },
    },
  ] as const;

  for (const entry of cases) {
    const response = routes.handle(rpcRequest(entry.method, entry.payload), entry.method);
    assert.ok(response);
    await successValue(await response);
  }
  assert.deepEqual(
    calls,
    cases.map(({ operation, expectedPayload }) => ({ operation, payload: expectedPayload })),
  );
});

test("accepts an omitted relative path when reading a single-file Extension entry", async () => {
  let received: unknown;
  const routes = createExtensionRpcRoutes({
    service: protocol({
      async readFile(payload) {
        received = payload;
        return {
          extensionName: payload.name,
          rootPath: "/home/test/.pi/agent/extensions",
          relativePath: "review.ts",
          absolutePath: payload.filePath,
          name: "review.ts",
          content: "export default {}",
          mediaType: "text/typescript",
          encoding: "utf-8",
          version: "sha256:test",
          size: 17,
          modifiedAt: 0,
        };
      },
    }),
    projectDomainError: unexpectedDomainError,
  });
  const response = routes.handle(
    rpcRequest("extension.files.read", sessionIdentity),
    "extension.files.read",
  );

  assert.ok(response);
  await successValue(await response);
  assert.deepEqual(received, sessionIdentity);
});

test("validates Extension identities and bounded fields before invoking the protocol", async () => {
  let calls = 0;
  const routes = createExtensionRpcRoutes({
    service: new Proxy(
      {},
      {
        get() {
          return async () => {
            calls += 1;
            return {};
          };
        },
      },
    ) as ExtensionProtocol,
    projectDomainError: unexpectedDomainError,
  });
  const cases = [
    ["extension.list", {}],
    ["extension.list", { sessionId: "session-1", target: { scope: "user" } }],
    ["extension.remove", { ...sessionIdentity, name: "   " }],
    ["extension.remove", { ...sessionIdentity, name: "x".repeat(513) }],
    ["extension.remove", { ...sessionIdentity, filePath: "" }],
    ["extension.remove", { ...sessionIdentity, filePath: "x".repeat(32_769) }],
    ["extension.remove", { ...sessionIdentity, source: "" }],
    ["extension.remove", { ...sessionIdentity, source: "x".repeat(2_049) }],
    ["extension.remove", { ...sessionIdentity, scope: "workspace" }],
    ["extension.remove", { ...sessionIdentity, origin: "builtin" }],
    ["extension.setEnabled", { ...sessionIdentity, enabled: "false" }],
    ["extension.files.list", { ...sessionIdentity, relativePath: "x".repeat(16_385) }],
    ["extension.files.read", { ...sessionIdentity, relativePath: "" }],
    ["extension.files.read", { ...sessionIdentity, relativePath: "x".repeat(16_385) }],
  ] as const;

  for (const [method, payload] of cases) {
    const response = routes.handle(rpcRequest(method, payload), method);
    assert.ok(response);
    const body = (await (await response).json()) as ServerResponse<never, { issues: RpcIssue[] }>;
    assert.equal(body.result.ok, false);
    if (body.result.ok) assert.fail("Expected an Extension validation failure.");
    assert.equal(body.result.error.code, "bad-request");
  }
  assert.equal(calls, 0);
});

test("keeps Extension mutations loopback-only while allowing reads from trusted hosts", async (t) => {
  const previousTrustedHosts = process.env.PI_WORKBENCH_TRUSTED_HOSTS;
  process.env.PI_WORKBENCH_TRUSTED_HOSTS = "workbench.example:3080";
  t.after(() => {
    if (previousTrustedHosts === undefined) delete process.env.PI_WORKBENCH_TRUSTED_HOSTS;
    else process.env.PI_WORKBENCH_TRUSTED_HOSTS = previousTrustedHosts;
  });
  const calls: PropertyKey[] = [];
  const service = new Proxy(
    {},
    {
      get(_target, operation) {
        return async () => {
          calls.push(operation);
          return {};
        };
      },
    },
  ) as ExtensionProtocol;
  const routes = createExtensionRpcRoutes({ service, projectDomainError: unexpectedDomainError });
  const options = {
    host: "workbench.example:3080",
    origin: "http://workbench.example:3080",
  };

  for (const [method, payload] of [
    ["extension.setEnabled", { ...sessionIdentity, enabled: false }],
    ["extension.remove", sessionIdentity],
  ] as const) {
    const response = routes.handle(rpcRequest(method, payload, options), method);
    assert.ok(response);
    assert.equal((await response).status, 403);
  }
  assert.deepEqual(calls, []);

  for (const [method, payload, operation] of [
    ["extension.list", { sessionId: "session-1" }, "list"],
    ["extension.files.list", sessionIdentity, "listFiles"],
    ["extension.files.read", sessionIdentity, "readFile"],
  ] as const) {
    const response = routes.handle(rpcRequest(method, payload, options), method);
    assert.ok(response);
    await successValue(await response);
    assert.equal(calls.at(-1), operation);
  }
  assert.deepEqual(calls, ["list", "listFiles", "readFile"]);
});

test("delegates Extension domain failures to the shared error projector", async () => {
  const failure = new Error("extension failed");
  const routes = createExtensionRpcRoutes({
    service: protocol({
      async listFiles() {
        throw failure;
      },
    }),
    projectDomainError(error): never {
      assert.equal(error, failure);
      throw rpcBusinessError("extension-failed", "Extension failed.", {
        operation: "listFiles",
      });
    },
  });
  const response = routes.handle(
    rpcRequest("extension.files.list", sessionIdentity),
    "extension.files.list",
  );

  assert.ok(response);
  const body = (await (await response).json()) as ServerResponse<never>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected a projected Extension failure.");
  assert.equal(body.result.error.code, "extension-failed");
  assert.deepEqual(body.result.error.details, { operation: "listFiles" });
});
