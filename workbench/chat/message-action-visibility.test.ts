import assert from "node:assert/strict";
import test from "node:test";

const { shouldHideMessageActionBar, shouldShowMessageActions, shouldShowMessageNavigation } =
  (await import(
    new URL("./message-action-visibility.ts", import.meta.url).href
  )) as typeof import("./message-action-visibility");

const user = (id: string) => ({
  id,
  role: "user" as const,
  content: [{ type: "text" }],
});
const assistant = (id: string, ...types: string[]) => ({
  id,
  role: "assistant" as const,
  content: types.map((type) => (type === "text" ? { type, text: `${id} response` } : { type })),
});
const branchedAssistant = (id: string, branchCount: number, ...types: string[]) => ({
  ...assistant(id, ...types),
  branchCount,
});
const system = (id: string) => ({
  id,
  role: "system" as const,
  content: [{ type: "text" }],
});

test("shows actions for user messages and the final assistant response", () => {
  const messages = [user("user-1"), assistant("assistant-1", "text")];

  assert.equal(shouldShowMessageActions(messages, 0), true);
  assert.equal(shouldShowMessageActions(messages, 1), true);
});

test("hides the action bar while the current assistant response is running", () => {
  const runningAssistant = {
    ...assistant("assistant-running", "text"),
    isLast: true,
    status: { type: "running" },
  };
  const completedAssistant = {
    ...assistant("assistant-complete", "text"),
    isLast: true,
    status: { type: "complete" },
  };

  assert.equal(shouldHideMessageActionBar(runningAssistant, true), true);
  assert.equal(shouldHideMessageActionBar(completedAssistant, false), false);
  assert.equal(shouldHideMessageActionBar(user("user-1"), true), false);
});

test("hides a completed-status branched response until its retry run finishes", () => {
  const activeBranch = {
    ...branchedAssistant("assistant-retry", 2, "reasoning", "tool-call"),
    isLast: true,
    status: { type: "complete" },
  };
  const historicalBranch = {
    ...activeBranch,
    id: "assistant-history",
    isLast: false,
  };

  assert.equal(shouldHideMessageActionBar(activeBranch, true), true);
  assert.equal(shouldHideMessageActionBar(activeBranch, false), false);
  assert.equal(shouldHideMessageActionBar(historicalBranch, true), false);
});

test("hides actions for a persisted message while its turn continues", () => {
  const completedToolStep = {
    ...assistant("assistant-tool-step", "text", "tool-call"),
    isLast: true,
    status: { type: "complete" },
    metadata: { custom: { piEventSeq: 7 } },
  };

  assert.equal(shouldHideMessageActionBar(completedToolStep, true), true);
  assert.equal(shouldHideMessageActionBar(completedToolStep, false), false);
});

test("hides actions for tool-call steps", () => {
  const messages = [
    user("user-1"),
    assistant("tool-step", "reasoning", "text", "tool-call"),
    assistant("final", "text"),
  ];

  assert.equal(shouldShowMessageActions(messages, 1), false);
  assert.equal(shouldShowMessageActions(messages, 2), true);
});

test("shows actions for a merged tool timeline with a final response", () => {
  const messages = [user("user-1"), assistant("merged-final", "reasoning", "tool-call", "text")];

  assert.equal(shouldShowMessageActions(messages, 1), true);
});

test("hides empty or text-only assistant records when the turn continues", () => {
  const messages = [
    user("user-1"),
    assistant("empty-step"),
    system("system-event"),
    assistant("text-step", "text"),
    assistant("final", "text"),
  ];

  assert.equal(shouldShowMessageActions(messages, 1), false);
  assert.equal(shouldShowMessageActions(messages, 3), false);
  assert.equal(shouldShowMessageActions(messages, 4), true);
});

test("does not expose actions for a terminal tool-only response", () => {
  const messages = [user("user-1"), assistant("tool-step", "tool-call")];

  assert.equal(shouldShowMessageActions(messages, 1), false);
});

test("does not expose actions for an empty final assistant response", () => {
  const messages = [user("user-1"), assistant("reasoning-step", "reasoning")];

  assert.equal(shouldShowMessageActions(messages, 1), false);
});

test("keeps branch navigation mounted for an empty error response", () => {
  const messages = [user("user-1"), branchedAssistant("failed-response", 2)];

  assert.equal(shouldShowMessageActions(messages, 1), false);
  assert.equal(shouldShowMessageNavigation(messages, 1, true), true);
});

test("does not mount branch navigation without multiple switchable branches", () => {
  const singleBranch = [user("user-1"), branchedAssistant("failed-response", 1)];
  const multipleBranches = [user("user-1"), branchedAssistant("failed-response", 2)];

  assert.equal(shouldShowMessageNavigation(singleBranch, 1, true), false);
  assert.equal(shouldShowMessageNavigation(multipleBranches, 1, false), false);
});
