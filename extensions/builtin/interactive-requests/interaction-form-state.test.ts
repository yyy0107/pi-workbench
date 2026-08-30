import assert from "node:assert/strict";
import test from "node:test";

import type { QuestionItem } from "@/workbench/runtime-contributions/pi/protocol/stream";

import {
  buildQuestionAnswers,
  canSubmitQuestionAnswers,
  createQuestionAnswerDrafts,
  findFirstInvalidQuestionIndex,
  selectQuestionOption,
  setQuestionCustomAnswer,
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
] satisfies QuestionItem[];

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
