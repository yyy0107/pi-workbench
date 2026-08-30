import assert from "node:assert/strict";
import test from "node:test";

import { isWorkflowHostPayload, parseExecutionSessionOrigin } from "@workbench/execution-contracts";

const VALID_ORIGIN = {
  version: 1,
  origin: "execution",
  workflowId: "workflow-1",
  workflowName: "Release",
  workflowKind: "workflow",
  runId: "run-1",
  nodeId: "agent-1",
  attempt: 1,
  source: "manual",
} as const;

test("parseExecutionSessionOrigin accepts current and legacy provenance", () => {
  assert.deepEqual(parseExecutionSessionOrigin(VALID_ORIGIN), VALID_ORIGIN);

  const legacy = { ...VALID_ORIGIN, source: "schedule", triggerId: "trigger-1" } as const;
  assert.deepEqual(parseExecutionSessionOrigin(legacy), legacy);

  assert.equal(parseExecutionSessionOrigin({ ...VALID_ORIGIN, source: "event" })?.source, "event");
  assert.equal(
    parseExecutionSessionOrigin({ ...VALID_ORIGIN, source: "replay" })?.source,
    "replay",
  );
});

test("parseExecutionSessionOrigin rejects malformed provenance", () => {
  const invalidValues = [
    undefined,
    null,
    [],
    { ...VALID_ORIGIN, version: 2 },
    { ...VALID_ORIGIN, origin: "automation" },
    { ...VALID_ORIGIN, workflowId: "" },
    { ...VALID_ORIGIN, workflowName: "" },
    { ...VALID_ORIGIN, workflowKind: "pipeline" },
    { ...VALID_ORIGIN, runId: "" },
    { ...VALID_ORIGIN, nodeId: "" },
    { ...VALID_ORIGIN, attempt: 0 },
    { ...VALID_ORIGIN, attempt: 1.5 },
    { ...VALID_ORIGIN, source: "timer" },
    { ...VALID_ORIGIN, triggerId: "" },
  ];

  for (const value of invalidValues) {
    assert.equal(parseExecutionSessionOrigin(value), undefined);
  }
});

test("isWorkflowHostPayload recognizes every host notification variant", () => {
  assert.equal(
    isWorkflowHostPayload({ type: "host/workflow-changed", workflow: { id: "workflow-1" } }),
    true,
  );
  assert.equal(
    isWorkflowHostPayload({ type: "host/workflow-removed", workflowId: "workflow-1" }),
    true,
  );
  assert.equal(
    isWorkflowHostPayload({ type: "host/workflow-run-changed", run: { id: "run-1" } }),
    true,
  );
  assert.equal(
    isWorkflowHostPayload({
      type: "host/workflow-run-removed",
      runId: "run-1",
      workflowId: "workflow-1",
    }),
    true,
  );
});

test("isWorkflowHostPayload rejects unknown or incomplete host notifications", () => {
  const invalidValues = [
    undefined,
    [],
    {},
    { type: "host/workflow-changed", workflow: {} },
    { type: "host/workflow-removed" },
    { type: "host/workflow-run-changed", run: {} },
    { type: "host/workflow-run-removed", runId: "run-1" },
    { type: "host/automation-changed", automation: { id: "automation-1" } },
  ];

  for (const value of invalidValues) {
    assert.equal(isWorkflowHostPayload(value), false);
  }
});
