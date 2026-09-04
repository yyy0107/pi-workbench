import assert from "node:assert/strict";
import test from "node:test";

import { type ServerResponse } from "@workbench/host-contracts/rpc";
import type { LocalAppProtocol } from "../src/local-apps/service";
import { rpcBusinessError } from "@workbench/host-server/rpc";
import { createLocalAppRpcRoutes } from "../src/local-app-rpc-routes";

function rpcRequest(
  method: string,
  payload: unknown,
  options: { host?: string; origin?: string; signal?: AbortSignal } = {},
): Request {
  const host = options.host ?? "127.0.0.1:3000";
  return new Request(`http://${host}/api/${method}`, {
    method: "POST",
    headers: {
      host,
      "content-type": "application/json",
      ...(options.origin === undefined ? {} : { origin: options.origin }),
    },
    body: JSON.stringify({ type: "client-request", rpcId: "rpc-1", method, payload }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
}

function protocol(overrides: Partial<LocalAppProtocol>): LocalAppProtocol {
  return new Proxy(overrides, {
    get(target, property, receiver) {
      const implementation = Reflect.get(target, property, receiver);
      if (implementation !== undefined) return implementation;
      return async () => {
        throw new Error(`Unexpected Local App protocol call: ${String(property)}`);
      };
    },
  }) as LocalAppProtocol;
}

async function responseBody(response: Response): Promise<ServerResponse<unknown>> {
  assert.equal(response.status, 200);
  return (await response.json()) as ServerResponse<unknown>;
}

const unexpectedDomainError = (error: unknown): never => {
  throw error;
};

test("claims and maps only the Local App RPC subdomain", async () => {
  const calls: Array<{ operation: string; appId?: string; target?: string; signal?: AbortSignal }> =
    [];
  const routes = createLocalAppRpcRoutes({
    service: protocol({
      async list(signal) {
        calls.push({ operation: "list", signal });
        return { apps: [] };
      },
      async refresh(signal) {
        calls.push({ operation: "refresh", signal });
        return { apps: [] };
      },
      async open(appId, target, signal) {
        calls.push({ operation: "open", appId, target, signal });
        return { opened: true };
      },
    }),
    projectDomainError: unexpectedDomainError,
  });
  const cases = [
    ["host.localApps.list", { ignored: true }],
    ["host.localApps.refresh", { ignored: true }],
    ["host.localApps.open", { appId: "editor", target: "/work", ignored: true }],
  ] as const;
  const requests = cases.map(([method, payload]) => rpcRequest(method, payload));

  for (const [index, [method]] of cases.entries()) {
    const response = routes.handle(requests[index]!, method);
    assert.ok(response);
    const body = await responseBody(await response);
    assert.equal(body.result.ok, true);
  }
  assert.deepEqual(
    calls.map(({ operation, appId, target }) => ({ operation, appId, target })),
    [
      { operation: "list", appId: undefined, target: undefined },
      { operation: "refresh", appId: undefined, target: undefined },
      { operation: "open", appId: "editor", target: "/work" },
    ],
  );
  assert.equal(calls[0]?.signal, requests[0]?.signal);
  assert.equal(calls[1]?.signal, requests[1]?.signal);
  assert.equal(calls[2]?.signal, requests[2]?.signal);
  for (const method of ["host.describe", "projectTrust.describe", "host.localApps.unknown"]) {
    assert.equal(routes.handle(rpcRequest(method, {}), method), undefined);
  }
});

test("validates Local App open payloads before invoking the protocol", async () => {
  let calls = 0;
  const routes = createLocalAppRpcRoutes({
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
    ) as LocalAppProtocol,
    projectDomainError: unexpectedDomainError,
  });
  for (const payload of [
    { appId: "", target: "/work" },
    { appId: "editor", target: "" },
    { appId: "x".repeat(257), target: "/work" },
    { appId: "editor", target: "x".repeat(32_769) },
  ]) {
    const response = routes.handle(
      rpcRequest("host.localApps.open", payload),
      "host.localApps.open",
    );
    assert.ok(response);
    const body = await responseBody(await response);
    assert.equal(body.result.ok, false);
    if (body.result.ok) assert.fail("Expected Local App payload validation to fail");
    assert.equal(body.result.error.code, "bad-request");
  }
  assert.equal(calls, 0);
});

test("normalizes Local App cancellation and delegates domain failures", async () => {
  const abortError = Object.assign(new Error("cancelled"), { name: "AbortError" });
  const cancelledRoutes = createLocalAppRpcRoutes({
    service: protocol({
      list: async () => {
        throw abortError;
      },
      refresh: async () => {
        throw abortError;
      },
      open: async () => {
        throw abortError;
      },
    }),
    projectDomainError: unexpectedDomainError,
  });
  for (const [method, payload, message] of [
    ["host.localApps.list", {}, "Local application detection was cancelled."],
    ["host.localApps.refresh", {}, "Local application detection was cancelled."],
    [
      "host.localApps.open",
      { appId: "editor", target: "/work" },
      "Opening the local application was cancelled.",
    ],
  ] as const) {
    const response = cancelledRoutes.handle(rpcRequest(method, payload), method);
    assert.ok(response);
    const body = await responseBody(await response);
    assert.equal(body.result.ok, false);
    if (body.result.ok) assert.fail("Expected Local App cancellation");
    assert.equal(body.result.error.code, "cancelled");
    assert.equal(body.result.error.message, message);
  }

  const failure = new Error("detection failed");
  const failedRoutes = createLocalAppRpcRoutes({
    service: protocol({
      list: async () => {
        throw failure;
      },
    }),
    projectDomainError(error): never {
      assert.equal(error, failure);
      throw rpcBusinessError("local-app-launch-failed", "Local App failed.", { appId: "editor" });
    },
  });
  const response = failedRoutes.handle(
    rpcRequest("host.localApps.list", {}),
    "host.localApps.list",
  );
  assert.ok(response);
  const body = await responseBody(await response);
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected projected Local App failure");
  assert.equal(body.result.error.code, "local-app-launch-failed");
});

test("keeps every Local App capability loopback-only", async (t) => {
  const previousTrustedHosts = process.env.PI_WORKBENCH_TRUSTED_HOSTS;
  process.env.PI_WORKBENCH_TRUSTED_HOSTS = "workbench.example:3080";
  t.after(() => {
    if (previousTrustedHosts === undefined) delete process.env.PI_WORKBENCH_TRUSTED_HOSTS;
    else process.env.PI_WORKBENCH_TRUSTED_HOSTS = previousTrustedHosts;
  });
  let calls = 0;
  const routes = createLocalAppRpcRoutes({
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
    ) as LocalAppProtocol,
    projectDomainError: unexpectedDomainError,
  });
  const options = { host: "workbench.example:3080", origin: "http://workbench.example:3080" };
  for (const [method, payload] of [
    ["host.localApps.list", {}],
    ["host.localApps.refresh", {}],
    ["host.localApps.open", { appId: "editor", target: "/work" }],
  ] as const) {
    const response = routes.handle(rpcRequest(method, payload, options), method);
    assert.ok(response);
    assert.equal((await response).status, 403);
  }
  assert.equal(calls, 0);
});
