import assert from "node:assert/strict";
import test from "node:test";

import type { RpcIssue, ServerResponse } from "@/runtime/pi/contracts/rpc";
import type { PackageCatalogProtocol } from "../../packages/package-catalog-service";
import { rpcBusinessError } from "../rpc-transport";
import { createPackageCatalogRpcRoutes } from "./package-catalog-rpc-routes";

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

function protocol(overrides: Partial<PackageCatalogProtocol>): PackageCatalogProtocol {
  return new Proxy(overrides, {
    get(target, property, receiver) {
      const implementation = Reflect.get(target, property, receiver);
      if (implementation !== undefined) return implementation;
      return async () => {
        throw new Error(`Unexpected Package Catalog protocol call: ${String(property)}`);
      };
    },
  }) as PackageCatalogProtocol;
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

test("claims only the Package Catalog RPC subdomain", async () => {
  const routes = createPackageCatalogRpcRoutes({
    service: protocol({ describe: async () => ({ name: "pi-tools", types: [] }) }),
    projectDomainError: unexpectedDomainError,
  });
  const claimed = routes.handle(
    rpcRequest("packageCatalog.describe", { name: "pi-tools" }),
    "packageCatalog.describe",
  );

  assert.ok(claimed);
  assert.deepEqual(await successValue(await claimed), { name: "pi-tools", types: [] });
  for (const method of ["extension.list", "package.list", "packageCatalog.unknown", "skill.list"]) {
    assert.equal(routes.handle(rpcRequest(method, {}), method), undefined);
  }
});

test("maps both Catalog methods to sanitized inputs and preserves each request signal", async () => {
  const calls: Array<{
    operation: PropertyKey;
    payload: unknown;
    signal: AbortSignal | undefined;
  }> = [];
  const service = new Proxy(
    {},
    {
      get(_target, operation) {
        return async (payload: unknown, signal?: AbortSignal) => {
          calls.push({ operation, payload, signal });
          return {};
        };
      },
    },
  ) as PackageCatalogProtocol;
  const routes = createPackageCatalogRpcRoutes({
    service,
    projectDomainError: unexpectedDomainError,
  });
  const requests = [
    rpcRequest("packageCatalog.search", {
      query: "  review  ",
      type: "extension",
      sort: "downloads",
      page: 2,
      ignored: true,
    }),
    rpcRequest("packageCatalog.describe", { name: "  @scope/pi-tools  ", ignored: true }),
  ];

  for (const [index, method] of ["packageCatalog.search", "packageCatalog.describe"].entries()) {
    const request = requests[index];
    assert.ok(request);
    const response = routes.handle(request, method);
    assert.ok(response);
    await successValue(await response);
  }
  assert.deepEqual(
    calls.map(({ operation, payload }) => ({ operation, payload })),
    [
      {
        operation: "search",
        payload: { query: "review", type: "extension", sort: "downloads", page: 2 },
      },
      { operation: "describe", payload: { name: "@scope/pi-tools" } },
    ],
  );
  assert.equal(calls[0]?.signal, requests[0]?.signal);
  assert.equal(calls[1]?.signal, requests[1]?.signal);
});

test("validates Package Catalog payloads before invoking the protocol", async () => {
  let calls = 0;
  const routes = createPackageCatalogRpcRoutes({
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
    ) as PackageCatalogProtocol,
    projectDomainError: unexpectedDomainError,
  });

  for (const [method, payload] of [
    ["packageCatalog.search", { type: "plugin", page: 0 }],
    ["packageCatalog.search", { query: "x".repeat(201), sort: "popular" }],
    ["packageCatalog.describe", { name: "https://example.com/pi-tools" }],
    ["packageCatalog.describe", { name: "x".repeat(215) }],
  ] as const) {
    const response = routes.handle(rpcRequest(method, payload), method);
    assert.ok(response);
    const body = (await (await response).json()) as ServerResponse<never, { issues: RpcIssue[] }>;
    assert.equal(body.result.ok, false);
    if (body.result.ok) assert.fail("Expected a Package Catalog validation failure.");
    assert.equal(body.result.error.code, "bad-request");
  }
  assert.equal(calls, 0);
});

test("allows Package Catalog reads from configured trusted hosts", async (t) => {
  const previousTrustedHosts = process.env.PI_WORKBENCH_TRUSTED_HOSTS;
  process.env.PI_WORKBENCH_TRUSTED_HOSTS = "workbench.example:3080";
  t.after(() => {
    if (previousTrustedHosts === undefined) delete process.env.PI_WORKBENCH_TRUSTED_HOSTS;
    else process.env.PI_WORKBENCH_TRUSTED_HOSTS = previousTrustedHosts;
  });
  const routes = createPackageCatalogRpcRoutes({
    service: protocol({ describe: async () => ({ name: "pi-tools", types: [] }) }),
    projectDomainError: unexpectedDomainError,
  });
  const response = routes.handle(
    rpcRequest(
      "packageCatalog.describe",
      { name: "pi-tools" },
      {
        host: "workbench.example:3080",
        origin: "http://workbench.example:3080",
      },
    ),
    "packageCatalog.describe",
  );

  assert.ok(response);
  assert.deepEqual(await successValue(await response), { name: "pi-tools", types: [] });
});

test("delegates Package Catalog failures to the shared error projector", async () => {
  const failure = new Error("catalog failed");
  const routes = createPackageCatalogRpcRoutes({
    service: protocol({
      async search() {
        throw failure;
      },
    }),
    projectDomainError(error): never {
      assert.equal(error, failure);
      throw rpcBusinessError("catalog-failed", "Catalog failed.", { operation: "search" });
    },
  });
  const response = routes.handle(rpcRequest("packageCatalog.search", {}), "packageCatalog.search");

  assert.ok(response);
  const body = (await (await response).json()) as ServerResponse<never>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected a projected Package Catalog failure.");
  assert.equal(body.result.error.code, "catalog-failed");
  assert.deepEqual(body.result.error.details, { operation: "search" });
});
