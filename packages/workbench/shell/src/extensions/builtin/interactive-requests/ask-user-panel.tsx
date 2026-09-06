"use client";

import {
  ArrowRightIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleIcon,
  LoaderCircleIcon,
  MessageCircleQuestionMarkIcon,
  PencilLineIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

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
  skipQuestion,
  type AskUserAnswer,
  type AskUserQuestion,
  type QuestionAnswerDraft,
} from "./interaction-form-state";
import { AskUserRecommendedMark } from "./ask-user-recommended-mark";

interface AskUserPanelProps {
  questions: readonly AskUserQuestion[];
  expiresAt?: number;
  progress?: { currentIndex: number; answers: readonly AskUserAnswer[] };
  disabled?: boolean;
  error?: ReactNode;
  formatOptionLabel?(question: AskUserQuestion, label: string): string;
  onCancel(): void;
  onSubmit(answers: readonly AskUserAnswer[], nextQuestionIndex?: number): void;
}

const answerOptionClassName =
  "group/answer has-[:focus-visible]:ring-ring/50 flex min-h-[var(--button-height-default)] cursor-pointer items-center gap-2 rounded-[var(--button-radius)] px-2 py-0.5 text-start transition-colors hover:[background:var(--control-state-background-hover)] has-[:focus-visible]:ring-2 has-disabled:cursor-not-allowed has-disabled:opacity-60";

const answerMarkerClassName =
  "text-muted-foreground bg-muted flex size-[var(--button-height-compact)] shrink-0 items-center justify-center rounded-full border border-border text-xs tabular-nums";

function isRequired(question: AskUserQuestion): boolean {
  const hasOptions = (question.options?.length ?? 0) > 0;
  return question.required ?? (hasOptions && !question.multiSelect);
}

function QuestionCountdown({ expiresAt }: { expiresAt: number }) {
  const { number, t } = useI18n();
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const currentTime = Date.now();
      setNow(currentTime);
      if (currentTime >= expiresAt) window.clearInterval(timer);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1_000));
  if (seconds > 20) return null;

  return (
    <span
      role="timer"
      aria-label={t("extensions.interactiveRequests.timeoutCountdown", { seconds })}
      className="text-info-foreground text-xs tabular-nums"
    >
      {number(seconds, { style: "unit", unit: "second", unitDisplay: "narrow" })}
    </span>
  );
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
    <div className="text-muted-foreground flex shrink-0 items-center gap-0.5 whitespace-nowrap">
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
          render={<Button variant="ghost" className="px-1.5 font-normal tabular-nums" />}
        >
          <span aria-hidden="true">
            {t("extensions.interactiveRequests.navigator.position", {
              current: currentIndex + 1,
              total: questions.length,
            })}
          </span>
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
                      <CheckIcon className="size-[var(--icon-size-md)] text-success-foreground" />
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
      className="-mx-3 max-h-72 space-y-0.5 overflow-y-auto overscroll-contain p-1"
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
              onClick={() => {
                if (!question.multiSelect && checked) onOptionChange(option.label, true);
              }}
              onChange={(event) => onOptionChange(option.label, event.currentTarget.checked)}
            />
            <span aria-hidden="true" className={answerMarkerClassName}>
              {t("extensions.interactiveRequests.navigator.index", { index: optionIndex + 1 })}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-5">
                <span className="min-w-0 break-words">{displayLabel}</span>
                {option.recommended ? <AskUserRecommendedMark /> : null}
              </span>
              {option.description ? (
                <span className="text-muted-foreground mt-0.5 block text-xs leading-4">
                  {option.description}
                </span>
              ) : null}
            </span>
            <span
              aria-hidden="true"
              className={cn(
                "text-muted-foreground flex size-[var(--icon-size-md)] shrink-0 items-center justify-center transition-opacity",
                checked ? "opacity-100" : "opacity-0",
                !question.multiSelect &&
                  "group-hover/answer:opacity-100 group-has-[:focus-visible]/answer:opacity-100",
              )}
            >
              {checked || question.multiSelect ? (
                <CheckIcon className="size-[var(--icon-size-md)]" />
              ) : (
                <ArrowRightIcon className="size-[var(--icon-size-md)]" />
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
    <div
      className={cn(
        "flex min-w-0 basis-full items-start gap-2",
        hasOptions && "sm:flex-1 sm:basis-0",
      )}
    >
      <label
        id={customLabelId}
        htmlFor={customInputId}
        className={hasOptions ? cn(answerMarkerClassName, "cursor-text") : "sr-only"}
      >
        {hasOptions ? (
          <PencilLineIcon aria-hidden="true" className="size-[var(--icon-size-md)]" />
        ) : null}
        <span className="sr-only">{label}</span>
      </label>
      <div className="min-w-0 flex-1">
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
          className={cn(
            "max-h-28 resize-none text-sm leading-5",
            hasOptions
              ? "min-h-[var(--input-control-height)] border-0 px-0 py-1 [--input-control-background:transparent]"
              : "min-h-[var(--button-height-large)]",
          )}
          onChange={(event) => onCustomChange(event.currentTarget.value)}
        />
      </div>
    </div>
  );
}

export function AskUserPanel({
  questions,
  expiresAt,
  progress,
  disabled = false,
  error,
  formatOptionLabel = (_question, label) => label,
  onCancel,
  onSubmit,
}: AskUserPanelProps) {
  const { t } = useI18n();
  const id = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [drafts, setDrafts] = useState(() =>
    createQuestionAnswerDrafts(questions, progress?.answers),
  );
  const [currentIndex, setCurrentIndex] = useState(progress?.currentIndex ?? 0);
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
  const hasOptions = (question.options?.length ?? 0) > 0;
  const awaitingRequiredAnswer =
    isRequired(question) && !draft.skipped && !isQuestionAnswered(question, draft);

  const navigate = (index: number, nextDrafts = drafts) => {
    if (index < 0 || index >= questions.length || index === currentIndex) return;
    if (progress) {
      const answers = buildQuestionAnswers(questions, nextDrafts).filter(
        (_, answerIndex) =>
          nextDrafts[answerIndex]?.skipped ||
          isQuestionAnswered(questions[answerIndex]!, nextDrafts[answerIndex]),
      );
      onSubmit(answers, index);
    } else {
      setDirection(index < currentIndex ? "backward" : "forward");
      setCurrentIndex(index);
    }
  };

  const submit = (nextDrafts = drafts) => {
    const firstInvalid = findFirstInvalidQuestionIndex(questions, nextDrafts);
    if (firstInvalid !== undefined) {
      setValidationError(true);
      navigate(firstInvalid, nextDrafts);
      return;
    }
    setValidationError(false);
    onSubmit(buildQuestionAnswers(questions, nextDrafts));
  };

  const skip = () => {
    if (disabled) return;
    // Single-question SDK dialogs use cancellation as their empty/default response.
    if (!progress && questions.length === 1) return onCancel();
    const nextDrafts = skipQuestion(drafts, currentIndex);
    setDrafts(nextDrafts);
    setValidationError(false);
    if (lastQuestion) submit(nextDrafts);
    else navigate(currentIndex + 1, nextDrafts);
  };

  return (
    <section
      role="region"
      aria-labelledby={questionLabelId}
      aria-busy={disabled}
      data-slot="ask-user-panel"
      className="bg-background text-foreground flex w-full flex-col overflow-hidden rounded-[var(--composer-radius,var(--radius-3xl))] border border-border"
    >
      <header className="flex items-center justify-between gap-3 px-4 py-1 sm:px-5">
        <div className="text-muted-foreground flex min-w-0 items-center gap-2 text-sm">
          <MessageCircleQuestionMarkIcon
            aria-hidden="true"
            className="size-[var(--icon-size-lg)] shrink-0"
          />
          <span className="truncate">{t("extensions.interactiveRequests.questionTitle")}</span>
        </div>
        <div className="text-muted-foreground flex shrink-0 items-center gap-2">
          {questions.length > 1 ? (
            <QuestionNavigator
              questions={questions}
              drafts={drafts}
              currentIndex={currentIndex}
              disabled={disabled}
              onNavigate={navigate}
            />
          ) : null}
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
          if (disabled || awaitingRequiredAnswer) return;
          if (lastQuestion) submit();
          else navigate(currentIndex + 1);
        }}
      >
        <div className="min-h-0 flex-1 px-4 sm:px-5">
          <div
            key={currentIndex}
            className={cn(
              "animate-in fade-in duration-150 motion-reduce:animate-none",
              direction === "forward" ? "slide-in-from-right-1" : "slide-in-from-left-1",
            )}
          >
            {question.header ? (
              <p className="text-muted-foreground mb-1 text-xs">{question.header}</p>
            ) : null}
            <h2
              ref={headingRef}
              id={questionLabelId}
              tabIndex={-1}
              className="text-base font-medium leading-6 outline-none"
            >
              {question.question}
              {isRequired(question) ? (
                <span className="sr-only">{t("extensions.interactiveRequests.required")}</span>
              ) : null}
            </h2>
            {question.detail ? (
              <p className="text-muted-foreground mt-1 text-sm leading-5">{question.detail}</p>
            ) : null}
            {hasOptions ? (
              <div className="mt-1">
                <QuestionControl
                  question={question}
                  questionIndex={currentIndex}
                  draft={draft}
                  disabled={disabled}
                  groupName={id}
                  questionLabelId={questionLabelId}
                  formatOptionLabel={formatOptionLabel}
                  onOptionChange={(label, checked) => {
                    if (disabled) return;
                    setValidationError(false);
                    const nextDrafts = selectQuestionOption(
                      drafts,
                      questions,
                      currentIndex,
                      label,
                      checked,
                    );
                    setDrafts(nextDrafts);
                    if (checked && !question.multiSelect && !lastQuestion) {
                      navigate(currentIndex + 1, nextDrafts);
                    }
                  }}
                />
              </div>
            ) : null}
          </div>
        </div>

        <div className={cn("mt-auto px-4 pb-2 sm:px-5", hasOptions ? "pt-1" : "pt-3")}>
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
          <div
            className={cn("flex flex-wrap items-end gap-x-3", hasOptions ? "gap-y-2" : "gap-y-3")}
          >
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
            <div className="ms-auto flex shrink-0 items-center justify-end gap-2 [--button-radius:var(--composer-radius,var(--radius-3xl))]">
              {question.multiSelect ? (
                <span className="text-muted-foreground text-xs" aria-live="polite">
                  {t("extensions.interactiveRequests.selectedCount", {
                    count: draft.selected.length,
                  })}
                </span>
              ) : null}
              <Button type="button" variant="outline" disabled={disabled} onClick={skip}>
                {t("extensions.interactiveRequests.skip")}
                {expiresAt !== undefined && !disabled ? (
                  <QuestionCountdown key={expiresAt} expiresAt={expiresAt} />
                ) : null}
              </Button>
              <Button
                type="submit"
                disabled={disabled || awaitingRequiredAnswer}
                aria-describedby={validationError ? validationId : undefined}
              >
                {disabled ? <LoaderCircleIcon aria-hidden="true" className="animate-spin" /> : null}
                {disabled
                  ? t("extensions.interactiveRequests.submitting")
                  : lastQuestion
                    ? t(
                        hasOptions
                          ? "extensions.interactiveRequests.submitAndContinue"
                          : "extensions.interactiveRequests.send",
                      )
                    : t("extensions.interactiveRequests.nextQuestion")}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </section>
  );
}
