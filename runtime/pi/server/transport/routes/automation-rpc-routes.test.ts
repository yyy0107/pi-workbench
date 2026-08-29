import assert from "node:assert/strict";
import test from "node:test";

import type { ServerResponse } from "@/runtime/pi/contracts/rpc";
import type {
  AutomationProtocol,
  AutomationRemoveSessionPayload,
  AutomationRunNowPayload,
} from "@/runtime/shared/automation";
import { createAutomationRpcRoutes } from "./automation-rpc-routes";

function request(method: string, payload: unknown): Request {
  return new Request(`http://127.0.0.1:3000/api/${method}`, {
    method: "POST",
    headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
    body: JSON.stringify({ type: "client-request", rpcId: "automation-rpc", method, payload }),
  });
}

test("automation.runNow returns a normal session id through its own RPC namespace", async () => {
  const calls: unknown[] = [];
  const service = {
    async runNow(payload: AutomationRunNowPayload) {
      calls.push(payload);
      return {
        automationId: payload.automationId,
        sessionId: "session-1",
        source: "manual" as const,
        triggeredAt: 123,
      };
    },
  } as unknown as AutomationProtocol;
  const routes = createAutomationRpcRoutes({
    service,
    projectDomainError(error): never {
      throw error;
    },
  });

  const response = routes.handle(
    request("automation.runNow", { automationId: "automation-1", ignored: true }),
    "automation.runNow",
  );
  assert.ok(response);
  const resolved = await response;
  assert.equal(resolved.status, 200);
  const body = (await resolved.json()) as ServerResponse<unknown>;
  assert.deepEqual(calls, [{ automationId: "automation-1" }]);
  assert.deepEqual(body, {
    type: "server-response",
    rpcId: "automation-rpc",
    result: {
      ok: true,
      value: {
        automationId: "automation-1",
        sessionId: "session-1",
        source: "manual",
        triggeredAt: 123,
      },
    },
  });
});

test("automation.save rejects the obsolete Pi-internal model selection shape", async () => {
  let calls = 0;
  const service = {
    async save() {
      calls += 1;
      throw new Error("should not be called");
    },
  } as unknown as AutomationProtocol;
  const routes = createAutomationRpcRoutes({
    service,
    projectDomainError(error): never {
      throw error;
    },
  });
  const response = routes.handle(
    request("automation.save", {
      name: "Task",
      prompt: "Do it",
      workspaceId: "workspace-1",
      model: { provider: "openai", modelId: "gpt-5", thinkingLevel: "invented" },
      schedule: { cron: "0 9 * * *", timezone: "UTC" },
      enabled: true,
    }),
    "automation.save",
  );
  assert.ok(response);
  const body = (await (await response).json()) as ServerResponse<unknown>;
  assert.equal(body.result.ok, false);
  assert.equal(calls, 0);
});

test("automation.save accepts the shared Composer model selection shape", async () => {
  const calls: unknown[] = [];
  const service = {
    async save(payload: unknown) {
      calls.push(payload);
      return {};
    },
  } as unknown as AutomationProtocol;
  const routes = createAutomationRpcRoutes({
    service,
    projectDomainError(error): never {
      throw error;
    },
  });
  const payload = {
    name: "Task",
    prompt: "Do it",
    workspaceId: "workspace-1",
    model: { provider: "openai", model: "gpt-5", reasoningEffort: "provider-native" },
    schedule: { cron: "0 9 * * *", timezone: "UTC" },
    enabled: true,
  };
  const response = routes.handle(request("automation.save", payload), "automation.save");
  assert.ok(response);
  const body = (await (await response).json()) as ServerResponse<unknown>;
  assert.equal(body.result.ok, true);
  assert.deepEqual(calls, [payload]);
});

test("automation.removeSession removes only the requested history reference", async () => {
  const calls: unknown[] = [];
  const service = {
    async removeSession(payload: AutomationRemoveSessionPayload) {
      calls.push(payload);
      return { ...payload, removed: true };
    },
  } as unknown as AutomationProtocol;
  const routes = createAutomationRpcRoutes({
    service,
    projectDomainError(error): never {
      throw error;
    },
  });
  const response = routes.handle(
    request("automation.removeSession", {
      automationId: "automation-1",
      sessionId: "session-1",
      ignored: true,
    }),
    "automation.removeSession",
  );
  assert.ok(response);
  const body = (await (await response).json()) as ServerResponse<unknown>;
  assert.equal(body.result.ok, true);
  assert.deepEqual(calls, [{ automationId: "automation-1", sessionId: "session-1" }]);
  assert.deepEqual(body, {
    type: "server-response",
    rpcId: "automation-rpc",
    result: {
      ok: true,
      value: { automationId: "automation-1", sessionId: "session-1", removed: true },
    },
  });
});
