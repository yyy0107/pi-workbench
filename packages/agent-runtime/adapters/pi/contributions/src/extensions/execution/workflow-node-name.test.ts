import assert from "node:assert/strict";
import test from "node:test";

import { nextWorkflowNodeName } from "./workflow-node-name";

test("numbers each workflow node type independently from one", () => {
  const nodes = [
    { type: "agent", name: "Agent 1" },
    { type: "command", name: "Command 1" },
  ] as const;

  assert.equal(nextWorkflowNodeName([], "agent", "Agent"), "Agent 1");
  assert.equal(nextWorkflowNodeName(nodes, "agent", "Agent"), "Agent 2");
  assert.equal(nextWorkflowNodeName(nodes, "command", "Command"), "Command 2");
  assert.equal(nextWorkflowNodeName(nodes, "approval", "Approval"), "Approval 1");
});

test("continues after the highest generated name instead of reusing a visible id", () => {
  const nodes = [
    { type: "agent", name: "Research" },
    { type: "agent", name: "Agent 4" },
  ] as const;

  assert.equal(nextWorkflowNodeName(nodes, "agent", "Agent"), "Agent 5");
});

test("counts renamed and legacy nodes when no generated suffix is available", () => {
  const nodes = [
    { type: "command", name: "Command" },
    { type: "command", name: "Build project" },
  ] as const;

  assert.equal(nextWorkflowNodeName(nodes, "command", "Command"), "Command 3");
  assert.equal(nextWorkflowNodeName(nodes, "command", "命令"), "命令 3");
});
