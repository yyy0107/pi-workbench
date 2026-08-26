"use client";

import {
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleIcon,
  LoaderCircleIcon,
} from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

import {
  buildQuestionAnswers,
  createQuestionAnswerDrafts,
  findFirstInvalidQuestionIndex,
  isQuestionAnswered,
  selectQuestionOption,
  setQuestionCustomAnswer,
  type AskUserAnswer,
  type AskUserQuestion,
  type QuestionAnswerDraft,
} from "./interaction-form-state";

interface AskUserPanelProps {
  questions: readonly AskUserQuestion[];
  disabled?: boolean;
  error?: ReactNode;
  formatOptionLabel?(question: AskUserQuestion, label: string): string;
  onCancel(): void;
  onSubmit(answers: readonly AskUserAnswer[]): void;
}

function isRequired(question: AskUserQuestion): boolean {
  const hasOptions = (question.options?.length ?? 0) > 0;
  return question.required ?? (hasOptions && !question.multiSelect);
}

function QuestionNavigator({
  questions,
  drafts,
  currentIndex,
  disabled,
  onNavigate,
}: {
  questions: readonly AskUserQuestion[];
  drafts: readonly QuestionAnswerDraft[];
  currentIndex: number;
  disabled: boolean;
  onNavigate(index: number): void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          type="button"
          disabled={disabled}
          aria-label={t("extensions.interactiveRequests.navigator.open", {
            current: currentIndex + 1,
            total: questions.length,
          })}
          className="hover:bg-muted focus-visible:ring-ring/50 inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50"
        >
          <span aria-hidden="true">
            {t("extensions.interactiveRequests.navigator.position", {
              current: currentIndex + 1,
              total: questions.length,
            })}
          </span>
          <ChevronDownIcon aria-hidden="true" className="text-muted-foreground size-3.5" />
        </PopoverTrigger>
        <PopoverContent align="end" side="top" className="w-72 gap-1 p-1.5">
          <p className="text-muted-foreground px-2 py-1 text-xs font-medium">
            {t("extensions.interactiveRequests.navigator.title")}
          </p>
          <div className="max-h-64 overflow-y-auto">
            {questions.map((question, index) => {
              const answered = isQuestionAnswered(question, drafts[index]);
              const current = index === currentIndex;
              return (
                <button
                  key={`${question.id}:${index}`}
                  type="button"
                  aria-current={current ? "step" : undefined}
                  className={cn(
                    "focus-visible:ring-ring/50 flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-start text-sm outline-none transition-colors focus-visible:ring-3",
                    current ? "bg-accent text-accent-foreground" : "hover:bg-muted/70",
                  )}
                  onClick={() => {
                    setOpen(false);
                    onNavigate(index);
                  }}
                >
                  <span
                    className="flex size-5 shrink-0 items-center justify-center"
                    aria-hidden="true"
                  >
                    {answered ? (
                      <CheckIcon className="size-4 text-emerald-600 dark:text-emerald-400" />
                    ) : current ? (
                      <CircleIcon className="size-3 fill-current text-primary" />
                    ) : (
                      <CircleIcon className="text-muted-foreground size-3" />
                    )}
                  </span>
                  <span className="text-muted-foreground w-4 shrink-0 text-xs tabular-nums">
                    {t("extensions.interactiveRequests.navigator.index", { index: index + 1 })}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {question.header ?? question.question}
                  </span>
                  <span className="sr-only">
                    {answered
                      ? t("extensions.interactiveRequests.navigator.answered")
                      : t("extensions.interactiveRequests.navigator.unanswered")}
                  </span>
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={disabled || currentIndex === 0}
        aria-label={t("extensions.interactiveRequests.navigator.previous")}
        onClick={() => onNavigate(currentIndex - 1)}
      >
        <ChevronLeftIcon aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={disabled || currentIndex === questions.length - 1}
        aria-label={t("extensions.interactiveRequests.navigator.next")}
        onClick={() => onNavigate(currentIndex + 1)}
      >
        <ChevronRightIcon aria-hidden="true" />
      </Button>
    </div>
  );
}

function QuestionControl({
  question,
  questionIndex,
  draft,
  disabled,
  groupName,
  questionLabelId,
  formatOptionLabel,
  onOptionChange,
  onCustomChange,
}: {
  question: AskUserQuestion;
  questionIndex: number;
  draft: QuestionAnswerDraft;
  disabled: boolean;
  groupName: string;
  questionLabelId: string;
  formatOptionLabel(question: AskUserQuestion, label: string): string;
  onOptionChange(label: string, checked: boolean): void;
  onCustomChange(value: string): void;
}) {
  const { t } = useI18n();
  const options = question.options ?? [];

  if (options.length === 0) {
    return (
      <Textarea
        value={draft.custom}
        disabled={disabled}
        aria-labelledby={questionLabelId}
        placeholder={t("extensions.interactiveRequests.answerPlaceholder")}
        className="min-h-24 resize-y rounded-xl bg-background/70"
        onChange={(event) => onCustomChange(event.currentTarget.value)}
      />
    );
  }

  return (
    <fieldset className="space-y-2" disabled={disabled} aria-labelledby={questionLabelId}>
      <legend className="sr-only">{question.question}</legend>
      {options.map((option, optionIndex) => {
        const checked = draft.selected.includes(option.label);
        return (
          <label
            key={`${option.label}:${optionIndex}`}
            className="has-checked:border-primary/45 has-checked:bg-primary/5 focus-within:ring-ring/50 flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border bg-background/55 px-3 py-2.5 transition-[border-color,background-color,box-shadow] focus-within:ring-3 has-disabled:cursor-not-allowed has-disabled:opacity-60"
          >
            <input
              type={question.multiSelect ? "checkbox" : "radio"}
              name={`${groupName}-${questionIndex}`}
              value={option.label}
              checked={checked}
              className="mt-0.5 size-4 shrink-0 accent-primary outline-none"
              onChange={(event) => onOptionChange(option.label, event.currentTarget.checked)}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">
                {formatOptionLabel(question, option.label)}
              </span>
              {option.description ? (
                <span className="text-muted-foreground mt-0.5 block text-xs leading-5">
                  {option.description}
                </span>
              ) : null}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

export function AskUserPanel({
  questions,
  disabled = false,
  error,
  formatOptionLabel = (_question, label) => label,
  onCancel,
  onSubmit,
}: AskUserPanelProps) {
  const { t } = useI18n();
  const id = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [drafts, setDrafts] = useState(() => createQuestionAnswerDrafts(questions));
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState<"backward" | "forward">("forward");
  const [validationError, setValidationError] = useState(false);
  const question = questions[currentIndex];
  const draft = drafts[currentIndex];

  useLayoutEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [currentIndex]);

  if (!question || !draft) return null;

  const questionLabelId = `${id}-question`;
  const validationId = `${id}-validation`;
  const lastQuestion = currentIndex === questions.length - 1;

  const navigate = (index: number) => {
    if (index < 0 || index >= questions.length || index === currentIndex) return;
    setDirection(index < currentIndex ? "backward" : "forward");
    setCurrentIndex(index);
  };

  const submit = () => {
    const firstInvalid = findFirstInvalidQuestionIndex(questions, drafts);
    if (firstInvalid !== undefined) {
      setValidationError(true);
      navigate(firstInvalid);
      return;
    }
    setValidationError(false);
    onSubmit(buildQuestionAnswers(questions, drafts));
  };

  return (
    <section
      role="region"
      aria-labelledby={`${id}-title`}
      aria-busy={disabled}
      data-slot="ask-user-panel"
      className="bg-background flex h-full min-h-[220px] w-full flex-col overflow-hidden rounded-[22px] border shadow-[0_2px_12px_rgba(0,0,0,0.08)]"
    >
      <header className="flex items-center justify-between gap-3 border-b px-4 py-2.5 sm:px-5">
        <h2 id={`${id}-title`} className="text-sm font-semibold">
          {t("extensions.interactiveRequests.questionTitle")}
        </h2>
        <QuestionNavigator
          questions={questions}
          drafts={drafts}
          currentIndex={currentIndex}
          disabled={disabled}
          onNavigate={navigate}
        />
      </header>

      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          if (disabled) return;
          if (lastQuestion) submit();
          else navigate(currentIndex + 1);
        }}
      >
        <div className="min-h-[156px] flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <div
            key={currentIndex}
            className={cn(
              "animate-in fade-in duration-150 motion-reduce:animate-none",
              direction === "forward" ? "slide-in-from-right-1" : "slide-in-from-left-1",
            )}
          >
            <div className="mb-4">
              {question.header ? (
                <p className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
                  {question.header}
                </p>
              ) : null}
              <h3
                ref={headingRef}
                id={questionLabelId}
                tabIndex={-1}
                className="text-base font-medium text-balance outline-none"
              >
                {question.question}
                {isRequired(question) ? (
                  <>
                    <span className="ms-1 text-destructive" aria-hidden="true">
                      *
                    </span>
                    <span className="sr-only">{t("extensions.interactiveRequests.required")}</span>
                  </>
                ) : null}
              </h3>
              {question.detail ? (
                <p className="text-muted-foreground mt-1 text-sm leading-5">{question.detail}</p>
              ) : null}
            </div>

            <QuestionControl
              question={question}
              questionIndex={currentIndex}
              draft={draft}
              disabled={disabled}
              groupName={id}
              questionLabelId={questionLabelId}
              formatOptionLabel={formatOptionLabel}
              onOptionChange={(label, checked) => {
                setValidationError(false);
                setDrafts((current) =>
                  selectQuestionOption(current, questions, currentIndex, label, checked),
                );
              }}
              onCustomChange={(value) => {
                setValidationError(false);
                setDrafts((current) => setQuestionCustomAnswer(current, currentIndex, value));
              }}
            />
          </div>
        </div>

        <div className="border-t px-3 py-2.5 sm:px-4">
          {validationError ? (
            <p id={validationId} role="alert" className="mb-2 px-1 text-sm text-destructive">
              {t("extensions.interactiveRequests.validation.missingRequired")}
            </p>
          ) : null}
          {error ? (
            <div role="alert" className="mb-2 px-1 text-sm text-destructive">
              {error}
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={onCancel}
              >
                {t("extensions.interactiveRequests.cancel")}
              </Button>
              {question.multiSelect ? (
                <span className="text-muted-foreground truncate text-xs" aria-live="polite">
                  {t("extensions.interactiveRequests.selectedCount", {
                    count: draft.selected.length,
                  })}
                </span>
              ) : null}
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={disabled}
              aria-describedby={validationError ? validationId : undefined}
            >
              {disabled ? <LoaderCircleIcon aria-hidden="true" className="animate-spin" /> : null}
              {disabled
                ? t("extensions.interactiveRequests.submitting")
                : lastQuestion
                  ? t("extensions.interactiveRequests.submitAndContinue")
                  : t("extensions.interactiveRequests.nextQuestion")}
              {!disabled ? <ChevronRightIcon aria-hidden="true" /> : null}
            </Button>
          </div>
        </div>
      </form>
    </section>
  );
}
