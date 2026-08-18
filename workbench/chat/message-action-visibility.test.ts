import assert from "node:assert/strict";
import test from "node:test";

const { shouldShowMessageActions } = (await import(
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
