import assert from "node:assert/strict";
import test from "node:test";

import type { WorkflowDocument } from "@workbench/execution-contracts";
import {
  assertExecutionJsonValue,
  parseExecutionDocument,
  parseExecutionDocumentWithMigration,
} from "@workbench/execution-contracts/schema";

function workflowDocument(): WorkflowDocument {
  return {
    schemaVersion: 3,
    id: "workflow-1",
    kind: "workflow",
    scope: { type: "personal" },
    name: "Release",
    agents: [{ id: "reviewer", name: "Reviewer" }],
    graph: {
      nodes: [
        { id: "start", type: "start", name: "Start", position: { x: 0, y: 0 }, config: {} },
        {
          id: "agent",
          type: "agent",
          name: "Review",
          position: { x: 100, y: 0 },
          config: {
            agentId: "reviewer",
            promptTemplate: "default",
            output: { schema: { type: "object" } },
          },
        },
        { id: "end", type: "end", name: "End", position: { x: 200, y: 0 }, config: {} },
      ],
      edges: [
        { id: "start-agent", source: "start", target: "agent" },
        { id: "agent-end", source: "agent", target: "end" },
      ],
      editor: {},
    },
    concurrency: { mode: "queue" },
    draftRevision: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

test("parses current workflow documents into detached JSON-safe values", () => {
  const source = workflowDocument();
  const parsed = parseExecutionDocument(source);

  assert.deepEqual(parsed, source);
  assert.notEqual(parsed, source);
  assert.notEqual(parsed.graph, source.graph);
});

test("migrates legacy inline agents into workflow resources", () => {
  const current = workflowDocument();
  const { agents: _currentAgents, ...legacyBase } = current;
  const legacy = {
    ...legacyBase,
    schemaVersion: 1,
    triggers: [{ id: "retired-trigger" }],
    graph: {
      ...current.graph,
      nodes: current.graph.nodes.map((node) =>
        node.type === "agent"
          ? {
              ...node,
              config: {
                prompt: "Review the release.",
                model: { provider: "provider", modelId: "model", thinkingLevel: "high" },
              },
            }
          : node,
      ),
    },
  };

  const migrated = parseExecutionDocumentWithMigration(legacy);

  assert.equal(migrated.document.schemaVersion, 3);
  assert.equal("triggers" in migrated.document, false);
  assert.deepEqual(migrated.document.agents, [{ id: "agent-1", name: "Review" }]);
  assert.deepEqual(migrated.legacyAgentResources, [
    {
      agentId: "agent-1",
      prompt: "Review the release.",
      model: { provider: "provider", modelId: "model", thinkingLevel: "high" },
    },
  ]);
});

test("rejects non-JSON values and returns detached accepted values", () => {
  const source = { nested: [1, true, null, "ok"] };
  const parsed = assertExecutionJsonValue(source);

  assert.deepEqual(parsed, source);
  assert.notEqual(parsed, source);
  assert.throws(() => assertExecutionJsonValue({ invalid: Number.NaN }), /JSON-serializable/u);
  assert.throws(() => assertExecutionJsonValue(new Date()), /JSON-serializable/u);
});
