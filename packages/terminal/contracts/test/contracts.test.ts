import assert from "node:assert/strict";
import test from "node:test";

import { parseTerminalClientFrame, parseTerminalServerFrame } from "../src";

test("parses bounded terminal client frames", () => {
  assert.deepEqual(
    parseTerminalClientFrame({
      type: "process/write-stdin",
      processHandle: "process-1",
      data: "ls\r",
    }),
    {
      type: "process/write-stdin",
      processHandle: "process-1",
      data: "ls\r",
    },
  );
  assert.deepEqual(
    parseTerminalClientFrame({
      type: "process/resize",
      processHandle: "process-1",
      cols: 120,
      rows: 40,
    }),
    {
      type: "process/resize",
      processHandle: "process-1",
      cols: 120,
      rows: 40,
    },
  );
  assert.deepEqual(
    parseTerminalClientFrame({ type: "process/terminate", processHandle: "process-1" }),
    { type: "process/terminate", processHandle: "process-1" },
  );
  assert.deepEqual(
    parseTerminalClientFrame({
      type: "process/run",
      processHandle: "process-1",
      command: "pnpm build",
    }),
    {
      type: "process/run",
      processHandle: "process-1",
      command: "pnpm build",
    },
  );
  assert.equal(
    parseTerminalClientFrame({
      type: "process/resize",
      processHandle: "process-1",
      cols: 0,
      rows: 40,
    }),
    undefined,
  );
  assert.equal(
    parseTerminalClientFrame({
      type: "process/run",
      processHandle: "process-1",
      command: "  ",
    }),
    undefined,
  );
  assert.equal(parseTerminalClientFrame({ type: "process/write-stdin", data: "ls\r" }), undefined);
  assert.equal(parseTerminalClientFrame({ type: "unknown" }), undefined);
});

test("parses terminal server process lifecycle frames", () => {
  const process = {
    processHandle: "process-1",
    sessionId: "workspace-1",
    kind: "tool" as const,
    cwd: "/workspace",
    process: "bash",
    pid: 42,
    tty: true as const,
    processState: "running" as const,
    interactionState: "possible" as const,
    attachmentState: "attached" as const,
    startedAt: 100,
    outputBytes: 5,
    outputBytesCap: 1024,
    outputCapReached: false,
  };
  assert.deepEqual(parseTerminalServerFrame({ type: "process/ready", process }), {
    type: "process/ready",
    process,
  });
  assert.deepEqual(
    parseTerminalServerFrame({
      type: "process/output-delta",
      delta: {
        processHandle: "process-1",
        sequence: 1,
        stream: "terminal",
        data: "ready",
        outputBytes: 5,
        outputCapReached: false,
      },
    }),
    {
      type: "process/output-delta",
      delta: {
        processHandle: "process-1",
        sequence: 1,
        stream: "terminal",
        data: "ready",
        outputBytes: 5,
        outputCapReached: false,
      },
    },
  );
  assert.deepEqual(
    parseTerminalServerFrame({
      type: "process/state",
      processHandle: "process-1",
      processState: "running",
      interactionState: "active",
      attachmentState: "attached",
    }),
    {
      type: "process/state",
      processHandle: "process-1",
      processState: "running",
      interactionState: "active",
      attachmentState: "attached",
    },
  );
  assert.deepEqual(
    parseTerminalServerFrame({
      type: "process/exited",
      exit: {
        processHandle: "process-1",
        processState: "exited",
        reason: "exited",
        exitCode: 0,
        outputBytes: 5,
        outputCapReached: false,
      },
    }),
    {
      type: "process/exited",
      exit: {
        processHandle: "process-1",
        processState: "exited",
        reason: "exited",
        exitCode: 0,
        outputBytes: 5,
        outputCapReached: false,
      },
    },
  );
  assert.equal(
    parseTerminalServerFrame({
      type: "process/state",
      processHandle: "process-1",
      processState: "running",
      interactionState: "waiting",
      attachmentState: "attached",
    }),
    undefined,
  );
  assert.equal(parseTerminalServerFrame({ type: "process/error", code: "made-up" }), undefined);
});
