import assert from "node:assert/strict";
import test from "node:test";
import { getComposerInputHistory } from "./composer-input-history";

type Runtime = Parameters<typeof getComposerInputHistory>[0];
type Session = Parameters<typeof getComposerInputHistory>[1];

function session(id: string, text: string) {
  const composer = { text, phase: "idle", attachments: [{ key: "unsent-attachment" }] };
  const value = {
    id,
    snapshot: { getSnapshot: () => ({ composer }) },
    actions: {
      setComposerText: (next: string) => {
        composer.text = next;
      },
    },
  } as unknown as Session;
  return { value, composer };
}

test("input history preserves drafts and edits while isolating projects, sessions and runtimes", () => {
  const a = session("draft-a", "未发送的 A 草稿\n保留空格  ");
  const b = session("draft-b", "未发送的 B 草稿");
  let current = {
    sessionId: a.value.id,
    threadId: undefined as string | undefined,
    isNewThread: true,
  };
  const runtime = {
    current: { getSnapshot: () => current },
    threads: {
      getSnapshot: () => ({
        threads: [
          { threadId: "remote-a", workspace: { id: "a" } },
          { threadId: "side-b", workspace: { id: "b" } },
        ],
      }),
    },
  } as unknown as Runtime;
  const historyA = getComposerInputHistory(runtime, a.value, "a");
  assert.equal(historyA.navigate(a.value, "previous"), false);
  historyA.record(a.value, "first");
  historyA.record(a.value, "second");
  historyA.record(a.value, "second");
  historyA.record(a.value, "  ");
  const draft = a.composer.text;
  const attachments = a.composer.attachments;

  assert.equal(historyA.navigate(a.value, "next"), false);
  assert.equal(historyA.navigate(a.value, "previous"), true);
  assert.equal(a.composer.text, "second");
  a.value.actions.setComposerText!("edited second");
  assert.equal(historyA.navigate(a.value, "previous"), true);
  assert.equal(a.composer.text, "first");
  assert.equal(historyA.navigate(a.value, "previous"), false);

  current = { ...current, sessionId: b.value.id };
  const historyB = getComposerInputHistory(runtime, b.value, "b");
  assert.notEqual(historyB, historyA);
  assert.equal(historyB.navigate(b.value, "previous"), false);
  historyB.record(b.value, "only B");
  assert.equal(historyB.navigate(b.value, "previous"), true);
  assert.equal(b.composer.text, "only B");

  current = { ...current, sessionId: a.value.id };
  assert.equal(getComposerInputHistory(runtime, a.value, "a"), historyA);
  assert.equal(historyA.navigate(a.value, "next"), true);
  assert.equal(a.composer.text, "edited second");
  assert.equal(historyA.navigate(a.value, "next"), true);
  assert.equal(a.composer.text, draft);
  assert.equal(a.composer.attachments, attachments);
  assert.equal(historyA.navigate(a.value, "next"), false);

  current = { ...current, threadId: "remote-a", isNewThread: false };
  assert.equal(
    getComposerInputHistory(runtime, a.value),
    historyA,
    "promotion keeps project history",
  );
  const side = session("side-b", "side draft");
  assert.equal(getComposerInputHistory(runtime, side.value, "a"), historyB);
  assert.equal(historyB.navigate(side.value, "previous"), true);
  assert.equal(
    side.composer.text,
    "only B",
    "side chat uses its own project, not the active project",
  );
  assert.equal(historyB.navigate(side.value, "next"), true);
  assert.equal(side.composer.text, "side draft", "each session has an independent history cursor");
  assert.equal(historyB.navigate(b.value, "next"), true);
  assert.equal(b.composer.text, "未发送的 B 草稿");

  assert.notEqual(getComposerInputHistory({ ...runtime }, a.value), historyA);
  const unknown = session("unknown", "unknown draft");
  const unknownHistory = getComposerInputHistory(runtime, unknown.value, "a");
  assert.equal(unknownHistory.navigate(unknown.value, "previous"), false);
  current = { sessionId: unknown.value.id, threadId: undefined, isNewThread: true };
  const unassignedHistory = getComposerInputHistory(runtime, unknown.value);
  assert.notEqual(unassignedHistory, unknownHistory);
  assert.equal(unassignedHistory.navigate(unknown.value, "previous"), false);
});

test("input history retains the latest five entries and cannot replace a draft during submission", () => {
  const draft = session("draft", "working");
  const runtime = {
    current: { getSnapshot: () => ({ sessionId: draft.value.id, isNewThread: true }) },
  } as unknown as Runtime;
  const history = getComposerInputHistory(runtime, draft.value, "project");
  for (let index = 0; index < 7; index++) history.record(draft.value, `input ${index}`);
  draft.composer.phase = "submitting";
  assert.equal(history.navigate(draft.value, "previous"), false);
  assert.equal(draft.composer.text, "working");
  draft.composer.phase = "idle";
  for (let index = 6; index >= 2; index--) {
    assert.equal(history.navigate(draft.value, "previous"), true);
    assert.equal(draft.composer.text, `input ${index}`);
  }
  assert.equal(history.navigate(draft.value, "previous"), false);
  for (let index = 0; index < 5; index++) history.navigate(draft.value, "next");
  assert.equal(draft.composer.text, "working");
});
