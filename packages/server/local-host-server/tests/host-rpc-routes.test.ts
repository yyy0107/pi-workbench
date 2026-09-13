import assert from "node:assert/strict";
import test from "node:test";

import type { ServerResponse } from "@workbench/host-contracts/rpc";
import type { LocalHostProtocol as HostProtocol } from "../src/service";
import { rpcBusinessError } from "@workbench/host-server/rpc";
import { createLocalHostRpcRoutes as createHostRpcRoutes } from "../src/rpc";

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

function protocol(overrides: Partial<HostProtocol>): HostProtocol {
  return new Proxy(overrides, {
    get(target, property, receiver) {
      const implementation = Reflect.get(target, property, receiver);
      if (implementation !== undefined) return implementation;
      return async () => {
        throw new Error(`Unexpected Host protocol call: ${String(property)}`);
      };
    },
  }) as HostProtocol;
}

async function successValue<Value>(response: Response): Promise<Value> {
  assert.equal(response.status, 200);
  const body = (await response.json()) as ServerResponse<Value>;
  if (!body.result.ok) assert.fail(`Unexpected RPC error: ${body.result.error.code}`);
  return body.result.value;
}

async function errorValue(response: Response) {
  const body = (await response.json()) as ServerResponse<never>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected an RPC error");
  return body.result.error;
}

const unexpectedDomainError = (error: unknown): never => {
  throw error;
};

test("maps Host payloads to the protocol and preserves request signals", async () => {
  const calls: Array<{ operation: string; input?: unknown; signal?: AbortSignal }> = [];
  const service = protocol({
    async pickDirectory(signal) {
      calls.push({ operation: "pickDirectory", signal });
      return { path: "/picked" };
    },
    async listDirectory(path, signal) {
      calls.push({ operation: "listDirectory", input: path, signal });
      return { path: path ?? "/home", home: "/home", crumbs: [], entries: [], truncated: false };
    },
    async createDirectory(input) {
      calls.push({ operation: "createDirectory", input });
      return { path: `${input.path}/${input.name}` };
    },
    async openPath(path, signal) {
      calls.push({ operation: "openPath", input: path, signal });
      return { opened: true };
    },
  });
  const routes = createHostRpcRoutes({ service, projectDomainError: unexpectedDomainError });
  const cases = [
    ["host.pickDirectory", { ignored: true }],
    ["host.listDirectory", { path: "/work", ignored: true }],
    ["host.createDirectory", { path: "/work", name: "src", ignored: true }],
    ["host.openPath", { path: "/work/src", ignored: true }],
  ] as const;
  const requests = cases.map(([method, payload]) => rpcRequest(method, payload));

  for (const [index, [method]] of cases.entries()) {
    const response = routes.handle(requests[index]!, method);
    assert.ok(response);
    await successValue(await response);
  }

  assert.deepEqual(
    calls.map(({ operation, input }) => ({ operation, input })),
    [
      { operation: "pickDirectory", input: undefined },
      { operation: "listDirectory", input: "/work" },
      { operation: "createDirectory", input: { path: "/work", name: "src" } },
      { operation: "openPath", input: "/work/src" },
    ],
  );
  assert.equal(calls[0]?.signal, requests[0]?.signal);
  assert.equal(calls[1]?.signal, requests[1]?.signal);
  assert.equal(calls[3]?.signal, requests[3]?.signal);
});

test("normalizes Host cancellation and open failures", async () => {
  const abortError = Object.assign(new Error("cancelled"), { name: "AbortError" });
  const cancelledRoutes = createHostRpcRoutes({
    service: protocol({
      pickDirectory: async () => {
        throw abortError;
      },
      listDirectory: async () => {
        throw abortError;
      },
      openPath: async () => {
        throw abortError;
      },
    }),
    projectDomainError: unexpectedDomainError,
  });
  for (const [method, payload, message] of [
    ["host.pickDirectory", {}, "Directory selection was cancelled."],
    ["host.listDirectory", {}, "Directory listing was cancelled."],
    ["host.openPath", { path: "/work" }, "Opening the host path was cancelled."],
  ] as const) {
    const response = cancelledRoutes.handle(rpcRequest(method, payload), method);
    assert.ok(response);
    const error = await errorValue(await response);
    assert.equal(error.code, "cancelled");
    assert.equal(error.message, message);
  }

  const failedRoutes = createHostRpcRoutes({
    service: protocol({
      openPath: async () => {
        throw new Error("launcher failed");
      },
    }),
    projectDomainError: unexpectedDomainError,
  });
  const response = failedRoutes.handle(
    rpcRequest("host.openPath", { path: "/work" }),
    "host.openPath",
  );
  assert.ok(response);
  const error = await errorValue(await response);
  assert.equal(error.code, "internal");
  assert.equal(error.message, "The host could not open the requested path.");
});

test("delegates Host directory failures to the shared error projector", async () => {
  const failure = new Error("directory failed");
  const routes = createHostRpcRoutes({
    service: protocol({
      createDirectory: async () => {
        throw failure;
      },
    }),
    projectDomainError(error): never {
      assert.equal(error, failure);
      throw rpcBusinessError("directory-create-failed", "Directory creation failed.", {
        path: "/work/new",
      });
    },
  });
  const response = routes.handle(
    rpcRequest("host.createDirectory", { path: "/work", name: "new" }),
    "host.createDirectory",
  );

  assert.ok(response);
  const error = await errorValue(await response);
  assert.equal(error.code, "directory-create-failed");
  assert.deepEqual(error.details, { path: "/work/new" });
});

test("keeps directory reads remote-capable while native Host actions stay loopback-only", async (t) => {
  const previousTrustedHosts = process.env.PI_WORKBENCH_TRUSTED_HOSTS;
  process.env.PI_WORKBENCH_TRUSTED_HOSTS = "workbench.example:3080";
  t.after(() => {
    if (previousTrustedHosts === undefined) delete process.env.PI_WORKBENCH_TRUSTED_HOSTS;
    else process.env.PI_WORKBENCH_TRUSTED_HOSTS = previousTrustedHosts;
  });
  const routes = createHostRpcRoutes({
    service: protocol({
      listDirectory: async (path) => ({
        path: path ?? "/home",
        home: "/home",
        crumbs: [],
        entries: [],
        truncated: false,
      }),
    }),
    projectDomainError: unexpectedDomainError,
  });
  const options = { host: "workbench.example:3080", origin: "http://workbench.example:3080" };

  const read = routes.handle(
    rpcRequest("host.listDirectory", { path: "/work" }, options),
    "host.listDirectory",
  );
  assert.ok(read);
  assert.equal((await read).status, 200);
  for (const method of ["host.pickDirectory", "host.openPath"] as const) {
    const payload = method === "host.openPath" ? { path: "/work" } : {};
    const response = routes.handle(rpcRequest(method, payload, options), method);
    assert.ok(response);
    assert.equal((await response).status, 403);
  }
});
