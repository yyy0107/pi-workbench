import type { AskUserAnswer, AskUserQuestion } from "./interaction-form-state";

export interface AskUserToolRecord {
  readonly questions: readonly AskUserQuestion[];
  readonly answers: ReadonlyMap<string, AskUserAnswer>;
  readonly cancelled: boolean;
  readonly disabled: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function parseQuestion(value: unknown, index: number): AskUserQuestion | undefined {
  const candidate = asRecord(value);
  const question = asString(candidate?.question);
  if (!candidate || !question) return undefined;

  const options = Array.isArray(candidate.options)
    ? candidate.options.flatMap((value) => {
        const option = asRecord(value);
        const label = asString(option?.label);
        if (!option || !label) return [];
        const description = asString(option.description);
        return [
          {
            label,
            ...(description ? { description } : {}),
            ...(typeof option.recommended === "boolean" ? { recommended: option.recommended } : {}),
          },
        ];
      })
    : undefined;
  const id = asString(candidate.id) ?? `question-${index + 1}`;
  const header = asString(candidate.header);
  const detail = asString(candidate.detail);

  return {
    id,
    question,
    ...(header ? { header } : {}),
    ...(detail ? { detail } : {}),
    ...(options?.length ? { options } : {}),
    ...(typeof candidate.multiSelect === "boolean" ? { multiSelect: candidate.multiSelect } : {}),
    ...(typeof candidate.required === "boolean" ? { required: candidate.required } : {}),
  };
}

function parseQuestions(value: unknown): AskUserQuestion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((question, index) => {
    const parsed = parseQuestion(question, index);
    return parsed ? [parsed] : [];
  });
}

function questionsAreComplete(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;

  return value.every((question) => {
    const candidate = asRecord(question);
    if (!candidate || !asString(candidate.id) || !asString(candidate.question)) return false;
    if (candidate.options === undefined) return true;
    if (!Array.isArray(candidate.options) || candidate.options.length === 0) return false;

    return candidate.options.every((value) => {
      const option = asRecord(value);
      if (!option) return false;
      return Boolean(
        asString(option.label) &&
        (option.description === undefined || typeof option.description === "string") &&
        (option.recommended === undefined || typeof option.recommended === "boolean"),
      );
    });
  });
}

function parseAnswer(value: unknown): AskUserAnswer | undefined {
  const candidate = asRecord(value);
  const id = asString(candidate?.id);
  if (!candidate || !id) return undefined;

  const selected = Array.isArray(candidate.selected)
    ? candidate.selected.filter((item): item is string => typeof item === "string")
    : [];

  return {
    id,
    selected,
    ...(typeof candidate.custom === "string" ? { custom: candidate.custom } : {}),
  };
}

function resultDetails(result: unknown): Record<string, unknown> | undefined {
  const candidate = asRecord(result);
  return asRecord(candidate?.details) ?? candidate;
}

export function readAskUserToolRecord(args: unknown, result: unknown): AskUserToolRecord {
  const argumentQuestions = parseQuestions(asRecord(args)?.questions);
  const details = resultDetails(result);
  const resultQuestions = parseQuestions(details?.questions);
  const answers = new Map<string, AskUserAnswer>();

  if (Array.isArray(details?.answers)) {
    for (const value of details.answers) {
      const answer = parseAnswer(value);
      if (answer) answers.set(answer.id, answer);
    }
  }

  return {
    questions: resultQuestions.length > 0 ? resultQuestions : argumentQuestions,
    answers,
    cancelled: details?.cancelled === true,
    disabled: details?.disabled === true,
  };
}

export function askUserQuestionCount(args: unknown, result?: unknown): number {
  const record = readAskUserToolRecord(args, result);
  if (record.questions.length > 0) return record.questions.length;

  const rawQuestions = asRecord(args)?.questions;
  return Array.isArray(rawQuestions) ? rawQuestions.length : 0;
}

export function areAskUserQuestionsReady(
  args: unknown,
  result?: unknown,
  argsText?: string,
): boolean {
  const details = resultDetails(result);
  if (Array.isArray(details?.questions)) return questionsAreComplete(details.questions);

  if (argsText?.trim()) {
    try {
      return questionsAreComplete(asRecord(JSON.parse(argsText))?.questions);
    } catch {
      return false;
    }
  }

  return questionsAreComplete(asRecord(args)?.questions);
}
