import assert from "node:assert/strict";
import test from "node:test";

import type { WorkbenchInteractionQuestion } from "@workbench/agent-runtime-contracts/runtime-capabilities";

import {
  buildQuestionAnswers,
  canSubmitQuestionAnswers,
  createQuestionAnswerDrafts,
  findFirstInvalidQuestionIndex,
  selectQuestionOption,
  setQuestionCustomAnswer,
  skipQuestion,
  type AskUserQuestion,
} from "./interaction-form-state";

const questions = [
  {
    id: "target",
    question: "Target",
    options: [{ label: "Code" }, { label: "Docs" }],
    allowCustom: true,
  },
  {
    id: "features",
    question: "Features",
    options: [{ label: "Search" }, { label: "Export" }],
    multiSelect: true,
  },
  { id: "note", question: "Note" },
] satisfies WorkbenchInteractionQuestion[];

test("builds ordered wire answers for single, multiple, and free-text questions", () => {
  let drafts = createQuestionAnswerDrafts(questions);
  drafts = selectQuestionOption(drafts, questions, 0, "Code", true);
  drafts = selectQuestionOption(drafts, questions, 0, "Docs", true);
  drafts = selectQuestionOption(drafts, questions, 1, "Search", true);
  drafts = selectQuestionOption(drafts, questions, 1, "Export", true);
  drafts = setQuestionCustomAnswer(drafts, 0, "Keep generated files out of scope");
  drafts = setQuestionCustomAnswer(drafts, 2, "Ship it");

  assert.equal(canSubmitQuestionAnswers(questions, drafts), true);
  assert.deepEqual(buildQuestionAnswers(questions, drafts), [
    {
      id: "target",
      selected: ["Docs"],
      custom: "Keep generated files out of scope",
    },
    { id: "features", selected: ["Search", "Export"] },
    { id: "note", selected: [], custom: "Ship it" },
  ]);
});

test("toggles multi-select values without mutating earlier drafts", () => {
  const initial = createQuestionAnswerDrafts(questions);
  const selected = selectQuestionOption(initial, questions, 1, "Search", true);
  const cleared = selectQuestionOption(selected, questions, 1, "Search", false);

  assert.deepEqual(initial[1]?.selected, []);
  assert.deepEqual(selected[1]?.selected, ["Search"]);
  assert.deepEqual(cleared[1]?.selected, []);
});

test("allows a custom answer to satisfy a required choice question", () => {
  const drafts = createQuestionAnswerDrafts(questions);
  assert.equal(canSubmitQuestionAnswers(questions, drafts), false);

  const custom = setQuestionCustomAnswer(drafts, 0, "Tests only");
  assert.equal(canSubmitQuestionAnswers(questions, custom), true);
  assert.deepEqual(buildQuestionAnswers(questions, custom), [
    { id: "target", selected: [], custom: "Tests only" },
    { id: "features", selected: [] },
    { id: "note", selected: [], custom: "" },
  ]);

  const ignored = selectQuestionOption(custom, questions, 0, "Unknown", true);
  assert.deepEqual(ignored, custom);
});

test("finds the first unanswered required question", () => {
  const requiredQuestions = [
    {
      id: "scope",
      question: "Scope",
      options: [{ label: "Code" }, { label: "Docs" }],
    },
    {
      id: "features",
      question: "Features",
      options: [{ label: "Search" }, { label: "Export" }],
      multiSelect: true,
      required: true,
    },
    { id: "note", question: "Note", required: true },
  ] satisfies AskUserQuestion[];

  let drafts = createQuestionAnswerDrafts(requiredQuestions);
  assert.equal(findFirstInvalidQuestionIndex(requiredQuestions, drafts), 0);

  drafts = selectQuestionOption(drafts, requiredQuestions, 0, "Code", true);
  assert.equal(findFirstInvalidQuestionIndex(requiredQuestions, drafts), 1);

  drafts = selectQuestionOption(drafts, requiredQuestions, 1, "Search", true);
  assert.equal(findFirstInvalidQuestionIndex(requiredQuestions, drafts), 2);

  drafts = setQuestionCustomAnswer(drafts, 2, "  Ready  ");
  assert.equal(findFirstInvalidQuestionIndex(requiredQuestions, drafts), undefined);
  assert.equal(canSubmitQuestionAnswers(requiredQuestions, drafts), true);
});

test("skipping a required question preserves other answers and can be replaced with an answer", () => {
  const required = questions.map((question) => ({ ...question, required: true }));
  let drafts = createQuestionAnswerDrafts(required, [
    { id: "target", selected: ["Code"] },
    { id: "note", selected: [], custom: "Keep this" },
  ]);
  drafts = skipQuestion(drafts, 1);
  assert.equal(canSubmitQuestionAnswers(required, drafts), true);
  const answers = buildQuestionAnswers(required, drafts);
  assert.deepEqual(answers[1], { id: "features", selected: [], skipped: true });
  assert.deepEqual(answers[0]?.selected, ["Code"]);
  assert.equal(answers[2]?.custom, "Keep this");
  assert.deepEqual(createQuestionAnswerDrafts(required, answers), drafts);
  drafts = selectQuestionOption(drafts, required, 1, "Search", true);
  assert.equal(drafts[1]?.skipped, undefined);
  drafts = skipQuestion(drafts, 2);
  drafts = setQuestionCustomAnswer(drafts, 2, "Changed my mind");
  assert.equal(drafts[2]?.skipped, undefined);
});
