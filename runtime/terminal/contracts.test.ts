import assert from "node:assert/strict";
import test from "node:test";

import { parseTerminalClientFrame, parseTerminalServerFrame } from "./contracts";

test("parses bounded terminal client frames", () => {
  assert.deepEqual(parseTerminalClientFrame({ type: "input", data: "ls\r" }), {
    type: "input",
    data: "ls\r",
  });
  assert.deepEqual(parseTerminalClientFrame({ type: "resize", cols: 120, rows: 40 }), {
    type: "resize",
    cols: 120,
    rows: 40,
  });
  assert.deepEqual(parseTerminalClientFrame({ type: "interrupt" }), { type: "interrupt" });
  assert.deepEqual(parseTerminalClientFrame({ type: "run", command: "pnpm build" }), {
    type: "run",
    command: "pnpm build",
  });
  assert.equal(parseTerminalClientFrame({ type: "resize", cols: 0, rows: 40 }), undefined);
  assert.equal(parseTerminalClientFrame({ type: "run", command: "  " }), undefined);
  assert.equal(parseTerminalClientFrame({ type: "unknown" }), undefined);
});

test("parses terminal server lifecycle frames", () => {
  assert.deepEqual(
    parseTerminalServerFrame({
      type: "ready",
      sessionId: "workspace-1",
      cwd: "/workspace",
      process: "bash",
      pid: 42,
    }),
    {
      type: "ready",
      sessionId: "workspace-1",
      cwd: "/workspace",
      process: "bash",
      pid: 42,
    },
  );
  assert.deepEqual(parseTerminalServerFrame({ type: "data", data: "ready" }), {
    type: "data",
    data: "ready",
  });
  assert.deepEqual(parseTerminalServerFrame({ type: "exit", exitCode: 0 }), {
    type: "exit",
    exitCode: 0,
  });
  assert.equal(parseTerminalServerFrame({ type: "error", code: "made-up" }), undefined);
});
