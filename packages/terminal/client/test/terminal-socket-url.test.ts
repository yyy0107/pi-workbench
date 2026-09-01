import assert from "node:assert/strict";
import test from "node:test";

import { TERMINAL_WEBSOCKET_PATH } from "@workbench/terminal-contracts";

import { ptyTerminalSocketPath, toolTerminalSocketPath } from "../src/terminal-socket-url";

test("builds a root-relative PTY socket path without reading the renderer origin", () => {
  const path = ptyTerminalSocketPath({ sessionId: "terminal-a", cwd: "/workspace/a" }, 120, 40);
  const url = new URL(path, "http://test.invalid");

  assert.equal(url.pathname, TERMINAL_WEBSOCKET_PATH);
  assert.equal(url.searchParams.get("sessionId"), "terminal-a");
  assert.equal(url.searchParams.get("cwd"), "/workspace/a");
  assert.equal(url.searchParams.get("cols"), "120");
  assert.equal(url.searchParams.get("rows"), "40");
  assert.equal(path.startsWith("/"), true);
  assert.equal(path.includes("test.invalid"), false);
});

test("builds a root-relative tool transcript path and preserves the optional target", () => {
  assert.equal(toolTerminalSocketPath({ toolCallId: "tool-a" }), undefined);

  const path = toolTerminalSocketPath(
    { sessionId: "session-a", toolCallId: "tool-a" },
    { cols: 90, rows: 24, observeInteraction: true },
  );
  assert.ok(path);
  const url = new URL(path, "http://test.invalid");
  assert.equal(url.pathname, TERMINAL_WEBSOCKET_PATH);
  assert.equal(url.searchParams.get("sessionId"), "session-a");
  assert.equal(url.searchParams.get("toolCallId"), "tool-a");
  assert.equal(url.searchParams.get("observe"), "interaction");
});
