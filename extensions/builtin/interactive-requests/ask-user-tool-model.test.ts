import assert from "node:assert/strict";
import test from "node:test";

import {
  areAskUserQuestionsReady,
  askUserQuestionCount,
  readAskUserToolRecord,
} from "./ask-user-tool-model";

const args = {
  questions: [
    {
      id: "scope",
      header: "Scope",
      question: "Which scope should be used?",
      options: [{ label: "Current task", description: "Only this task", recommended: true }],
    },
    {
      id: "note",
      question: "Anything else?",
      required: false,
    },
  ],
};

test("reads questions from streaming ask_user arguments", () => {
  const record = readAskUserToolRecord(args, undefined);

  assert.equal(askUserQuestionCount(args), 2);
  assert.equal(areAskUserQuestionsReady(args), true);
  assert.equal(areAskUserQuestionsReady(args, undefined, '{"questions":['), false);
  assert.deepEqual(record.questions, args.questions);
  assert.equal(record.answers.size, 0);
  assert.equal(record.cancelled, false);
  assert.equal(record.disabled, false);
});

test("prefers normalized result details and indexes submitted answers", () => {
  const record = readAskUserToolRecord(args, {
    text: "The user submitted these answers",
    details: {
      questions: args.questions.map((question) => ({
        ...question,
        multiSelect: false,
        required: question.id === "scope",
      })),
      answers: [
        { id: "scope", selected: ["Current task"] },
        { id: "note", selected: [], custom: "Keep the diff small." },
      ],
      cancelled: false,
    },
  });

  assert.equal(record.questions[0]?.required, true);
  assert.deepEqual(record.answers.get("scope"), {
    id: "scope",
    selected: ["Current task"],
  });
  assert.deepEqual(record.answers.get("note"), {
    id: "note",
    selected: [],
    custom: "Keep the diff small.",
  });
});

test("keeps the record readable for cancelled, disabled, and partial payloads", () => {
  const record = readAskUserToolRecord(
    { questions: [{ id: "partial" }, { id: "valid", question: "Ready?" }] },
    { details: { answers: [], cancelled: true, disabled: true } },
  );

  assert.equal(askUserQuestionCount({ questions: [{ id: "partial" }] }), 1);
  assert.equal(areAskUserQuestionsReady({ questions: [{ id: "partial" }] }), false);
  assert.deepEqual(
    record.questions.map((question) => question.question),
    ["Ready?"],
  );
  assert.equal(record.cancelled, true);
  assert.equal(record.disabled, true);
});
