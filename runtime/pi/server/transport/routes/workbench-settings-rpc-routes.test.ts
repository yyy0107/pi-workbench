import assert from "node:assert/strict";
import test from "node:test";

import type { ServerResponse } from "@/runtime/pi/contracts/rpc";
import type { WorkbenchSettingsProtocol } from "../../settings/workbench-settings-service";
import { rpcBusinessError } from "../rpc-transport";
import { createWorkbenchSettingsRpcRoutes } from "./workbench-settings-rpc-routes";

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

function protocol(overrides: Partial<WorkbenchSettingsProtocol>): WorkbenchSettingsProtocol {
  return new Proxy(overrides, {
    get(target, property, receiver) {
      const implementation = Reflect.get(target, property, receiver);
      if (implementation !== undefined) return implementation;
      return async () => {
        throw new Error(`Unexpected Workbench Settings protocol call: ${String(property)}`);
      };
    },
  }) as WorkbenchSettingsProtocol;
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

test("claims only the Workbench Settings RPC subdomain", async () => {
  const routes = createWorkbenchSettingsRpcRoutes({
    getService: () => protocol({ describe: async () => ({ revision: 0, preferences: {} }) }),
    projectDomainError: unexpectedDomainError,
  });
  const claimed = routes.handle(
    rpcRequest("workbenchSettings.describe", {}),
    "workbenchSettings.describe",
  );

  assert.ok(claimed);
  assert.deepEqual(await successValue(await claimed), { revision: 0, preferences: {} });
  for (const method of [
    "imageUnderstanding.describe",
    "settings.describe",
    "workbenchSettings.unknown",
  ]) {
    assert.equal(routes.handle(rpcRequest(method, {}), method), undefined);
  }
});

test("resolves a Workbench Settings service per call and sanitizes preference patches", async () => {
  const calls: unknown[] = [];
  let resolutions = 0;
  const service = protocol({
    async describe() {
      calls.push("describe");
      return { revision: 1, preferences: {} };
    },
    async update(payload) {
      calls.push(payload);
      return { revision: 2 };
    },
  });
  const routes = createWorkbenchSettingsRpcRoutes({
    getService() {
      resolutions += 1;
      return service;
    },
    projectDomainError: unexpectedDomainError,
  });
  const describe = routes.handle(
    rpcRequest("workbenchSettings.describe", { ignored: true }),
    "workbenchSettings.describe",
  );
  assert.ok(describe);
  await successValue(await describe);

  const update = routes.handle(
    rpcRequest("workbenchSettings.update", {
      patch: {
        locale: "zh-CN",
        sidebarThreadSortMode: "manual",
        toolboxPins: ["skills", "packages"],
        toolboxScope: { kind: "project", workspaceId: "workspace-1", ignored: true },
        sidebarOpen: false,
        ignored: true,
      },
      ignored: true,
    }),
    "workbenchSettings.update",
  );
  assert.ok(update);
  await successValue(await update);

  assert.equal(resolutions, 2);
  assert.deepEqual(calls, [
    "describe",
    {
      patch: {
        locale: "zh-CN",
        sidebarThreadSortMode: "manual",
        toolboxPins: ["skills", "packages"],
        toolboxScope: { kind: "project", workspaceId: "workspace-1" },
        sidebarOpen: false,
      },
    },
  ]);
});

test("validates Workbench Settings patches before resolving a service", async () => {
  let resolutions = 0;
  const routes = createWorkbenchSettingsRpcRoutes({
    getService() {
      resolutions += 1;
      return protocol({});
    },
    projectDomainError: unexpectedDomainError,
  });

  for (const payload of [
    {},
    { patch: { locale: "en" } },
    { patch: { sidebarThreadSortMode: "alphabetical" } },
    { patch: { toolboxScope: { kind: "project", workspaceId: "" } } },
    { patch: { modelSelector: { modelId: "" } } },
    { patch: { backgroundImage: { name: "", mimeType: "image/png", data: "AAAA" } } },
  ]) {
    const response = routes.handle(
      rpcRequest("workbenchSettings.update", payload),
      "workbenchSettings.update",
    );
    assert.ok(response);
    const body = (await (await response).json()) as ServerResponse<never>;
    assert.equal(body.result.ok, false);
    if (body.result.ok) assert.fail("Expected a Workbench Settings validation failure.");
    assert.equal(body.result.error.code, "bad-request");
  }
  assert.equal(resolutions, 0);
});

test("preserves the large Workbench Settings carrier budget", async () => {
  let received: unknown;
  const routes = createWorkbenchSettingsRpcRoutes({
    getService: () =>
      protocol({
        async update(payload) {
          received = payload;
          return { revision: 1 };
        },
      }),
    projectDomainError: unexpectedDomainError,
  });
  const data = "A".repeat(1024 * 1024);
  const response = routes.handle(
    rpcRequest("workbenchSettings.update", {
      patch: { backgroundImage: { name: "large.png", mimeType: "image/png", data } },
    }),
    "workbenchSettings.update",
  );

  assert.ok(response);
  assert.deepEqual(await successValue(await response), { revision: 1 });
  assert.deepEqual(received, {
    patch: { backgroundImage: { name: "large.png", mimeType: "image/png", data } },
  });
});

test("allows Workbench Settings RPCs from configured trusted hosts", async (t) => {
  const previousTrustedHosts = process.env.PI_WORKBENCH_TRUSTED_HOSTS;
  process.env.PI_WORKBENCH_TRUSTED_HOSTS = "workbench.example:3080";
  t.after(() => {
    if (previousTrustedHosts === undefined) delete process.env.PI_WORKBENCH_TRUSTED_HOSTS;
    else process.env.PI_WORKBENCH_TRUSTED_HOSTS = previousTrustedHosts;
  });
  const calls: string[] = [];
  const service = protocol({
    async describe() {
      calls.push("describe");
      return { revision: 0, preferences: {} };
    },
    async update() {
      calls.push("update");
      return { revision: 1 };
    },
  });
  const routes = createWorkbenchSettingsRpcRoutes({
    getService: () => service,
    projectDomainError: unexpectedDomainError,
  });
  const options = {
    host: "workbench.example:3080",
    origin: "http://workbench.example:3080",
  };

  for (const [method, payload] of [
    ["workbenchSettings.describe", {}],
    ["workbenchSettings.update", { patch: {} }],
  ] as const) {
    const response = routes.handle(rpcRequest(method, payload, options), method);
    assert.ok(response);
    await successValue(await response);
  }
  assert.deepEqual(calls, ["describe", "update"]);
});

test("delegates Workbench Settings failures to the shared error projector", async () => {
  const failure = new Error("preferences failed");
  const routes = createWorkbenchSettingsRpcRoutes({
    getService: () =>
      protocol({
        async describe() {
          throw failure;
        },
      }),
    projectDomainError(error): never {
      assert.equal(error, failure);
      throw rpcBusinessError("preferences-failed", "Preferences failed.", {});
    },
  });
  const response = routes.handle(
    rpcRequest("workbenchSettings.describe", {}),
    "workbenchSettings.describe",
  );

  assert.ok(response);
  const body = (await (await response).json()) as ServerResponse<never>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected a projected Workbench Settings failure.");
  assert.equal(body.result.error.code, "preferences-failed");
});
