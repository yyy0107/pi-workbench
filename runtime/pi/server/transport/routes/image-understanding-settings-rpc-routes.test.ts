import assert from "node:assert/strict";
import test from "node:test";

import type { ServerResponse } from "@/runtime/pi/contracts/rpc";
import type { ImageUnderstandingSettingsProtocol } from "../../attachment-understanding/settings-store";
import { rpcBusinessError } from "../rpc-transport";
import { createImageUnderstandingSettingsRpcRoutes } from "./image-understanding-settings-rpc-routes";

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
  overrides: Partial<ImageUnderstandingSettingsProtocol>,
): ImageUnderstandingSettingsProtocol {
  return new Proxy(overrides, {
    get(target, property, receiver) {
      const implementation = Reflect.get(target, property, receiver);
      if (implementation !== undefined) return implementation;
      return async () => {
        throw new Error(`Unexpected Image Understanding protocol call: ${String(property)}`);
      };
    },
  }) as ImageUnderstandingSettingsProtocol;
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

test("claims only the Image Understanding Settings RPC subdomain", async () => {
  const routes = createImageUnderstandingSettingsRpcRoutes({
    getStore: () => protocol({ describe: async () => ({ revision: 0 }) as never }),
    projectDomainError: unexpectedDomainError,
  });
  const claimed = routes.handle(
    rpcRequest("imageUnderstanding.describe", {}),
    "imageUnderstanding.describe",
  );

  assert.ok(claimed);
  assert.deepEqual(await successValue(await claimed), { revision: 0 });
  for (const method of [
    "imageUnderstanding.unknown",
    "settings.describe",
    "workbenchSettings.describe",
  ]) {
    assert.equal(routes.handle(rpcRequest(method, {}), method), undefined);
  }
});

test("resolves the settings store per call and sanitizes Image Understanding updates", async () => {
  const calls: unknown[] = [];
  let resolutions = 0;
  const store = protocol({
    async describe() {
      calls.push("describe");
      return { revision: 0 } as never;
    },
    async update(payload) {
      calls.push(payload);
      return { revision: 1 } as never;
    },
  });
  const routes = createImageUnderstandingSettingsRpcRoutes({
    getStore() {
      resolutions += 1;
      return store;
    },
    projectDomainError: unexpectedDomainError,
  });
  const describe = routes.handle(
    rpcRequest("imageUnderstanding.describe", { ignored: true }),
    "imageUnderstanding.describe",
  );
  assert.ok(describe);
  await successValue(await describe);

  const update = routes.handle(
    rpcRequest("imageUnderstanding.update", {
      expectedRevision: 3,
      patch: {
        routing: "always-preprocess",
        engine: "ocr",
        ocrProvider: "glm-ocr",
        glm: {
          endpoint: "https://ocr.example/layout",
          model: "glm-ocr",
          apiKey: "secret",
          ignored: true,
        },
        ocrAdapter: {
          preset: "custom",
          source: "export default defineOcrAdapter({});",
          endpoint: "https://ocr.example/layout",
          model: "custom-ocr",
          apiKey: null,
          pollIntervalMs: 1_000,
          pollTimeoutMs: 60_000,
          ignored: true,
        },
        ignored: true,
      },
      ignored: true,
    }),
    "imageUnderstanding.update",
  );
  assert.ok(update);
  await successValue(await update);

  assert.equal(resolutions, 2);
  assert.deepEqual(calls, [
    "describe",
    {
      expectedRevision: 3,
      patch: {
        routing: "always-preprocess",
        engine: "ocr",
        ocrProvider: "glm-ocr",
        glm: {
          endpoint: "https://ocr.example/layout",
          model: "glm-ocr",
          apiKey: "secret",
        },
        ocrAdapter: {
          preset: "custom",
          source: "export default defineOcrAdapter({});",
          endpoint: "https://ocr.example/layout",
          model: "custom-ocr",
          apiKey: null,
          pollIntervalMs: 1_000,
          pollTimeoutMs: 60_000,
        },
      },
    },
  ]);
});

test("validates Image Understanding patches before resolving a store", async () => {
  let resolutions = 0;
  const routes = createImageUnderstandingSettingsRpcRoutes({
    getStore() {
      resolutions += 1;
      return protocol({});
    },
    projectDomainError: unexpectedDomainError,
  });

  for (const payload of [
    {},
    { expectedRevision: -1, patch: {} },
    { patch: { routing: "manual" } },
    { patch: { engine: "vision" } },
    { patch: { paddle: { pollIntervalMs: 99 } } },
    { patch: { paddle: { pollTimeoutMs: 3_600_001 } } },
    { patch: { ocrAdapter: { preset: "unknown" } } },
    { patch: { glm: { apiKey: 1 } } },
  ]) {
    const response = routes.handle(
      rpcRequest("imageUnderstanding.update", payload),
      "imageUnderstanding.update",
    );
    assert.ok(response);
    const body = (await (await response).json()) as ServerResponse<never>;
    assert.equal(body.result.ok, false);
    if (body.result.ok) assert.fail("Expected an Image Understanding validation failure.");
    assert.equal(body.result.error.code, "bad-request");
  }
  assert.equal(resolutions, 0);
});

test("keeps both Image Understanding Settings methods loopback-only", async (t) => {
  const previousTrustedHosts = process.env.PI_WORKBENCH_TRUSTED_HOSTS;
  process.env.PI_WORKBENCH_TRUSTED_HOSTS = "workbench.example:3080";
  t.after(() => {
    if (previousTrustedHosts === undefined) delete process.env.PI_WORKBENCH_TRUSTED_HOSTS;
    else process.env.PI_WORKBENCH_TRUSTED_HOSTS = previousTrustedHosts;
  });
  let resolutions = 0;
  const routes = createImageUnderstandingSettingsRpcRoutes({
    getStore() {
      resolutions += 1;
      return protocol({});
    },
    projectDomainError: unexpectedDomainError,
  });
  const options = {
    host: "workbench.example:3080",
    origin: "http://workbench.example:3080",
  };

  for (const [method, payload] of [
    ["imageUnderstanding.describe", {}],
    ["imageUnderstanding.update", { patch: {} }],
  ] as const) {
    const response = routes.handle(rpcRequest(method, payload, options), method);
    assert.ok(response);
    assert.equal((await response).status, 403);
  }
  assert.equal(resolutions, 0);
});

test("delegates Image Understanding failures to the shared error projector", async () => {
  const failure = new Error("image settings failed");
  const routes = createImageUnderstandingSettingsRpcRoutes({
    getStore: () =>
      protocol({
        async describe() {
          throw failure;
        },
      }),
    projectDomainError(error): never {
      assert.equal(error, failure);
      throw rpcBusinessError("image-settings-failed", "Image settings failed.", {});
    },
  });
  const response = routes.handle(
    rpcRequest("imageUnderstanding.describe", {}),
    "imageUnderstanding.describe",
  );

  assert.ok(response);
  const body = (await (await response).json()) as ServerResponse<never>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected a projected Image Understanding failure.");
  assert.equal(body.result.error.code, "image-settings-failed");
});
