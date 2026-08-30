import assert from "node:assert/strict";
import test from "node:test";

import type { SessionEntry } from "@earendil-works/pi-coding-agent";

import {
  missingSessionResumeCheckpointFromBranch,
  resumeReasonFromAssistantMessage,
  SESSION_RESUME_CHECKPOINT_CUSTOM_TYPE,
  sessionResumeStateFromBranch,
  type StoredSessionResumeCheckpoint,
} from "../../src/sessions/session-resume";

function assistantWithTermination(kind: string, errorMessage?: string) {
  return {
    diagnostics: [
      {
        type: "workbench.message-termination.v1",
        timestamp: 1_000,
        details: {
          schemaVersion: 1,
          kind,
          stopReason: "error",
          ...(errorMessage ? { errorMessage } : {}),
        },
      },
    ],
  };
}

function checkpointEntry(overrides: Partial<StoredSessionResumeCheckpoint> = {}): SessionEntry {
  return {
    id: "checkpoint-1",
    parentId: "assistant-1",
    timestamp: "2026-08-25T12:00:00.000Z",
    type: "custom",
    customType: SESSION_RESUME_CHECKPOINT_CUSTOM_TYPE,
    data: {
      version: 1,
      terminalMessageId: "terminal-event-1",
      anchorEntryId: "user-1",
      sourceEventSeq: 8,
      reason: "user-cancelled",
      createdAt: 1_777_000_000_000,
      ...overrides,
    },
  } as unknown as SessionEntry;
}

test("classifies persisted interruption reasons, including provider limits", () => {
  assert.equal(
    resumeReasonFromAssistantMessage(assistantWithTermination("cancelled")),
    "user-cancelled",
  );
  assert.equal(
    resumeReasonFromAssistantMessage(
      assistantWithTermination("api-error", "429: rate limit exceeded"),
    ),
    "rate-limited",
  );
  assert.equal(
    resumeReasonFromAssistantMessage(
      assistantWithTermination("api-error", "insufficient_quota: credit balance exhausted"),
    ),
    "quota-exhausted",
  );
  assert.equal(resumeReasonFromAssistantMessage(assistantWithTermination("length")), undefined);
});

test("projects the active checkpoint and invalidates it after a new conversation message", () => {
  const checkpoint = checkpointEntry();
  assert.deepEqual(sessionResumeStateFromBranch([checkpoint]), {
    checkpoint: {
      checkpointId: "checkpoint-1",
      terminalMessageId: "terminal-event-1",
      branchLeafId: "checkpoint-1",
      sourceEventSeq: 8,
      reason: "user-cancelled",
      capability: "ready",
      createdAt: 1_777_000_000_000,
    },
  });

  const resumedAssistant = {
    id: "assistant-2",
    parentId: "checkpoint-1",
    timestamp: "2026-08-25T12:01:00.000Z",
    type: "message",
    message: { role: "assistant", content: [], stopReason: "stop" },
  } as unknown as SessionEntry;
  assert.deepEqual(sessionResumeStateFromBranch([checkpoint, resumedAssistant]), {});
});

test("blocks quota checkpoints on the failed model and enables them after a model change", () => {
  const checkpoint = checkpointEntry({
    reason: "quota-exhausted",
    model: { provider: "provider-a", model: "model-a" },
  });
  assert.equal(
    sessionResumeStateFromBranch([checkpoint], {
      provider: "provider-a",
      model: "model-a",
    }).checkpoint?.capability,
    "blocked",
  );
  assert.equal(
    sessionResumeStateFromBranch([checkpoint], {
      provider: "provider-b",
      model: "model-b",
    }).checkpoint?.capability,
    "ready",
  );
});

test("requires confirmation when a tool result is ambiguous", () => {
  const state = sessionResumeStateFromBranch([
    checkpointEntry({ ambiguousTools: [{ toolCallId: "tool-1", toolName: "Bash" }] }),
  ]);
  assert.equal(state.checkpoint?.capability, "confirmation-required");
  assert.equal(state.checkpoint?.blockedBy, "ambiguous-tools");
});

test("reconstructs a missing checkpoint for a settled cancellation retained across HMR", () => {
  const terminalMessage = {
    role: "assistant",
    content: [],
    provider: "provider-a",
    model: "model-a",
    stopReason: "aborted",
    ...assistantWithTermination("cancelled", "Request was aborted"),
  };
  const branch = [
    {
      id: "user-1",
      parentId: null,
      timestamp: "2026-08-25T12:00:00.000Z",
      type: "message",
      message: { role: "user", content: "continue this task" },
    },
    {
      id: "terminal-event-1",
      parentId: "user-1",
      timestamp: "2026-08-25T12:00:01.000Z",
      type: "custom",
      customType: "workbench.session-event.v1",
      data: {},
    },
    {
      id: "assistant-1",
      parentId: "terminal-event-1",
      timestamp: "2026-08-25T12:00:01.000Z",
      type: "message",
      message: terminalMessage,
    },
    {
      id: "settled-event-1",
      parentId: "assistant-1",
      timestamp: "2026-08-25T12:00:02.000Z",
      type: "custom",
      customType: "workbench.session-event.v1",
      data: {},
    },
  ] as unknown as SessionEntry[];
  const events = [
    {
      type: "agent_start",
      seq: 0,
      time: 1_000,
      data: {},
      entryId: "start-event-1",
    },
    {
      type: "message_end",
      seq: 1,
      time: 2_000,
      data: { message: terminalMessage },
      entryId: "terminal-event-1",
    },
    {
      type: "agent_settled",
      seq: 2,
      time: 3_000,
      data: {},
      entryId: "settled-event-1",
    },
  ];

  assert.deepEqual(missingSessionResumeCheckpointFromBranch(branch, events), {
    terminalMessageId: "terminal-event-1",
    value: {
      version: 1,
      terminalMessageId: "terminal-event-1",
      anchorEntryId: "user-1",
      sourceEventSeq: 1,
      reason: "user-cancelled",
      createdAt: 3_000,
      model: { provider: "provider-a", model: "model-a" },
    },
  });

  const laterUser = {
    id: "user-2",
    parentId: "settled-event-1",
    timestamp: "2026-08-25T12:01:00.000Z",
    type: "message",
    message: { role: "user", content: "a newer task" },
  } as unknown as SessionEntry;
  assert.equal(missingSessionResumeCheckpointFromBranch([...branch, laterUser], events), undefined);
});
