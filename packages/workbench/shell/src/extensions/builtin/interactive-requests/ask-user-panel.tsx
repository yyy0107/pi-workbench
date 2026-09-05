"use client";

import {
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleIcon,
  LoaderCircleIcon,
  PencilLineIcon,
  XIcon,
} from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@workbench/shell/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@workbench/shell/ui";
import { Textarea } from "@workbench/shell/ui";
import { useI18n } from "@workbench/shell/i18n";
import { cn } from "@workbench/shell/utils";

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
import { AskUserRecommendedMark } from "./ask-user-recommended-mark";

interface AskUserPanelProps {
  questions: readonly AskUserQuestion[];
  disabled?: boolean;
  error?: ReactNode;
  formatOptionLabel?(question: AskUserQuestion, label: string): string;
  onCancel(): void;
  onSubmit(answers: readonly AskUserAnswer[]): void;
}

const answerOptionClassName =
  "group focus-within:ring-ring/50 flex min-h-[var(--button-height-large)] cursor-pointer items-start gap-3 rounded-[var(--radius-xl)] border border-transparent px-3 py-2.5 text-start transition-[border-color,background-color,box-shadow] hover:bg-muted/60 focus-within:ring-2 has-checked:border-border/70 has-checked:bg-muted has-disabled:cursor-not-allowed has-disabled:opacity-60";

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
    <div className="flex shrink-0 items-center gap-0.5 whitespace-nowrap">
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
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          type="button"
          disabled={disabled}
          aria-label={t("extensions.interactiveRequests.navigator.open", {
            current: currentIndex + 1,
            total: questions.length,
          })}
          className="hover:bg-muted focus-visible:ring-ring/50 inline-flex h-[var(--button-height-default)] items-center gap-1 rounded-[var(--button-radius)] px-1.5 text-xs font-medium outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50"
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
                    "focus-visible:ring-ring/50 flex min-h-[var(--button-height-default)] w-full items-center gap-2 rounded-[var(--button-radius)] px-2 pt-[var(--button-content-padding-block-start)] pb-[var(--button-content-padding-block-end)] text-start text-sm leading-[var(--control-text-line-height)]! outline-none transition-colors focus-visible:ring-3",
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
                      <CircleIcon className="size-[var(--icon-size-md)] fill-current text-primary" />
                    ) : (
                      <CircleIcon className="text-muted-foreground size-[var(--icon-size-md)]" />
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
}: {
  question: AskUserQuestion;
  questionIndex: number;
  draft: QuestionAnswerDraft;
  disabled: boolean;
  groupName: string;
  questionLabelId: string;
  formatOptionLabel(question: AskUserQuestion, label: string): string;
  onOptionChange(label: string, checked: boolean): void;
}) {
  const { t } = useI18n();
  const options = question.options ?? [];

  if (options.length === 0) return null;

  return (
    <fieldset
      className="max-h-72 space-y-1 overflow-y-auto overscroll-contain pe-1 [scrollbar-gutter:stable]"
      disabled={disabled}
      aria-labelledby={questionLabelId}
    >
      <legend className="sr-only">{question.question}</legend>
      {options.map((option, optionIndex) => {
        const checked = draft.selected.includes(option.label);
        const displayLabel = formatOptionLabel(question, option.label);
        return (
          <label key={`${option.label}:${optionIndex}`} className={answerOptionClassName}>
            <input
              type={question.multiSelect ? "checkbox" : "radio"}
              name={`${groupName}-${questionIndex}`}
              value={option.label}
              checked={checked}
              className="sr-only"
              onChange={(event) => onOptionChange(option.label, event.currentTarget.checked)}
            />
            <span
              aria-hidden="true"
              className="text-muted-foreground bg-background/70 flex size-[var(--button-height-large)] shrink-0 items-center justify-center rounded-full border border-border/70 text-sm font-medium tabular-nums"
            >
              {t("extensions.interactiveRequests.navigator.index", { index: optionIndex + 1 })}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold leading-5">
                <span className="min-w-0" title={displayLabel}>
                  {displayLabel}
                </span>
                {option.recommended ? <AskUserRecommendedMark /> : null}
              </span>
              {option.description ? (
                <span className="text-muted-foreground block text-xs leading-4">
                  {option.description}
                </span>
              ) : null}
            </span>
            <span
              aria-hidden="true"
              className={cn(
                "text-muted-foreground mt-2 flex size-5 shrink-0 items-center justify-center transition-opacity",
                checked ? "opacity-100" : "opacity-0 group-hover:opacity-40",
              )}
            >
              {question.multiSelect ? (
                <CheckIcon className="size-4" />
              ) : (
                <ChevronRightIcon className="size-5" />
              )}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

function CustomAnswerControl({
  question,
  questionIndex,
  draft,
  disabled,
  groupName,
  questionLabelId,
  invalid,
  validationId,
  onCustomChange,
}: {
  question: AskUserQuestion;
  questionIndex: number;
  draft: QuestionAnswerDraft;
  disabled: boolean;
  groupName: string;
  questionLabelId: string;
  invalid: boolean;
  validationId: string;
  onCustomChange(value: string): void;
}) {
  const { t } = useI18n();
  const hasOptions = (question.options?.length ?? 0) > 0;
  if (hasOptions && !question.allowCustom) return null;

  const customInputId = `${groupName}-${questionIndex}-custom`;
  const customLabelId = `${customInputId}-label`;
  const label = hasOptions
    ? t("extensions.interactiveRequests.customAnswerLabel")
    : t("extensions.interactiveRequests.answerLabel", { question: question.question });

  return (
    <div className="flex min-w-0 flex-1 items-end gap-2.5 ps-3">
      <span
        aria-hidden="true"
        className="text-muted-foreground bg-muted flex size-[var(--button-height-large)] shrink-0 items-center justify-center rounded-full border border-border/70"
      >
        <PencilLineIcon className="size-[var(--icon-size-md)]" />
      </span>
      <div className="min-w-0 flex-1">
        <label id={customLabelId} htmlFor={customInputId} className="sr-only">
          {label}
        </label>
        <Textarea
          id={customInputId}
          rows={1}
          value={draft.custom}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? validationId : undefined}
          aria-labelledby={`${questionLabelId} ${customLabelId}`}
          placeholder={t(
            hasOptions
              ? "extensions.interactiveRequests.customAnswerPlaceholder"
              : "extensions.interactiveRequests.answerPlaceholder",
          )}
          className="min-h-[var(--button-height-large)] max-h-28 resize-y px-3 py-2 text-sm leading-5"
          onChange={(event) => onCustomChange(event.currentTarget.value)}
        />
      </div>
    </div>
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
      aria-labelledby={questionLabelId}
      aria-busy={disabled}
      data-slot="ask-user-panel"
      className="bg-background flex min-h-[196px] w-full flex-col overflow-hidden rounded-[var(--radius-xl)] border border-border shadow-sm"
    >
      <header className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 sm:px-5 sm:pt-5">
        <div
          key={currentIndex}
          className={cn(
            "min-w-0 flex-1 animate-in fade-in duration-150 motion-reduce:animate-none",
            direction === "forward" ? "slide-in-from-right-1" : "slide-in-from-left-1",
          )}
        >
          {question.header ? (
            <p className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
              {question.header}
            </p>
          ) : null}
          <h2
            ref={headingRef}
            id={questionLabelId}
            tabIndex={-1}
            className="text-base font-semibold leading-6 outline-none sm:text-lg"
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
          </h2>
          {question.detail ? (
            <p className="text-muted-foreground mt-1 text-[13px] leading-5">{question.detail}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <QuestionNavigator
            questions={questions}
            drafts={drafts}
            currentIndex={currentIndex}
            disabled={disabled}
            onNavigate={navigate}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-label={t("extensions.interactiveRequests.cancel")}
            onClick={onCancel}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </div>
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
        <div className="min-h-0 flex-1 px-3 pb-2 sm:px-4">
          <div
            key={currentIndex}
            className={cn(
              "animate-in fade-in duration-150 motion-reduce:animate-none",
              direction === "forward" ? "slide-in-from-right-1" : "slide-in-from-left-1",
            )}
          >
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
            />
          </div>
        </div>

        <div className="mt-auto px-3 pt-2 pb-3 sm:px-4 sm:pb-4">
          {validationError ? (
            <p id={validationId} role="alert" className="mb-2 text-sm text-destructive">
              {t("extensions.interactiveRequests.validation.missingRequired")}
            </p>
          ) : null}
          {error ? (
            <div role="alert" className="mb-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-end">
            <CustomAnswerControl
              question={question}
              questionIndex={currentIndex}
              draft={draft}
              disabled={disabled}
              groupName={id}
              questionLabelId={questionLabelId}
              invalid={validationError}
              validationId={validationId}
              onCustomChange={(value) => {
                setValidationError(false);
                setDrafts((current) => setQuestionCustomAnswer(current, currentIndex, value));
              }}
            />
            <div className="flex shrink-0 items-center justify-end gap-2">
              {question.multiSelect ? (
                <span className="text-muted-foreground text-xs" aria-live="polite">
                  {t("extensions.interactiveRequests.selectedCount", {
                    count: draft.selected.length,
                  })}
                </span>
              ) : null}
              <Button
                type="submit"
                variant="outline"
                size="lg"
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
        </div>
      </form>
    </section>
  );
}
