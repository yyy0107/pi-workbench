import assert from "node:assert/strict";
import test from "node:test";

import {
  readAgentAutoRetry,
  readAgentComposerExtras,
  readAgentQueueExtras,
  readAgentRejectedQueueDraft,
  readAgentRunRecovery,
  readAgentRunTiming,
  readAgentThreadWorkspace,
} from "@workbench/agent-runtime-client/extras";

function queueExtras(overrides: Record<string, unknown> = {}) {
  return {
    paused: false,
    steeringIds: ["queued-1"],
    beginEdit: () => undefined,
    clearRejectedDraft: () => undefined,
    setPaused: () => undefined,
    ...overrides,
  };
}

test("reads valid queue and rejected-draft extras without invoking their actions", () => {
  let actionCalls = 0;
  const agentQueue = queueExtras({
    beginEdit: () => {
      actionCalls += 1;
      return undefined;
    },
    clearRejectedDraft: () => {
      actionCalls += 1;
    },
    rejectedDraft: {
      revision: 2,
      message: { role: "user", content: [{ type: "text", text: "retry" }] },
    },
    vendorData: true,
  });
  const extras = { agentQueue };

  assert.equal(readAgentQueueExtras(extras), agentQueue);
  assert.equal(readAgentRejectedQueueDraft(extras), agentQueue);
  assert.equal(actionCalls, 0);
});

test("reads only a valid backend-neutral thread workspace", () => {
  const workspace = {
    id: "workspace-1",
    name: "Project",
    rootPath: "/projects/example",
    pinned: true,
  };

  assert.equal(readAgentThreadWorkspace({ agentThread: { workspace } }), workspace);
  assert.equal(readAgentThreadWorkspace({ agentThread: { workspace: { id: "" } } }), undefined);
  assert.equal(
    readAgentThreadWorkspace({ agentThread: { workspace: { id: "workspace-1", pinned: "yes" } } }),
    undefined,
  );
  assert.equal(readAgentThreadWorkspace({ agentThread: [] }), undefined);
});

test("rejects malformed queue controls while ignoring a malformed optional draft", () => {
  assert.equal(readAgentQueueExtras({ agentQueue: queueExtras({ steeringIds: [1] }) }), undefined);
  assert.equal(readAgentQueueExtras({ agentQueue: queueExtras({ beginEdit: null }) }), undefined);
  assert.equal(readAgentQueueExtras({ agentQueue: [] }), undefined);

  const extras = { agentQueue: queueExtras({ rejectedDraft: { revision: -1, message: {} } }) };
  assert.equal(readAgentQueueExtras(extras), extras.agentQueue);
  assert.equal(readAgentRejectedQueueDraft(extras), undefined);

  const controlsWithoutDraftRecovery = queueExtras({ clearRejectedDraft: undefined });
  assert.equal(
    readAgentQueueExtras({ agentQueue: controlsWithoutDraftRecovery }),
    controlsWithoutDraftRecovery,
  );
  assert.equal(
    readAgentRejectedQueueDraft({
      agentQueue: {
        ...controlsWithoutDraftRecovery,
        rejectedDraft: {
          revision: 1,
          message: { role: "user", content: [{ type: "text", text: "retry" }] },
        },
      },
    }),
    undefined,
  );
});

test("reads only known Composer errors and preserves the action reference", () => {
  const clearError = () => undefined;
  const agentComposer = { error: "attachment-too-large", clearError, vendorData: true };

  assert.equal(readAgentComposerExtras({ agentComposer }), agentComposer);
  assert.equal(readAgentComposerExtras({ agentComposer: { clearError } })?.clearError, clearError);
  assert.equal(
    readAgentComposerExtras({ agentComposer: { error: "vendor-error", clearError } }),
    undefined,
  );
  assert.equal(readAgentComposerExtras({ agentComposer: { clearError: false } }), undefined);
});

test("reads timing and automatic retry independently", () => {
  const timing = { startedAt: 12_345, elapsedMs: 2_500, observedAt: 80 };
  const autoRetry = { attempt: 2, maxAttempts: 3 };
  const extras = { agentRun: { timing, autoRetry, vendorData: true } };

  assert.equal(readAgentRunTiming(extras), timing);
  assert.equal(readAgentAutoRetry(extras), autoRetry);
  assert.equal(
    readAgentRunTiming({ agentRun: { timing: { ...timing, elapsedMs: Number.NaN } } }),
    undefined,
  );
  assert.equal(
    readAgentAutoRetry({ agentRun: { autoRetry: { attempt: 4, maxAttempts: 3 } } }),
    undefined,
  );
  assert.equal(
    readAgentAutoRetry({ agentRun: { autoRetry: { attempt: 1.5, maxAttempts: 3 } } }),
    undefined,
  );
});

test("reads recovery actions while omitting an invalid optional checkpoint", () => {
  const resume = async () => undefined;
  const resumeLatest = async () => undefined;
  const checkpoint = {
    checkpointId: "checkpoint-1",
    terminalMessageId: "assistant-1",
    expectedStateId: "leaf-1",
    capability: "ready",
  };

  const agentRun = { resume, resumeLatest, resumeCheckpoint: checkpoint, vendorData: true };
  assert.equal(readAgentRunRecovery({ agentRun }), agentRun);
  assert.deepEqual(
    readAgentRunRecovery({
      agentRun: { resumeLatest, resumeCheckpoint: { ...checkpoint, capability: "unknown" } },
    }),
    { resumeLatest },
  );
  assert.deepEqual(readAgentRunRecovery({ agentRun: { resume: false } }), {});
  assert.deepEqual(readAgentRunRecovery(null), {});
});
