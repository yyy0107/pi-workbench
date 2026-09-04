import assert from "node:assert/strict";
import test from "node:test";

import type { RpcIssue, ServerResponse } from "@workbench/agent-runtime-pi-protocol/rpc";
import type { ExternalSessionImportProtocol } from "../../../src/imports/external-session-import-service";
import { createExternalSessionImportRpcRoutes } from "../../../src/transport/routes/external-session-import-rpc-routes";

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

function protocol(
  overrides: Partial<ExternalSessionImportProtocol>,
): ExternalSessionImportProtocol {
  return new Proxy(overrides, {
    get(target, property, receiver) {
      const implementation = Reflect.get(target, property, receiver);
      if (implementation !== undefined) return implementation;
      return async () => {
        throw new Error(`Unexpected external import service call: ${String(property)}`);
      };
    },
  }) as ExternalSessionImportProtocol;
}

async function successValue<Value>(response: Response): Promise<Value> {
  assert.equal(response.status, 200);
  const body = (await response.json()) as ServerResponse<Value>;
  assert.equal(body.type, "server-response");
  if (!body.result.ok) assert.fail(`Unexpected RPC error: ${body.result.error.code}`);
  return body.result.value;
}

test("claims only the external session import subdomain", async () => {
  const routes = createExternalSessionImportRpcRoutes({
    service: protocol({ scan: async () => ({ sources: [] }) }),
  });
  const claimed = routes.handle(
    rpcRequest("sessionImport.scan", { ignored: true }),
    "sessionImport.scan",
  );

  assert.ok(claimed);
  assert.deepEqual(await successValue(await claimed), { sources: [] });
  for (const method of [
    "session.list",
    "session.contextTrace.list",
    "respond",
    "sessionImport.unknown",
  ]) {
    assert.equal(routes.handle(rpcRequest(method, {}), method), undefined);
  }
});

test("maps scan and import to the narrow service protocol", async () => {
  const calls: Array<{ operation: PropertyKey; args: unknown[] }> = [];
  const recordingService = new Proxy(
    {},
    {
      get(_target, operation) {
        return async (...args: unknown[]) => {
          calls.push({ operation, args });
          return operation === "scan" ? { sources: [] } : { imported: [], skipped: [] };
        };
      },
    },
  ) as ExternalSessionImportProtocol;
  const routes = createExternalSessionImportRpcRoutes({ service: recordingService });

  const scanResponse = routes.handle(
    rpcRequest("sessionImport.scan", { ignored: true }),
    "sessionImport.scan",
  );
  assert.ok(scanResponse);
  await successValue(await scanResponse);
  assert.deepEqual(calls, [{ operation: "scan", args: [] }]);

  calls.length = 0;
  const importResponse = routes.handle(
    rpcRequest("sessionImport.import", {
      sessions: [
        { source: "codex", sourceSessionId: "codex-1", ignored: true },
        { source: "claude-code", sourceSessionId: "claude-1" },
        { source: "cursor", sourceSessionId: "cursor-1" },
      ],
      ignored: true,
    }),
    "sessionImport.import",
  );
  assert.ok(importResponse);
  await successValue(await importResponse);
  assert.deepEqual(calls, [
    {
      operation: "import",
      args: [
        [
          { source: "codex", sourceSessionId: "codex-1" },
          { source: "claude-code", sourceSessionId: "claude-1" },
          { source: "cursor", sourceSessionId: "cursor-1" },
        ],
      ],
    },
  ]);
});

test("validates source identities and the bounded import batch before calling the service", async () => {
  let calls = 0;
  const routes = createExternalSessionImportRpcRoutes({
    service: new Proxy(
      {},
      {
        get() {
          return async () => {
            calls += 1;
            return { imported: [], skipped: [] };
          };
        },
      },
    ) as ExternalSessionImportProtocol,
  });
  const oversizedBatch = Array.from({ length: 201 }, (_, index) => ({
    source: "codex",
    sourceSessionId: `session-${index}`,
  }));

  for (const payload of [
    { sessions: [{ source: "unknown", sourceSessionId: "session-1" }] },
    { sessions: [{ source: "codex", sourceSessionId: "" }] },
    { sessions: [{ source: "codex", sourceSessionId: "x".repeat(513) }] },
    { sessions: oversizedBatch },
  ]) {
    const response = routes.handle(
      rpcRequest("sessionImport.import", payload),
      "sessionImport.import",
    );
    assert.ok(response);
    const body = (await (await response).json()) as ServerResponse<never, { issues: RpcIssue[] }>;
    assert.equal(body.result.ok, false);
    if (body.result.ok) assert.fail("Expected an external import validation failure.");
    assert.equal(body.result.error.code, "bad-request");
  }
  assert.equal(calls, 0);
});

test("keeps scan and import restricted to loopback callers", async (t) => {
  const previousTrustedHosts = process.env.PI_WORKBENCH_TRUSTED_HOSTS;
  process.env.PI_WORKBENCH_TRUSTED_HOSTS = "workbench.example:3080";
  t.after(() => {
    if (previousTrustedHosts === undefined) delete process.env.PI_WORKBENCH_TRUSTED_HOSTS;
    else process.env.PI_WORKBENCH_TRUSTED_HOSTS = previousTrustedHosts;
  });
  let calls = 0;
  const routes = createExternalSessionImportRpcRoutes({
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
    ) as ExternalSessionImportProtocol,
  });

  for (const [method, payload] of [
    ["sessionImport.scan", {}],
    ["sessionImport.import", { sessions: [] }],
  ] as const) {
    const response = routes.handle(
      rpcRequest(method, payload, {
        host: "workbench.example:3080",
        origin: "http://workbench.example:3080",
      }),
      method,
    );
    assert.ok(response);
    assert.equal((await response).status, 403);
  }
  assert.equal(calls, 0);
});
