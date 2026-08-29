import assert from "node:assert/strict";
import test from "node:test";

import { SUPPORTED_LOCALES, type Locale } from "@/contracts/locale";
import type { ServerResponse } from "@/runtime/pi/contracts/rpc";
import type { WorkbenchSettingsProtocol } from "../../settings/workbench-settings-service";
import { rpcBusinessError } from "../rpc-transport";
import { createWorkbenchSettingsRpcRoutes } from "./workbench-settings-rpc-routes";

function rpcRequest(
  method: string,
  payload: unknown,
  options: { host?: string; origin?: string; rpcId?: string; signal?: AbortSignal } = {},
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
    ...(options.signal === undefined ? {} : { signal: options.signal }),
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
const openDocument = async () => ({ opened: true as const });

test("claims only the Workbench Settings RPC subdomain", async () => {
  const routes = createWorkbenchSettingsRpcRoutes({
    getService: () => protocol({ describe: async () => ({ revision: 0, preferences: {} }) }),
    openDocument,
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
    openDocument,
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
        hardwareAcceleration: false,
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
        hardwareAcceleration: false,
        locale: "zh-CN",
        sidebarThreadSortMode: "manual",
        toolboxPins: ["skills", "packages"],
        toolboxScope: { kind: "project", workspaceId: "workspace-1" },
        sidebarOpen: false,
      },
    },
  ]);
});

test("prepares and opens the Workbench settings document with the request signal", async () => {
  const calls: unknown[] = [];
  let openedSignal: AbortSignal | undefined;
  const controller = new AbortController();
  const routes = createWorkbenchSettingsRpcRoutes({
    getService: () =>
      protocol({
        async prepareDocument() {
          calls.push("prepareDocument");
          return "/tmp/workbench-settings.json";
        },
      }),
    async openDocument(path, signal) {
      calls.push({ path });
      openedSignal = signal;
      return { opened: true };
    },
    projectDomainError: unexpectedDomainError,
  });
  const response = routes.handle(
    rpcRequest("workbenchSettings.openDocument", { ignored: true }, { signal: controller.signal }),
    "workbenchSettings.openDocument",
  );

  assert.ok(response);
  assert.deepEqual(await successValue(await response), { opened: true });
  assert.deepEqual(calls, ["prepareDocument", { path: "/tmp/workbench-settings.json" }]);
  assert.equal(openedSignal?.aborted, false);
  controller.abort();
  assert.equal(openedSignal?.aborted, true);
});

test("accepts every locale from the shared contract", async () => {
  const received: Locale[] = [];
  const routes = createWorkbenchSettingsRpcRoutes({
    getService: () =>
      protocol({
        async update(payload) {
          const locale = payload.patch.locale;
          if (locale) received.push(locale);
          return { revision: received.length };
        },
      }),
    openDocument,
    projectDomainError: unexpectedDomainError,
  });

  for (const locale of SUPPORTED_LOCALES) {
    const response = routes.handle(
      rpcRequest("workbenchSettings.update", { patch: { locale } }),
      "workbenchSettings.update",
    );
    assert.ok(response);
    await successValue(await response);
  }

  assert.deepEqual(received, [...SUPPORTED_LOCALES]);
});

test("validates Workbench Settings patches before resolving a service", async () => {
  let resolutions = 0;
  const routes = createWorkbenchSettingsRpcRoutes({
    getService() {
      resolutions += 1;
      return protocol({});
    },
    openDocument,
    projectDomainError: unexpectedDomainError,
  });

  for (const payload of [
    {},
    { patch: { locale: "en" } },
    { patch: { hardwareAcceleration: "false" } },
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
    openDocument,
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
    openDocument,
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
  const openResponse = routes.handle(
    rpcRequest("workbenchSettings.openDocument", {}, options),
    "workbenchSettings.openDocument",
  );
  assert.ok(openResponse);
  assert.equal((await openResponse).status, 403);
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
    openDocument,
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
