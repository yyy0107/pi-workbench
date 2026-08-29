import assert from "node:assert/strict";
import test from "node:test";

import {
  MIN_SCHEDULE_RUN_DURATION_SECONDS,
  type FlowNode,
  type WorkflowDocument,
} from "@/runtime/shared/execution";
import { compileExecutionDocument, validateExecutionDocument } from "./execution-compiler";
import { parseExecutionDocument } from "./execution-schema";

function node(id: string, type: FlowNode["type"]): FlowNode {
  const base = { id, name: id, position: { x: 0, y: 0 } };
  switch (type) {
    case "start":
      return { ...base, type, config: {} };
    case "end":
      return { ...base, type, config: {} };
    case "agent":
      return { ...base, type, config: { prompt: "Review" } };
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

function document(kind: WorkflowDocument["kind"] = "workflow"): WorkflowDocument {
  return {
    schemaVersion: 1,
    id: "flow-1",
    kind,
    scope: { type: "personal" },
    name: "Flow",
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
    triggers: [],
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

test("rejects branching and Condition nodes in SOP documents", () => {
  const value = document("sop");
  const result = validateExecutionDocument(value);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(({ code }) => code === "invalid-sop"));
});

test("persists incomplete drafts but rejects them at publish validation", () => {
  const value = document();
  const agent = value.graph.nodes.find(({ type }) => type === "agent");
  assert.ok(agent?.type === "agent");
  agent.config.prompt = "";
  assert.doesNotThrow(() => parseExecutionDocument(value));
  const result = validateExecutionDocument(value);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(({ code }) => code === "invalid-node-config"));
});

test("accepts a stable Agent model and thinking selection", () => {
  const value = document();
  const agent = value.graph.nodes.find(({ type }) => type === "agent");
  assert.ok(agent?.type === "agent");
  agent.config.model = {
    provider: "openai",
    modelId: "gpt-5",
    thinkingLevel: "high",
  };
  const parsed = parseExecutionDocument(value);
  const parsedAgent = parsed.graph.nodes.find(({ type }) => type === "agent");
  assert.ok(parsedAgent?.type === "agent");
  assert.deepEqual(parsedAgent.config.model, agent.config.model);
});

test("accepts an optional scheduled-run duration and rejects values below the minimum", () => {
  const value = document();
  value.triggers = [
    {
      id: "schedule",
      type: "schedule",
      name: "Schedule",
      cron: "0 9 * * *",
      timezone: "UTC",
      maxRunDurationSeconds: MIN_SCHEDULE_RUN_DURATION_SECONDS,
    },
  ];
  const parsedTrigger = parseExecutionDocument(value).triggers[0];
  assert.ok(parsedTrigger?.type === "schedule");
  assert.equal(parsedTrigger.maxRunDurationSeconds, MIN_SCHEDULE_RUN_DURATION_SECONDS);

  const invalid = structuredClone(value);
  const trigger = invalid.triggers[0];
  assert.ok(trigger?.type === "schedule");
  trigger.maxRunDurationSeconds = MIN_SCHEDULE_RUN_DURATION_SECONDS - 1;
  assert.throws(() => parseExecutionDocument(invalid));

  const validTrigger = value.triggers[0];
  assert.ok(validTrigger?.type === "schedule");
  delete validTrigger.maxRunDurationSeconds;
  assert.doesNotThrow(() => parseExecutionDocument(value));
});
