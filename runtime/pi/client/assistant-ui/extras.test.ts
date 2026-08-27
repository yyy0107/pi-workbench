import assert from "node:assert/strict";
import test from "node:test";
import type { ThreadMessage } from "@assistant-ui/react";

import {
  readAgentRunRecovery,
  readAgentThreadWorkspace,
} from "@/runtime/assistant-ui/agent-runtime-extras";

import { PiSessionManager } from "../runtime/manager";
import { projectPiAgentRuntimeExtras } from "./extras";

test("projects Pi cwd metadata into the backend-neutral Workbench workspace capability", () => {
  const manager = new PiSessionManager();
  const session = manager.getSession("local-thread");

  try {
    manager.setDraftWorkspace("local-thread", {
      id: "workspace-1",
      name: "Project",
      cwd: "/projects/example",
      pinned: true,
    });
    const workspace = manager.getThreadStateSnapshot("local-thread").metadata.workspace;
    const extras = projectPiAgentRuntimeExtras({
      session,
      snapshot: session.getSnapshot(),
      workspace,
      clearComposerError: () => undefined,
    });

    assert.deepEqual(readAgentThreadWorkspace(extras), {
      id: "workspace-1",
      name: "Project",
      rootPath: "/projects/example",
      pinned: true,
    });
  } finally {
    manager.dispose();
  }
});

test("projects a terminal checkpoint onto its coalesced visible assistant row", () => {
  const manager = new PiSessionManager();
  const session = manager.getSession("remote-thread", "remote-thread");

  try {
    const visibleAssistant = {
      id: "visible-assistant-turn",
      role: "assistant",
      content: [{ type: "text", text: "Stopped", status: { type: "complete" } }],
      status: { type: "incomplete", reason: "cancelled" },
      createdAt: new Date(2_000),
      metadata: {
        unstable_state: null,
        unstable_annotations: [],
        unstable_data: [],
        steps: [],
        custom: { piEventSeq: 12 },
      },
    } satisfies ThreadMessage;
    const extras = projectPiAgentRuntimeExtras({
      session,
      snapshot: {
        ...session.getSnapshot(),
        messages: [visibleAssistant],
        resumeCheckpoint: {
          checkpointId: "checkpoint-1",
          terminalMessageId: "terminal-message-end-entry",
          branchLeafId: "leaf-1",
          sourceEventSeq: 12,
          reason: "user-cancelled",
          capability: "ready",
          createdAt: 1_777_000_000_000,
        },
      },
      clearComposerError: () => undefined,
    });

    assert.equal(
      readAgentRunRecovery(extras).resumeCheckpoint?.terminalMessageId,
      visibleAssistant.id,
    );
  } finally {
    manager.dispose();
  }
});
