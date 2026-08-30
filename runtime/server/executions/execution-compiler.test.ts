import assert from "node:assert/strict";
import test from "node:test";

import type { FlowNode, WorkflowDocument } from "@workbench/execution-contracts";
import { parseExecutionDocument } from "@workbench/execution-contracts/schema";
import { compileExecutionDocument, validateExecutionDocument } from "./execution-compiler";

function node(id: string, type: FlowNode["type"]): FlowNode {
  const base = { id, name: id, position: { x: 0, y: 0 } };
  switch (type) {
    case "start":
      return { ...base, type, config: {} };
    case "end":
      return { ...base, type, config: {} };
    case "agent":
      return {
        ...base,
        type,
        config: { agentId: `agent-${id}`, promptTemplate: "default", output: { schema: {} } },
      };
    case "command":
      return { ...base, type, config: { command: "true" } };
    case "condition":
      return {
        ...base,
        type,
        config: { binding: { source: "run-input", path: "/ok" }, operator: "equals", value: true },
      };
    case "approval":
      return { ...base, type, config: { message: "Approve?" } };
  }
}

function document(): WorkflowDocument {
  return {
    schemaVersion: 3,
    id: "flow-1",
    kind: "workflow",
    scope: { type: "personal" },
    name: "Flow",
    agents: [{ id: "agent-left", name: "Reviewer" }],
    graph: {
      nodes: [
        node("start", "start"),
        node("condition", "condition"),
        node("left", "agent"),
        node("right", "command"),
        node("end", "end"),
      ],
      edges: [
        { id: "a", source: "start", target: "condition" },
        { id: "b", source: "condition", sourceHandle: "true", target: "left" },
        { id: "c", source: "condition", sourceHandle: "false", target: "right" },
        { id: "d", source: "left", target: "end" },
        { id: "e", source: "right", target: "end" },
      ],
      editor: { viewport: { x: 100, y: 20, zoom: 1.2 } },
    },
    concurrency: { mode: "queue" },
    draftRevision: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

test("compiles a condition fan-out and fan-in DAG without editor viewport semantics", () => {
  const plan = compileExecutionDocument(document(), 100);
  assert.deepEqual(plan.topologicalOrder, ["start", "condition", "left", "right", "end"]);
  assert.equal(plan.incoming.get("end")?.length, 2);
  assert.deepEqual(plan.revision.graph.editor, {});
  assert.deepEqual(plan.revision.graph.nodes[0]?.position, { x: 0, y: 0 });
});

test("rejects cycles and dangling edges", () => {
  const value = document();
  value.graph.edges.push({ id: "cycle", source: "end", target: "start" });
  value.graph.edges.push({ id: "dangling", source: "missing", target: "end" });
  const result = validateExecutionDocument(value);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(({ code }) => code === "cycle"));
  assert.ok(result.issues.some(({ code }) => code === "dangling-edge"));
});

test("persists incomplete drafts but rejects them at publish validation", () => {
  const value = document();
  value.agents[0]!.name = "";
  assert.doesNotThrow(() => parseExecutionDocument(value));
  const result = validateExecutionDocument(value);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(({ code }) => code === "invalid-node-config"));
});

test("accepts stable Agent references and output contracts", () => {
  const value = document();
  const agent = value.graph.nodes.find(({ type }) => type === "agent");
  assert.ok(agent?.type === "agent");
  agent.config.output.schema = {
    type: "object",
    properties: { verdict: { type: "string" } },
    required: ["verdict"],
  };
  const parsed = parseExecutionDocument(value);
  const parsedAgent = parsed.graph.nodes.find(({ type }) => type === "agent");
  assert.ok(parsedAgent?.type === "agent");
  assert.equal(parsedAgent.config.agentId, "agent-left");
  assert.deepEqual(parsedAgent.config.output.schema, agent.config.output.schema);
});

test("rejects an Agent node that references a missing workflow Agent", () => {
  const value = document();
  value.agents = [];
  const result = validateExecutionDocument(value);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(({ code }) => code === "invalid-node-config"));
});

test("migrates v2 workflows by discarding their retired trigger definitions", () => {
  const legacy = {
    ...document(),
    schemaVersion: 2,
    triggers: [
      {
        id: "schedule",
        type: "schedule",
        name: "Schedule",
        cron: "0 9 * * 1-5",
        timezone: "America/Los_Angeles",
      },
    ],
  };

  const parsed = parseExecutionDocument(legacy);
  assert.equal(parsed.schemaVersion, 3);
  assert.equal("triggers" in parsed, false);
  assert.doesNotThrow(() => compileExecutionDocument(parsed));
});
