import type { WorkbenchPendingInteraction } from "@workbench/agent-runtime-contracts/runtime-capabilities";

export type QuestionInteraction = Extract<WorkbenchPendingInteraction, { kind: "question" }>;

export const QUESTION_HANDOFF_TIMEOUT_MS = 750;

interface QuestionGroup {
  /** Keep the first runtime request as the identity of this particular question flow. */
  initialRequestId: string;
  question: QuestionInteraction;
  phase: "active" | "waiting" | "exiting";
  expectedIndex?: number;
}

export interface QuestionPresence {
  owner: object | undefined;
  sessionId: string | undefined;
  scopeRevision: number;
  /** Invalidates asynchronous callbacks when the flow or its phase changes. */
  revision: number;
  currentQuestion: QuestionInteraction | undefined;
  group: QuestionGroup | undefined;
}

function openGroup(question: QuestionInteraction | undefined): QuestionGroup | undefined {
  return question ? { initialRequestId: question.requestId, question, phase: "active" } : undefined;
}

function scopedQuestion(
  owner: object | undefined,
  sessionId: string | undefined,
  question: QuestionInteraction | undefined,
): QuestionInteraction | undefined {
  return owner && sessionId && question?.sessionId === sessionId ? question : undefined;
}

export function createQuestionPresence(
  owner: object | undefined,
  sessionId: string | undefined,
  question: QuestionInteraction | undefined,
): QuestionPresence {
  const currentQuestion = scopedQuestion(owner, sessionId, question);
  return {
    owner,
    sessionId,
    scopeRevision: 0,
    revision: 0,
    currentQuestion,
    group: openGroup(currentQuestion),
  };
}

function isContinuation(group: QuestionGroup, current: QuestionInteraction): boolean {
  return (
    group.expectedIndex !== undefined &&
    current.progress?.currentIndex === group.expectedIndex &&
    current.sessionId === group.question.sessionId &&
    // The protocol has no question-flow ID. Match the expected progress and the complete
    // question schema only during an explicit handoff, never merely by reused question IDs.
    JSON.stringify(current.questions) === JSON.stringify(group.question.questions)
  );
}

export function reconcileQuestionPresence(
  state: QuestionPresence,
  owner: object | undefined,
  sessionId: string | undefined,
  question: QuestionInteraction | undefined,
): QuestionPresence {
  const currentQuestion = scopedQuestion(owner, sessionId, question);
  if (state.owner !== owner || state.sessionId !== sessionId) {
    return {
      ...createQuestionPresence(owner, sessionId, currentQuestion),
      scopeRevision: state.scopeRevision + 1,
      revision: state.revision + 1,
    };
  }

  const group = state.group;
  if (!group) {
    if (!currentQuestion && !state.currentQuestion) return state;
    return {
      ...state,
      currentQuestion,
      group: openGroup(currentQuestion),
      revision: state.revision + 1,
    };
  }

  let nextGroup = group;
  if (currentQuestion?.requestId === group.question.requestId) {
    if (currentQuestion !== group.question || group.phase !== "active") {
      nextGroup = { ...group, question: currentQuestion, phase: "active" };
    }
  } else if (
    currentQuestion &&
    group.phase !== "exiting" &&
    isContinuation(group, currentQuestion)
  ) {
    nextGroup = { ...group, question: currentQuestion, phase: "active", expectedIndex: undefined };
  } else {
    const phase =
      !currentQuestion && group.expectedIndex !== undefined && group.phase !== "exiting"
        ? "waiting"
        : "exiting";
    if (group.phase !== phase)
      nextGroup = { ...group, phase, ...(phase === "exiting" ? { expectedIndex: undefined } : {}) };
  }

  if (nextGroup === group && currentQuestion === state.currentQuestion) return state;
  const changedFlow =
    nextGroup.phase !== group.phase || nextGroup.question.requestId !== group.question.requestId;
  return {
    ...state,
    currentQuestion,
    group: nextGroup,
    revision: state.revision + (changedFlow ? 1 : 0),
  };
}

export function expectQuestionContinuation(
  state: QuestionPresence,
  scopeRevision: number,
  requestId: string,
  index: number | undefined,
): QuestionPresence {
  const group = state.group;
  if (
    state.scopeRevision !== scopeRevision ||
    !group ||
    group.question.requestId !== requestId ||
    group.phase === "exiting" ||
    group.expectedIndex === index
  )
    return state;

  return {
    ...state,
    revision: state.revision + 1,
    group: {
      ...group,
      expectedIndex: index,
      phase: group.phase === "waiting" && index === undefined ? "exiting" : group.phase,
    },
  };
}

export function expireQuestionContinuation(
  state: QuestionPresence,
  revision: number,
): QuestionPresence {
  if (state.revision !== revision || state.group?.phase !== "waiting") return state;
  return {
    ...state,
    revision: state.revision + 1,
    group: { ...state.group, phase: "exiting", expectedIndex: undefined },
  };
}

export function completeQuestionExit(state: QuestionPresence, revision: number): QuestionPresence {
  if (state.revision !== revision || state.group?.phase !== "exiting") return state;
  return { ...state, revision: state.revision + 1, group: openGroup(state.currentQuestion) };
}
