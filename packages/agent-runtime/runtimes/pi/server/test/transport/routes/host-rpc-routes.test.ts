import assert from "node:assert/strict";
import test from "node:test";

import type { ServerResponse } from "@workbench/agent-runtime-pi-protocol/rpc";
import type { HostProtocol } from "../../../src/host/host-service";
import { createHostRpcRoutes } from "../../../src/transport/routes/host-rpc-routes";

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

const unexpectedDomainError = (error: unknown): never => {
  throw error;
};

test("claims only the Host capability RPC subdomain", async () => {
  const routes = createHostRpcRoutes({
    service: protocol({
      describe: async () => ({
        product: "pi-workbench",
        version: "1.0.0",
        piVersion: "2.0.0",
        cwd: "/work",
        attachedSessions: 0,
        canOpenPath: true,
      }),
    }),
    projectDomainError: unexpectedDomainError,
  });
  const claimed = routes.handle(rpcRequest("host.describe", {}), "host.describe");

  assert.ok(claimed);
  assert.equal((await successValue<{ cwd: string }>(await claimed)).cwd, "/work");
  for (const method of [
    "host.localApps.list",
    "projectTrust.describe",
    "workspace.list",
    "host.unknown",
  ]) {
    assert.equal(routes.handle(rpcRequest(method, {}), method), undefined);
  }
});
