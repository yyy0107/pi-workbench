import assert from "node:assert/strict";
import test from "node:test";

import type { ServerResponse } from "@workbench/agent-runtime-pi-protocol/rpc";
import type { ProjectTrustProtocol } from "../../../src/trust/project-trust-service";
import { rpcBusinessError } from "../../../src/transport/rpc-transport";
import { createProjectTrustRpcRoutes } from "../../../src/transport/routes/project-trust-rpc-routes";

function rpcRequest(
  method: string,
  payload: unknown,
  options: { host?: string; origin?: string } = {},
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
  });
}

async function responseBody(response: Response): Promise<ServerResponse<unknown>> {
  assert.equal(response.status, 200);
  return (await response.json()) as ServerResponse<unknown>;
}

const unexpectedDomainError = (error: unknown): never => {
  throw error;
};

test("late-binds Project Trust operations and invalidates resources only after updates", async () => {
  const calls: unknown[] = [];
  let resolutions = 0;
  let invalidations = 0;
  const service: ProjectTrustProtocol = {
    describe(payload) {
      calls.push(["describe", payload]);
      return {
        path: payload.path,
        requiresTrust: false,
        trusted: null,
        promptRequired: true,
      };
    },
    update(payload) {
      calls.push(["update", payload]);
      return {
        path: payload.path,
        requiresTrust: false,
        trusted: payload.trusted,
        promptRequired: false,
      };
    },
  };
  const routes = createProjectTrustRpcRoutes({
    getService() {
      resolutions += 1;
      return service;
    },
    afterUpdate() {
      invalidations += 1;
    },
    projectDomainError: unexpectedDomainError,
  });

  for (const [method, payload] of [
    ["projectTrust.describe", { path: "/work", ignored: true }],
    ["projectTrust.update", { path: "/work", trusted: true, ignored: true }],
  ] as const) {
    const response = routes.handle(rpcRequest(method, payload), method);
    assert.ok(response);
    const body = await responseBody(await response);
    assert.equal(body.result.ok, true);
  }

  assert.deepEqual(calls, [
    ["describe", { path: "/work" }],
    ["update", { path: "/work", trusted: true }],
  ]);
  assert.equal(resolutions, 2);
  assert.equal(invalidations, 1);
  for (const method of ["host.describe", "workspace.list", "projectTrust.unknown"]) {
    assert.equal(routes.handle(rpcRequest(method, {}), method), undefined);
  }
});

test("validates Project Trust payloads before resolving the service", async () => {
  let resolutions = 0;
  const routes = createProjectTrustRpcRoutes({
    getService() {
      resolutions += 1;
      throw new Error("Unexpected service resolution");
    },
    afterUpdate() {},
    projectDomainError: unexpectedDomainError,
  });
  for (const [method, payload] of [
    ["projectTrust.describe", { path: "" }],
    ["projectTrust.update", { path: "/work", trusted: "yes" }],
  ] as const) {
    const response = routes.handle(rpcRequest(method, payload), method);
    assert.ok(response);
    const body = await responseBody(await response);
    assert.equal(body.result.ok, false);
    if (body.result.ok) assert.fail("Expected Project Trust validation to fail");
    assert.equal(body.result.error.code, "bad-request");
  }
  assert.equal(resolutions, 0);
});

test("projects Project Trust failures without invalidating scoped resources", async () => {
  const failure = new Error("trust failed");
  let invalidations = 0;
  const routes = createProjectTrustRpcRoutes({
    getService: () => ({
      describe() {
        throw failure;
      },
      update() {
        throw failure;
      },
    }),
    afterUpdate() {
      invalidations += 1;
    },
    projectDomainError(error): never {
      assert.equal(error, failure);
      throw rpcBusinessError("project-trust-write-failed", "Trust failed.", { path: "/work" });
    },
  });

  for (const [method, payload] of [
    ["projectTrust.describe", { path: "/work" }],
    ["projectTrust.update", { path: "/work", trusted: true }],
  ] as const) {
    const response = routes.handle(rpcRequest(method, payload), method);
    assert.ok(response);
    const body = await responseBody(await response);
    assert.equal(body.result.ok, false);
    if (body.result.ok) assert.fail("Expected projected Project Trust failure");
    assert.equal(body.result.error.code, "project-trust-write-failed");
  }
  assert.equal(invalidations, 0);
});

test("keeps Project Trust reads and updates available to explicitly trusted hosts", async (t) => {
  const previousTrustedHosts = process.env.PI_WORKBENCH_TRUSTED_HOSTS;
  process.env.PI_WORKBENCH_TRUSTED_HOSTS = "workbench.example:3080";
  t.after(() => {
    if (previousTrustedHosts === undefined) delete process.env.PI_WORKBENCH_TRUSTED_HOSTS;
    else process.env.PI_WORKBENCH_TRUSTED_HOSTS = previousTrustedHosts;
  });
  const routes = createProjectTrustRpcRoutes({
    getService: () => ({
      describe: ({ path }) => ({
        path,
        requiresTrust: false,
        trusted: true,
        promptRequired: false,
      }),
      update: ({ path, trusted }) => ({
        path,
        requiresTrust: false,
        trusted,
        promptRequired: false,
      }),
    }),
    afterUpdate() {},
    projectDomainError: unexpectedDomainError,
  });
  const options = { host: "workbench.example:3080", origin: "http://workbench.example:3080" };

  for (const [method, payload] of [
    ["projectTrust.describe", { path: "/work" }],
    ["projectTrust.update", { path: "/work", trusted: true }],
  ] as const) {
    const response = routes.handle(rpcRequest(method, payload, options), method);
    assert.ok(response);
    assert.equal((await response).status, 200);
  }
});
