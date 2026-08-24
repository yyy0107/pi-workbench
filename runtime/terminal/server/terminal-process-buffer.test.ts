import assert from "node:assert/strict";
import test from "node:test";

import { TerminalProcessBuffer } from "./terminal-process-buffer";

test("keeps ordered live deltas and reports bounded reconnect replay", () => {
  const output = new TerminalProcessBuffer("process-1", 10);

  assert.deepEqual(output.append("hello"), {
    processHandle: "process-1",
    sequence: 1,
    stream: "terminal",
    data: "hello",
    outputBytes: 5,
    outputCapReached: false,
  });
  assert.deepEqual(output.append(" world"), {
    processHandle: "process-1",
    sequence: 2,
    stream: "terminal",
    data: " world",
    outputBytes: 11,
    outputCapReached: true,
  });
  assert.deepEqual(output.replay(), {
    data: " world",
    sequence: 2,
    outputBytes: 11,
    outputCapReached: true,
  });
});
