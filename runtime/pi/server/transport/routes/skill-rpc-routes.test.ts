import assert from "node:assert/strict";
import test from "node:test";

import type { RpcIssue, ServerResponse } from "@/runtime/pi/contracts/rpc";
import type { SkillProtocol } from "../../skills/skill-service";
import { rpcBusinessError } from "../rpc-transport";
import { createSkillRpcRoutes } from "./skill-rpc-routes";

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

function protocol(overrides: Partial<SkillProtocol>): SkillProtocol {
  return new Proxy(overrides, {
    get(target, property, receiver) {
      const implementation = Reflect.get(target, property, receiver);
      if (implementation !== undefined) return implementation;
      return async () => {
        throw new Error(`Unexpected Skill protocol call: ${String(property)}`);
      };
    },
  }) as SkillProtocol;
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

test("claims only the Skill RPC subdomain", async () => {
  const routes = createSkillRpcRoutes({
    service: protocol({ list: async () => ({ skills: [] }) }),
    projectDomainError: unexpectedDomainError,
  });
  const claimed = routes.handle(
    rpcRequest("skill.list", { sessionId: "session-1", ignored: true }),
    "skill.list",
  );

  assert.ok(claimed);
  assert.deepEqual(await successValue(await claimed), { skills: [] });
  for (const method of [
    "command.list",
    "extension.list",
    "package.list",
    "skill.unknown",
    "workspace.list",
  ]) {
    assert.equal(routes.handle(rpcRequest(method, {}), method), undefined);
  }
});

test("maps all six Skill methods to sanitized protocol inputs", async () => {
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
  ) as SkillProtocol;
  const routes = createSkillRpcRoutes({
    service,
    projectDomainError: unexpectedDomainError,
  });
  const cases = [
    {
      method: "skill.list",
      payload: { sessionId: "session-1", ignored: true },
      operation: "list",
      expectedPayload: { sessionId: "session-1" },
    },
    {
      method: "skill.describe",
      payload: { target: { scope: "user", ignored: true }, name: "  review  ", ignored: true },
      operation: "describe",
      expectedPayload: { target: { scope: "user" }, name: "review" },
    },
    {
      method: "skill.setEnabled",
      payload: {
        target: { scope: "project", workspaceId: "workspace-1", ignored: true },
        name: "review",
        enabled: false,
        ignored: true,
      },
      operation: "setEnabled",
      expectedPayload: {
        target: { scope: "project", workspaceId: "workspace-1" },
        name: "review",
        enabled: false,
      },
    },
    {
      method: "skill.remove",
      payload: { sessionId: "session-1", name: "review", ignored: true },
      operation: "remove",
      expectedPayload: { sessionId: "session-1", name: "review" },
    },
    {
      method: "skill.files.list",
      payload: {
        target: { scope: "project", workspaceId: "workspace-1" },
        name: "review",
        relativePath: "references",
        ignored: true,
      },
      operation: "listFiles",
      expectedPayload: {
        target: { scope: "project", workspaceId: "workspace-1" },
        name: "review",
        relativePath: "references",
      },
    },
    {
      method: "skill.files.read",
      payload: {
        sessionId: "session-1",
        name: "review",
        relativePath: "references/guide.md",
        ignored: true,
      },
      operation: "readFile",
      expectedPayload: {
        sessionId: "session-1",
        name: "review",
        relativePath: "references/guide.md",
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

test("validates Skill identities and bounded fields before invoking the protocol", async () => {
  let calls = 0;
  const routes = createSkillRpcRoutes({
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
    ) as SkillProtocol,
    projectDomainError: unexpectedDomainError,
  });
  const cases = [
    ["skill.list", {}],
    ["skill.list", { sessionId: "" }],
    ["skill.list", { sessionId: "session-1", target: { scope: "user" } }],
    ["skill.list", { target: { scope: "project", workspaceId: "" } }],
    ["skill.describe", { sessionId: "session-1", name: "   " }],
    ["skill.describe", { sessionId: "session-1", name: "x".repeat(513) }],
    ["skill.setEnabled", { sessionId: "session-1", name: "review", enabled: "false" }],
    [
      "skill.files.list",
      { sessionId: "session-1", name: "review", relativePath: "x".repeat(16_385) },
    ],
    ["skill.files.read", { sessionId: "session-1", name: "review", relativePath: "" }],
  ] as const;

  for (const [method, payload] of cases) {
    const response = routes.handle(rpcRequest(method, payload), method);
    assert.ok(response);
    const body = (await (await response).json()) as ServerResponse<never, { issues: RpcIssue[] }>;
    assert.equal(body.result.ok, false);
    if (body.result.ok) assert.fail("Expected a Skill validation failure.");
    assert.equal(body.result.error.code, "bad-request");
  }
  assert.equal(calls, 0);
});

test("keeps Skill mutations loopback-only while allowing reads from trusted hosts", async (t) => {
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
  ) as SkillProtocol;
  const routes = createSkillRpcRoutes({ service, projectDomainError: unexpectedDomainError });
  const options = {
    host: "workbench.example:3080",
    origin: "http://workbench.example:3080",
  };

  for (const [method, payload] of [
    ["skill.setEnabled", { target: { scope: "user" }, name: "review", enabled: false }],
    ["skill.remove", { target: { scope: "user" }, name: "review" }],
  ] as const) {
    const response = routes.handle(rpcRequest(method, payload, options), method);
    assert.ok(response);
    assert.equal((await response).status, 403);
  }
  assert.deepEqual(calls, []);

  for (const [method, payload, operation] of [
    ["skill.list", { target: { scope: "user" } }, "list"],
    ["skill.describe", { target: { scope: "user" }, name: "review" }, "describe"],
    ["skill.files.list", { target: { scope: "user" }, name: "review" }, "listFiles"],
    [
      "skill.files.read",
      { target: { scope: "user" }, name: "review", relativePath: "SKILL.md" },
      "readFile",
    ],
  ] as const) {
    const response = routes.handle(rpcRequest(method, payload, options), method);
    assert.ok(response);
    await successValue(await response);
    assert.equal(calls.at(-1), operation);
  }
  assert.deepEqual(calls, ["list", "describe", "listFiles", "readFile"]);
});

test("delegates Skill domain failures to the shared error projector", async () => {
  const failure = new Error("skill failed");
  const routes = createSkillRpcRoutes({
    service: protocol({
      async describe() {
        throw failure;
      },
    }),
    projectDomainError(error): never {
      assert.equal(error, failure);
      throw rpcBusinessError("skill-failed", "Skill failed.", { operation: "describe" });
    },
  });
  const response = routes.handle(
    rpcRequest("skill.describe", { sessionId: "session-1", name: "review" }),
    "skill.describe",
  );

  assert.ok(response);
  const body = (await (await response).json()) as ServerResponse<never>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected a projected Skill failure.");
  assert.equal(body.result.error.code, "skill-failed");
  assert.deepEqual(body.result.error.details, { operation: "describe" });
});
