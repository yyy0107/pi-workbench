import assert from "node:assert/strict";
import test from "node:test";
import { terminalToolStatus } from "./terminal-tool-status";

test("transport and process completion take priority over stale tool/input status", () => {
  assert.equal(
    terminalToolStatus({ phase: "exited", exitCode: 0 }, true, "possible", true),
    "awaitingResult",
  );
  assert.equal(
    terminalToolStatus({ phase: "exited", exitCode: 1 }, false, "active", true),
    "exited",
  );
  assert.equal(terminalToolStatus({ phase: "stopping" }, true, "active", true), "stopping");
  assert.equal(
    terminalToolStatus({ phase: "disconnected" }, true, "possible", true),
    "reconnecting",
  );
  assert.equal(terminalToolStatus({ phase: "error" }, true, "possible", true), "connectionError");
  assert.equal(terminalToolStatus({ phase: "connected" }, true, "none", false), "running");
  assert.equal(
    terminalToolStatus({ phase: "connected" }, true, "possible", false),
    "interactionPossible",
  );
  assert.equal(
    terminalToolStatus({ phase: "connected" }, true, "none", true),
    "userInputRequested",
  );
  assert.equal(terminalToolStatus({ phase: "fallback" }, true, "none", false), undefined);
});
