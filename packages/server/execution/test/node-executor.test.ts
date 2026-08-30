import assert from "node:assert/strict";
import test from "node:test";

import {
  type ExecutionNodeExecutor,
  ExecutionNodeExecutorRegistry,
} from "@workbench/execution-server/node-executor";

const first: ExecutionNodeExecutor = {
  async execute() {
    return { output: "first" };
  },
};
const second: ExecutionNodeExecutor = {
  async execute() {
    return { output: "second" };
  },
};

test("constructs a registry from the supported node-type map", () => {
  const registry = new ExecutionNodeExecutorRegistry({ agent: first, command: second });

  assert.equal(registry.get("agent"), first);
  assert.equal(registry.get("command"), second);
  assert.equal(registry.get("approval"), undefined);
});

test("an unregister callback removes only the executor it registered", () => {
  const registry = new ExecutionNodeExecutorRegistry();
  const unregisterFirst = registry.register("agent", first);
  const unregisterSecond = registry.register("agent", second);

  unregisterFirst();
  assert.equal(registry.get("agent"), second);

  unregisterSecond();
  assert.equal(registry.get("agent"), undefined);
});
