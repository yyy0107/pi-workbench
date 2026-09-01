import assert from "node:assert/strict";
import test from "node:test";

import {
  isPiThinkingLevel,
  PI_CONVERSATION_EVENT_CUSTOM_TYPE,
  PI_MODEL_CHANGED_EVENT,
  PI_SESSION_FORKED_EVENT,
  PI_THINKING_LEVELS,
} from "../src/messages";

test("preserves Pi conversation marker identifiers", () => {
  assert.equal(PI_CONVERSATION_EVENT_CUSTOM_TYPE, "workbench.conversation-event.v1");
  assert.equal(PI_MODEL_CHANGED_EVENT, "model_changed");
  assert.equal(PI_SESSION_FORKED_EVENT, "session_forked");
});

test("recognizes the complete stable Pi thinking-level set", () => {
  assert.deepEqual(PI_THINKING_LEVELS, ["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
  for (const level of PI_THINKING_LEVELS) assert.equal(isPiThinkingLevel(level), true);
  assert.equal(isPiThinkingLevel("extra-high"), false);
  assert.equal(isPiThinkingLevel(undefined), false);
});
