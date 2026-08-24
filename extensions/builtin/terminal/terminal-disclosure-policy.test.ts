import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldExpandInteractiveTerminal,
  shouldRevealInteractiveTerminal,
} from "./terminal-disclosure-policy";

test("expands a running terminal when interaction becomes possible or active", () => {
  assert.equal(shouldExpandInteractiveTerminal("none", true, false), false);
  assert.equal(shouldExpandInteractiveTerminal("possible", true, false), true);
  assert.equal(shouldExpandInteractiveTerminal("active", true, false), true);
});

test("does not reopen a visible or completed terminal block", () => {
  assert.equal(shouldExpandInteractiveTerminal("possible", true, true), false);
  assert.equal(shouldExpandInteractiveTerminal("active", false, false), false);
});

test("reveals an interactive terminal only once while the command is running", () => {
  assert.equal(shouldRevealInteractiveTerminal("none", true, false), false);
  assert.equal(shouldRevealInteractiveTerminal("possible", true, false), true);
  assert.equal(shouldRevealInteractiveTerminal("active", true, false), true);
  assert.equal(shouldRevealInteractiveTerminal("possible", true, true), false);
  assert.equal(shouldRevealInteractiveTerminal("active", false, false), false);
});
