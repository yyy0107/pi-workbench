import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldExpandBashTerminalForUserInput,
  shouldRevealBashTerminalForUserInput,
} from "./terminal-disclosure-policy";

test("expands a running terminal only when the agent delegates input to the user", () => {
  assert.equal(shouldExpandBashTerminalForUserInput(undefined, true, true, false), false);
  assert.equal(shouldExpandBashTerminalForUserInput("agent", true, true, false), false);
  assert.equal(shouldExpandBashTerminalForUserInput("user", false, true, false), false);
  assert.equal(shouldExpandBashTerminalForUserInput("user", true, true, false), true);
});

test("does not reopen a visible or completed terminal block", () => {
  assert.equal(shouldExpandBashTerminalForUserInput("user", true, true, true), false);
  assert.equal(shouldExpandBashTerminalForUserInput("user", true, false, false), false);
});

test("reveals a user-input terminal only once while the command is running", () => {
  assert.equal(shouldRevealBashTerminalForUserInput(undefined, true, true, false), false);
  assert.equal(shouldRevealBashTerminalForUserInput("agent", true, true, false), false);
  assert.equal(shouldRevealBashTerminalForUserInput("user", false, true, false), false);
  assert.equal(shouldRevealBashTerminalForUserInput("user", true, true, false), true);
  assert.equal(shouldRevealBashTerminalForUserInput("user", true, true, true), false);
  assert.equal(shouldRevealBashTerminalForUserInput("user", true, false, false), false);
});
