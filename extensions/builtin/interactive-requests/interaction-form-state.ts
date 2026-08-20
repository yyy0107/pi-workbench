import type { QuestionAnswerItem } from "@/runtime/pi/rpc-contracts";
import type { QuestionItem } from "@/runtime/pi/stream-contracts";

export interface QuestionAnswerDraft {
  readonly selected: readonly string[];
  readonly custom: string;
}

export function createQuestionAnswerDrafts(
  questions: readonly QuestionItem[],
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
  questions: readonly QuestionItem[],
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
  questions: readonly QuestionItem[],
  drafts: readonly QuestionAnswerDraft[],
): boolean {
  if (questions.length === 0 || drafts.length !== questions.length) return false;

  return questions.every((question, index) => {
    const options = question.options ?? [];
    const draft = drafts[index];
    if (!draft) return false;
    if (options.length === 0) return true;

    const optionLabels = new Set(options.map((option) => option.label));
    if (draft.selected.some((label) => !optionLabels.has(label))) return false;
    return question.multiSelect ? true : draft.selected.length === 1;
  });
}

export function buildQuestionAnswers(
  questions: readonly QuestionItem[],
  drafts: readonly QuestionAnswerDraft[],
): QuestionAnswerItem[] {
  return questions.map((question, index) => {
    const draft = drafts[index] ?? { selected: [], custom: "" };
    return {
      id: question.id,
      selected: [...draft.selected],
      ...((question.options?.length ?? 0) === 0 ? { custom: draft.custom } : {}),
    };
  });
}
