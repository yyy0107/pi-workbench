import {
  createQuestionAnswerDrafts,
  type AskUserAnswer,
  type AskUserQuestion,
  type QuestionAnswerDraft,
} from "./interaction-form-state";

export interface QuestionPanelState {
  interactionKey: string | undefined;
  questions: readonly AskUserQuestion[];
  currentIndex: number;
  drafts: readonly QuestionAnswerDraft[];
  direction?: "forward" | "backward";
  validationIndex?: number;
}

interface QuestionPanelInput {
  interactionKey?: string;
  questions: readonly AskUserQuestion[];
  progress?: { currentIndex: number; answers: readonly AskUserAnswer[] };
}

function currentQuestionIndex(input: QuestionPanelInput): number {
  const index = input.progress?.currentIndex ?? 0;
  return Number.isInteger(index) && index >= 0 && index < input.questions.length ? index : 0;
}

export function createQuestionPanelState(input: QuestionPanelInput): QuestionPanelState {
  return {
    interactionKey: input.interactionKey,
    questions: input.questions,
    currentIndex: currentQuestionIndex(input),
    drafts: createQuestionAnswerDrafts(input.questions, input.progress?.answers),
  };
}

export function navigateQuestionPanel(
  state: QuestionPanelState,
  index: number,
  questionCount: number,
): QuestionPanelState {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= questionCount ||
    index === state.currentIndex
  ) {
    return state;
  }
  return {
    ...state,
    currentIndex: index,
    direction: index < state.currentIndex ? "backward" : "forward",
  };
}

/** The overlay owns group identity; new request IDs within that group must not reset local drafts. */
export function reconcileQuestionPanelState(
  state: QuestionPanelState,
  input: QuestionPanelInput,
): QuestionPanelState {
  const sameRequest = state.interactionKey === input.interactionKey;
  const sameQuestions =
    state.questions === input.questions ||
    JSON.stringify(state.questions) === JSON.stringify(input.questions);
  if (sameRequest && sameQuestions) return state;

  const savedAnswers = new Set(input.progress?.answers.map((answer) => answer.id));
  const restoredDrafts = createQuestionAnswerDrafts(input.questions, input.progress?.answers);
  const previousQuestionId = state.questions[state.currentIndex]?.id;
  const retainedIndex = input.questions.findIndex((question) => question.id === previousQuestionId);
  const nextIndex = sameRequest && retainedIndex >= 0 ? retainedIndex : currentQuestionIndex(input);
  const validationQuestionId = state.questions[state.validationIndex ?? -1]?.id;
  const validationIndex = input.questions.findIndex(
    (question) => question.id === validationQuestionId,
  );
  return {
    ...navigateQuestionPanel(state, nextIndex, input.questions.length),
    interactionKey: input.interactionKey,
    questions: input.questions,
    currentIndex: nextIndex,
    validationIndex: validationIndex >= 0 ? validationIndex : undefined,
    drafts: restoredDrafts.map((draft, index) => {
      const question = input.questions[index]!;
      if (!sameRequest && savedAnswers.has(question.id)) return draft;
      const previousIndex = state.questions.findIndex((previous) => previous.id === question.id);
      return JSON.stringify(state.questions[previousIndex]) === JSON.stringify(question)
        ? (state.drafts[previousIndex] ?? draft)
        : draft;
    }),
  };
}
