import type {
  WorkbenchInteractionQuestion,
  WorkbenchInteractionAnswer,
} from "@workbench/agent-runtime-contracts/runtime-capabilities";

export type AskUserQuestion = WorkbenchInteractionQuestion;
export type AskUserAnswer = WorkbenchInteractionAnswer;

export interface QuestionAnswerDraft {
  readonly selected: readonly string[];
  readonly custom: string;
}

export function createQuestionAnswerDrafts(
  questions: readonly AskUserQuestion[],
): QuestionAnswerDraft[] {
  return questions.map(() => ({ selected: [], custom: "" }));
}

function replaceDraft(
  drafts: readonly QuestionAnswerDraft[],
  index: number,
  next: QuestionAnswerDraft,
): QuestionAnswerDraft[] {
  if (index < 0 || index >= drafts.length) return [...drafts];
  return drafts.map((draft, draftIndex) => (draftIndex === index ? next : draft));
}

export function selectQuestionOption(
  drafts: readonly QuestionAnswerDraft[],
  questions: readonly AskUserQuestion[],
  index: number,
  label: string,
  checked: boolean,
): QuestionAnswerDraft[] {
  const question = questions[index];
  const draft = drafts[index];
  if (!question || !draft || !question.options?.some((option) => option.label === label)) {
    return [...drafts];
  }

  if (!question.multiSelect) {
    return replaceDraft(drafts, index, { ...draft, selected: checked ? [label] : [] });
  }

  const selected = checked
    ? draft.selected.includes(label)
      ? [...draft.selected]
      : [...draft.selected, label]
    : draft.selected.filter((candidate) => candidate !== label);
  return replaceDraft(drafts, index, { ...draft, selected });
}

export function setQuestionCustomAnswer(
  drafts: readonly QuestionAnswerDraft[],
  index: number,
  custom: string,
): QuestionAnswerDraft[] {
  const draft = drafts[index];
  if (!draft) return [...drafts];
  return replaceDraft(drafts, index, { ...draft, custom });
}

export function canSubmitQuestionAnswers(
  questions: readonly AskUserQuestion[],
  drafts: readonly QuestionAnswerDraft[],
): boolean {
  return findFirstInvalidQuestionIndex(questions, drafts) === undefined;
}

export function isQuestionAnswered(
  question: AskUserQuestion,
  draft: QuestionAnswerDraft | undefined,
): boolean {
  if (!draft) return false;
  return (question.options?.length ?? 0) > 0
    ? draft.selected.length > 0 || (question.allowCustom === true && draft.custom.trim().length > 0)
    : draft.custom.trim().length > 0;
}

function isQuestionValid(
  question: AskUserQuestion,
  draft: QuestionAnswerDraft | undefined,
): boolean {
  if (!draft) return false;

  const options = question.options ?? [];
  if (options.length === 0) {
    return !question.required || draft.custom.trim().length > 0;
  }

  const optionLabels = new Set(options.map((option) => option.label));
  if (draft.selected.some((label) => !optionLabels.has(label))) return false;
  if (!question.multiSelect && draft.selected.length > 1) return false;

  const required = question.required ?? !question.multiSelect;
  const hasCustomAnswer = question.allowCustom === true && draft.custom.trim().length > 0;
  return !required || draft.selected.length > 0 || hasCustomAnswer;
}

export function findFirstInvalidQuestionIndex(
  questions: readonly AskUserQuestion[],
  drafts: readonly QuestionAnswerDraft[],
): number | undefined {
  if (questions.length === 0 || drafts.length !== questions.length) return 0;

  const index = questions.findIndex((question, questionIndex) =>
    isQuestionValid(question, drafts[questionIndex]) ? false : true,
  );
  return index >= 0 ? index : undefined;
}

export function buildQuestionAnswers(
  questions: readonly AskUserQuestion[],
  drafts: readonly QuestionAnswerDraft[],
): AskUserAnswer[] {
  return questions.map((question, index) => {
    const draft = drafts[index] ?? { selected: [], custom: "" };
    return {
      id: question.id,
      selected: [...draft.selected],
      ...((question.options?.length ?? 0) === 0 || question.allowCustom
        ? { custom: draft.custom }
        : {}),
    };
  });
}
