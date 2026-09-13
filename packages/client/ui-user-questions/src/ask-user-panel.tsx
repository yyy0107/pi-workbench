"use client";
import { userQuestionsTranslationBundle } from "./i18n";
import { useI18n } from "@workbench/i18n";

import {
  ArrowRightIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleIcon,
  MessageCircleQuestionMarkIcon,
  PencilLineIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@workbench/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@workbench/ui";
import { Textarea } from "@workbench/ui";

import { cn } from "@workbench/ui/utils";

import {
  buildQuestionAnswers,
  findFirstInvalidQuestionIndex,
  isQuestionAnswered,
  selectQuestionOption,
  setQuestionCustomAnswer,
  skipQuestion,
  type AskUserAnswer,
  type AskUserQuestion,
  type QuestionAnswerDraft,
} from "../lib/interaction-form-state";
import { AskUserRecommendedMark } from "./ask-user-recommended-mark";
import {
  createQuestionPanelState,
  navigateQuestionPanel,
  reconcileQuestionPanelState,
  type QuestionPanelState,
} from "../lib/question-panel-state";
import styles from "./ask-user-panel.module.css";

interface AskUserPanelProps {
  interactionKey?: string;
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
  "group/answer relative has-[:focus-visible]:ring-ring/50 flex min-h-[var(--button-height-default)] cursor-pointer items-center gap-2 rounded-[var(--button-radius)] px-2 py-0.5 text-start transition-colors hover:[background:var(--control-state-background-hover)] has-[:focus-visible]:ring-2";

const answerMarkerClassName =
  "text-muted-foreground bg-muted flex size-[var(--button-height-compact)] shrink-0 items-center justify-center rounded-full border border-border text-xs tabular-nums";

function isRequired(question: AskUserQuestion): boolean {
  const hasOptions = (question.options?.length ?? 0) > 0;
  return question.required ?? (hasOptions && !question.multiSelect);
}

function QuestionCountdown({ expiresAt }: { expiresAt: number }) {
  const { number, t } = useI18n(userQuestionsTranslationBundle);
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
  const { t } = useI18n(userQuestionsTranslationBundle);
  const [open, setOpen] = useState(false);

  return (
    <div className="text-muted-foreground flex shrink-0 items-center gap-0.5 whitespace-nowrap">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={currentIndex === 0}
        aria-label={t("extensions.interactiveRequests.navigator.previous")}
        onClick={() => onNavigate(currentIndex - 1)}
      >
        <ChevronLeftIcon aria-hidden="true" />
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          type="button"
          aria-disabled={disabled || undefined}
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
        <PopoverContent align="end" side="top" className="w-72 gap-1 p-1.5" inert={disabled}>
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
        disabled={currentIndex === questions.length - 1}
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
  groupName,
  questionLabelId,
  formatOptionLabel,
  onOptionChange,
}: {
  question: AskUserQuestion;
  questionIndex: number;
  draft: QuestionAnswerDraft;
  groupName: string;
  questionLabelId: string;
  formatOptionLabel(question: AskUserQuestion, label: string): string;
  onOptionChange(label: string, checked: boolean): void;
}) {
  const { t } = useI18n(userQuestionsTranslationBundle);
  const options = question.options ?? [];

  if (options.length === 0) return null;

  return (
    <fieldset
      className="-mx-3 max-h-72 space-y-0.5 overflow-y-auto overscroll-contain p-1"
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
  groupName,
  questionLabelId,
  invalid,
  validationId,
  onCustomChange,
}: {
  question: AskUserQuestion;
  questionIndex: number;
  draft: QuestionAnswerDraft;
  groupName: string;
  questionLabelId: string;
  invalid: boolean;
  validationId: string;
  onCustomChange(value: string): void;
}) {
  const { t } = useI18n(userQuestionsTranslationBundle);
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
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? validationId : undefined}
          aria-labelledby={`${questionLabelId} ${customLabelId}`}
          placeholder={t(
            hasOptions
              ? "extensions.interactiveRequests.customAnswerPlaceholder"
              : "extensions.interactiveRequests.answerPlaceholder",
          )}
          className={cn(
            "field-sizing-fixed resize-none text-sm leading-[var(--control-text-line-height)]",
            hasOptions
              ? "h-[var(--input-control-height)] min-h-[var(--input-control-height)] border-0 px-0 pt-[var(--button-content-padding-block-start)] pb-[var(--button-content-padding-block-end)] [--input-control-background:transparent]"
              : "h-[var(--button-height-large)] min-h-[var(--button-height-large)]",
          )}
          onChange={(event) => onCustomChange(event.currentTarget.value)}
        />
      </div>
    </div>
  );
}

function QuestionPage({
  question,
  index,
  draft,
  active,
  direction,
  lastQuestion,
  groupName,
  expiresAt,
  blocked,
  invalid,
  error,
  formatOptionLabel,
  onOptionChange,
  onCustomChange,
  onSkip,
  onSubmit,
}: {
  question: AskUserQuestion;
  index: number;
  draft: QuestionAnswerDraft;
  active: boolean;
  direction: QuestionPanelState["direction"];
  lastQuestion: boolean;
  groupName: string;
  expiresAt?: number;
  blocked: boolean;
  invalid: boolean;
  error?: ReactNode;
  formatOptionLabel(question: AskUserQuestion, label: string): string;
  onOptionChange(label: string, checked: boolean): void;
  onCustomChange(value: string): void;
  onSkip(): void;
  onSubmit(): void;
}) {
  const { t } = useI18n(userQuestionsTranslationBundle);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    if (active) headingRef.current?.focus({ preventScroll: true });
  }, [active]);

  const questionLabelId = `${groupName}-question-${index}`;
  const validationId = `${groupName}-validation-${index}`;
  const hasOptions = (question.options?.length ?? 0) > 0;
  const awaitingRequiredAnswer =
    isRequired(question) && !draft.skipped && !isQuestionAnswered(question, draft);

  return (
    <form
      className={cn(styles.page, "min-h-0 flex-col")}
      data-active={active}
      data-direction={direction}
      inert={!active || blocked}
      aria-hidden={!active || undefined}
      aria-labelledby={questionLabelId}
      onSubmit={(event) => {
        event.preventDefault();
        if (active && !blocked && !awaitingRequiredAnswer) onSubmit();
      }}
    >
      <div className="min-h-0 px-4 sm:px-5">
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
              questionIndex={index}
              draft={draft}
              groupName={groupName}
              questionLabelId={questionLabelId}
              formatOptionLabel={formatOptionLabel}
              onOptionChange={onOptionChange}
            />
          </div>
        ) : null}
      </div>

      <div className={cn("px-4 pb-2 sm:px-5", hasOptions ? "pt-1" : "pt-3")}>
        {invalid ? (
          <p id={validationId} role="alert" className="mb-2 text-sm text-destructive">
            {t("extensions.interactiveRequests.validation.missingRequired")}
          </p>
        ) : null}
        {error ? (
          <div role="alert" className="mb-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        <div className={cn("flex flex-wrap items-end gap-x-3", hasOptions ? "gap-y-2" : "gap-y-3")}>
          <CustomAnswerControl
            question={question}
            questionIndex={index}
            draft={draft}
            groupName={groupName}
            questionLabelId={questionLabelId}
            invalid={invalid}
            validationId={validationId}
            onCustomChange={onCustomChange}
          />
          <div className="ms-auto flex shrink-0 items-center justify-end gap-2 [--button-radius:var(--composer-radius,var(--radius-3xl))]">
            {question.multiSelect ? (
              <span className="text-muted-foreground text-xs" aria-live="polite">
                {t("extensions.interactiveRequests.selectedCount", {
                  count: draft.selected.length,
                })}
              </span>
            ) : null}
            <Button type="button" variant="outline" onClick={onSkip}>
              {t("extensions.interactiveRequests.skip")}
              {active && expiresAt !== undefined ? (
                <QuestionCountdown key={expiresAt} expiresAt={expiresAt} />
              ) : null}
            </Button>
            <Button
              type="submit"
              disabled={awaitingRequiredAnswer}
              aria-describedby={invalid ? validationId : undefined}
            >
              {lastQuestion
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
  );
}

export function AskUserPanel({
  interactionKey,
  questions,
  expiresAt,
  progress,
  disabled = false,
  error,
  formatOptionLabel = (_question, label) => label,
  onCancel,
  onSubmit,
}: AskUserPanelProps) {
  const { t } = useI18n(userQuestionsTranslationBundle);
  const id = useId();
  const input = { interactionKey, questions, progress };
  const [state, setState] = useState(() => createQuestionPanelState(input));
  const reconciled = reconcileQuestionPanelState(state, input);
  // Synchronize one atomic state snapshot before commit, not via remounts or delayed effects.
  if (reconciled !== state) setState(reconciled);
  const { currentIndex, drafts, direction, validationIndex } = reconciled;
  const question = questions[currentIndex];
  if (!question || !drafts[currentIndex]) return null;

  const lastQuestion = currentIndex === questions.length - 1;
  const navigate = (index: number, nextDrafts = drafts) => {
    if (disabled || navigateQuestionPanel(reconciled, index, questions.length) === reconciled)
      return;
    if (progress) {
      onSubmit(
        buildQuestionAnswers(questions, nextDrafts).filter(
          (_, answerIndex) =>
            nextDrafts[answerIndex]?.skipped ||
            isQuestionAnswered(questions[answerIndex]!, nextDrafts[answerIndex]),
        ),
        index,
      );
    } else {
      setState((current) => navigateQuestionPanel(current, index, questions.length));
    }
  };

  const updateDrafts = (nextDrafts: readonly QuestionAnswerDraft[]) => {
    setState((current) => ({ ...current, drafts: nextDrafts, validationIndex: undefined }));
  };

  const submit = (nextDrafts = drafts) => {
    if (disabled) return;
    const firstInvalid = findFirstInvalidQuestionIndex(questions, nextDrafts);
    setState((current) => ({ ...current, validationIndex: firstInvalid }));
    if (firstInvalid !== undefined) navigate(firstInvalid, nextDrafts);
    else onSubmit(buildQuestionAnswers(questions, nextDrafts));
  };

  const skip = () => {
    if (disabled) return;
    // Single-question SDK dialogs use cancellation as their empty/default response.
    if (!progress && questions.length === 1) return onCancel();
    const nextDrafts = skipQuestion(drafts, currentIndex);
    updateDrafts(nextDrafts);
    if (lastQuestion) submit(nextDrafts);
    else navigate(currentIndex + 1, nextDrafts);
  };

  return (
    <section
      role="region"
      aria-labelledby={`${id}-question-${currentIndex}`}
      aria-busy={disabled}
      data-slot="ask-user-panel"
      className="bg-background text-foreground flex w-full flex-col overflow-clip rounded-[var(--composer-radius,var(--radius-3xl))] border border-border"
    >
      {/* Pending RPCs block input without briefly applying every control's disabled appearance. */}
      <header
        inert={disabled}
        className="flex items-center justify-between gap-3 px-4 py-1 sm:px-5"
      >
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
            aria-label={t("extensions.interactiveRequests.cancel")}
            onClick={() => {
              if (!disabled) onCancel();
            }}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </div>
      </header>
      <div className={styles.pages}>
        {questions.map((pageQuestion, index) => (
          <QuestionPage
            key={`${pageQuestion.id}:${index}`}
            question={pageQuestion}
            index={index}
            draft={drafts[index]!}
            active={index === currentIndex}
            direction={direction}
            lastQuestion={index === questions.length - 1}
            groupName={id}
            expiresAt={expiresAt}
            blocked={disabled}
            invalid={validationIndex === index}
            error={index === currentIndex ? error : undefined}
            formatOptionLabel={formatOptionLabel}
            onOptionChange={(label, checked) => {
              if (disabled || index !== currentIndex) return;
              const nextDrafts = selectQuestionOption(drafts, questions, index, label, checked);
              updateDrafts(nextDrafts);
              if (checked && !pageQuestion.multiSelect && !lastQuestion) {
                navigate(currentIndex + 1, nextDrafts);
              }
            }}
            onCustomChange={(value) => {
              if (!disabled && index === currentIndex) {
                updateDrafts(setQuestionCustomAnswer(drafts, index, value));
              }
            }}
            onSkip={() => {
              if (index === currentIndex) skip();
            }}
            onSubmit={() => {
              if (lastQuestion) submit();
              else navigate(currentIndex + 1);
            }}
          />
        ))}
      </div>
      <span role="status" className="sr-only">
        {disabled ? t("extensions.interactiveRequests.submitting") : null}
      </span>
    </section>
  );
}
