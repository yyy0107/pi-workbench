import assert from "node:assert/strict";
import test from "node:test";

import { setQuestionCustomAnswer, type AskUserQuestion } from "../lib/interaction-form-state";
import {
  createQuestionPanelState,
  navigateQuestionPanel,
  reconcileQuestionPanelState,
} from "../lib/question-panel-state";

const questions: readonly AskUserQuestion[] = [
  { id: "first", question: "First", options: [{ label: "A" }], allowCustom: true },
  { id: "second", question: "Second" },
  { id: "third", question: "Third" },
];

test("initial mount restores progress without scheduling a page animation", () => {
  const state = createQuestionPanelState({
    interactionKey: "request-2",
    questions,
    progress: { currentIndex: 1, answers: [{ id: "first", selected: ["A"] }] },
  });
  assert.equal(state.currentIndex, 1);
  assert.equal(state.direction, undefined);
  assert.deepEqual(state.drafts[0]?.selected, ["A"]);
});

test("focus, typing and same-request rerenders do not change page identity or replay animation", () => {
  const input = { interactionKey: "request-1", questions };
  const initial = createQuestionPanelState(input);
  const edited = { ...initial, drafts: setQuestionCustomAnswer(initial.drafts, 0, "My answer") };
  assert.equal(reconcileQuestionPanelState(edited, input), edited);
  assert.equal(navigateQuestionPanel(edited, 0, questions.length), edited);
  assert.equal(edited.direction, undefined);
  assert.equal(edited.drafts[0]?.custom, "My answer");
});

test("forward and backward navigation preserve drafts and determine opposite directions", () => {
  const initial = createQuestionPanelState({ questions });
  const edited = { ...initial, drafts: setQuestionCustomAnswer(initial.drafts, 0, "Keep this") };
  const next = navigateQuestionPanel(edited, 2, questions.length);
  const back = navigateQuestionPanel(next, 0, questions.length);
  assert.equal(next.currentIndex, 2);
  assert.equal(next.direction, "forward");
  assert.equal(back.currentIndex, 0);
  assert.equal(back.direction, "backward");
  assert.equal(next.drafts, edited.drafts);
  assert.equal(back.drafts, edited.drafts);
});

test("request handoff restores saved answers while preserving unsent drafts on other pages", () => {
  const initial = createQuestionPanelState({ interactionKey: "request-1", questions });
  const edited = { ...initial, drafts: setQuestionCustomAnswer(initial.drafts, 2, "Unsent draft") };
  const next = reconcileQuestionPanelState(edited, {
    interactionKey: "request-2",
    questions,
    progress: {
      currentIndex: 1,
      answers: [{ id: "first", selected: ["A"], custom: "Saved by server" }],
    },
  });
  assert.equal(next.interactionKey, "request-2");
  assert.equal(next.currentIndex, 1);
  assert.equal(next.direction, "forward");
  assert.deepEqual(next.drafts[0], { selected: ["A"], custom: "Saved by server" });
  assert.equal(next.drafts[2], edited.drafts[2]);
  assert.equal(edited.drafts[0]?.custom, "");
});

test("returning to a missing required answer preserves validation across request handoff", () => {
  const initial = createQuestionPanelState({
    interactionKey: "request-3",
    questions,
    progress: { currentIndex: 2, answers: [] },
  });
  const next = reconcileQuestionPanelState(
    { ...initial, validationIndex: 0 },
    {
      interactionKey: "request-4",
      questions,
      progress: { currentIndex: 0, answers: [] },
    },
  );
  assert.equal(next.direction, "backward");
  assert.equal(next.currentIndex, 0);
  assert.equal(next.validationIndex, 0);
});

test("same-page request updates replace saved answers without a new transition", () => {
  const initial = createQuestionPanelState({ interactionKey: "request-1", questions });
  const next = reconcileQuestionPanelState(initial, {
    interactionKey: "request-2",
    questions,
    progress: { currentIndex: 0, answers: [{ id: "first", selected: [], skipped: true }] },
  });
  assert.equal(next.direction, undefined);
  assert.deepEqual(next.drafts[0], { selected: [], custom: "", skipped: true });
});

test("invalid navigation and progress cannot make the question body empty", () => {
  const initial = createQuestionPanelState({ questions });
  for (const index of [-1, 3, Number.NaN, 0.5]) {
    assert.equal(navigateQuestionPanel(initial, index, questions.length), initial);
    assert.equal(
      createQuestionPanelState({
        questions,
        progress: { currentIndex: index, answers: [] },
      }).currentIndex,
      0,
    );
  }
});

test("same-request metadata can add or reorder questions without missing or misassigned drafts", () => {
  const initial = createQuestionPanelState({ interactionKey: "request-1", questions });
  const edited = { ...initial, drafts: setQuestionCustomAnswer(initial.drafts, 0, "Keep this") };
  const reordered = [questions[2]!, questions[0]!, { id: "new", question: "New question" }];
  const next = reconcileQuestionPanelState(edited, {
    interactionKey: "request-1",
    questions: reordered,
  });
  assert.equal(next.currentIndex, 1);
  assert.equal(next.drafts.length, reordered.length);
  assert.equal(next.drafts[1]?.custom, "Keep this");
  assert.deepEqual(next.drafts[2], { selected: [], custom: "" });
});

test("removing the active question selects a valid remaining page and discards removed validation", () => {
  const initial = createQuestionPanelState({
    interactionKey: "request-1",
    questions,
    progress: { currentIndex: 2, answers: [] },
  });
  const next = reconcileQuestionPanelState(
    { ...initial, validationIndex: 2 },
    {
      interactionKey: "request-1",
      questions: questions.slice(0, 1),
    },
  );
  assert.equal(next.currentIndex, 0);
  assert.equal(next.drafts.length, 1);
  assert.equal(next.validationIndex, undefined);
});

test("replacing a question definition cannot inherit an answer to its previous definition", () => {
  const initial = createQuestionPanelState({ interactionKey: "request-1", questions });
  const edited = { ...initial, drafts: setQuestionCustomAnswer(initial.drafts, 0, "Old answer") };
  const next = reconcileQuestionPanelState(edited, {
    interactionKey: "request-1",
    questions: [{ ...questions[0]!, question: "Different question" }],
  });
  assert.deepEqual(next.drafts[0], { selected: [], custom: "" });
});
