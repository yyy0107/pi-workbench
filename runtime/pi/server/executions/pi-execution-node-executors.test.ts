import assert from "node:assert/strict";
import test from "node:test";

import type { AgentNode } from "@/runtime/shared/execution";
import { resolveAgentModelSelection } from "./pi-execution-node-executors";

function agent(model?: AgentNode["config"]["model"]): AgentNode {
  return {
    id: "agent",
    type: "agent",
    name: "Agent",
    position: { x: 0, y: 0 },
    config: { prompt: "Review", ...(model ? { model } : {}) },
  };
}

test("resolves the configured execution model without mutating runtime defaults", () => {
  const selected = { provider: "openai", id: "gpt-5" };
  const result = resolveAgentModelSelection(
    agent({ provider: "openai", modelId: "gpt-5", thinkingLevel: "high" }),
    [{ provider: "anthropic", id: "claude" }, selected],
  );
  assert.equal(result.model, selected);
  assert.equal(result.thinkingLevel, "high");
});

test("rejects a configured execution model that is unavailable in the target workspace", () => {
  assert.throws(
    () =>
      resolveAgentModelSelection(agent({ provider: "openai", modelId: "missing" }), [
        { provider: "openai", id: "gpt-5" },
      ]),
    (error: unknown) =>
      error instanceof Error &&
      (error as Error & { code?: string }).code === "agent-model-unavailable",
  );
});
