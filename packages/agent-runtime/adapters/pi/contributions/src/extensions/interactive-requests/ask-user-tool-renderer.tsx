"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { CircleSlashIcon, Clock3Icon, LoaderCircleIcon } from "lucide-react";

import { usePiI18n } from "../../i18n";
import { cn } from "@workbench/shell/utils";

import { AskUserRecommendedMark } from "./ask-user-recommended-mark";
import { areAskUserQuestionsReady, readAskUserToolRecord } from "./ask-user-tool-model";
import type { AskUserAnswer } from "./interaction-form-state";

function AnswerRecord({
  answer,
  recommendedLabels,
  pending,
  cancelled,
}: {
  answer: AskUserAnswer | undefined;
  recommendedLabels: ReadonlySet<string>;
  pending: boolean;
  cancelled: boolean;
}) {
  const { t } = usePiI18n();
  const custom = answer?.custom?.trim();

  if (pending) {
    return (
      <p className="text-muted-foreground flex items-center gap-1 text-xs leading-5">
        <Clock3Icon aria-hidden="true" className="size-3 shrink-0" />
        {t("extensions.interactiveRequests.askUserTool.waiting")}
      </p>
    );
  }

  if (!answer || (answer.selected.length === 0 && !custom)) {
    return (
      <p className="text-muted-foreground text-xs leading-5 italic">
        {t(
          cancelled
            ? "extensions.interactiveRequests.askUserTool.cancelledAnswer"
            : "extensions.interactiveRequests.askUserTool.unanswered",
        )}
      </p>
    );
  }

  return (
    <div className="min-w-0 space-y-1.5">
      {answer.selected.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {answer.selected.map((value, index) => (
            <span
              key={`${value}:${index}`}
              className="bg-primary/8 text-foreground inline-flex items-center gap-1 rounded border border-primary/15 px-1.5 py-0.5 text-xs font-medium leading-5"
            >
              <span>{value}</span>
              {recommendedLabels.has(value) ? <AskUserRecommendedMark /> : null}
            </span>
          ))}
        </div>
      ) : null}
      {custom ? <p className="whitespace-pre-wrap text-[13px] leading-5">{custom}</p> : null}
    </div>
  );
}

export const AskUserToolRenderer: ToolCallMessagePartComponent = ({
  args,
  argsText,
  result,
  artifact,
  status,
}) => {
  const { number, t } = usePiI18n();
  const output = result ?? artifact;
  const record = readAskUserToolRecord(args, output);
  const pending = status.type === "running" || status.type === "requires-action";
  const interrupted = status.type === "incomplete";
  const cancelled = record.cancelled || interrupted;
  const questionsReady = areAskUserQuestionsReady(args, output, argsText);

  if ((pending && !questionsReady) || record.questions.length === 0) {
    return (
      <div
        data-slot="ask-user-tool-record"
        role="status"
        className="text-muted-foreground flex items-center gap-1.5 rounded-lg border bg-foreground/[0.025] px-3 py-2.5 text-sm"
      >
        <LoaderCircleIcon aria-hidden="true" className="size-3.5 animate-spin" />
        {t("extensions.interactiveRequests.askUserTool.activityGenerating")}
      </div>
    );
  }

  return (
    <section
      data-slot="ask-user-tool-record"
      aria-label={t("extensions.interactiveRequests.askUserTool.history")}
      className="overflow-hidden rounded-lg border bg-foreground/[0.025]"
    >
      {record.disabled || cancelled ? (
        <div
          className={cn(
            "flex items-start gap-1.5 border-b px-3 py-2 text-xs leading-5",
            record.disabled
              ? "bg-muted/50 text-muted-foreground"
              : "bg-amber-500/7 text-amber-800 dark:text-amber-300",
          )}
        >
          <CircleSlashIcon aria-hidden="true" className="mt-1 size-3 shrink-0" />
          <span>
            {t(
              record.disabled
                ? "extensions.interactiveRequests.askUserTool.disabled"
                : interrupted
                  ? "extensions.interactiveRequests.askUserTool.interrupted"
                  : "extensions.interactiveRequests.askUserTool.cancelled",
            )}
          </span>
        </div>
      ) : null}

      <ol className="divide-y">
        {record.questions.map((question, index) => {
          const answer = record.answers.get(question.id);
          const recommendedLabels = new Set(
            question.options
              ?.filter((option) => option.recommended)
              .map((option) => option.label) ?? [],
          );
          return (
            <li key={`${question.id}:${index}`} className="space-y-1.5 px-3 py-2.5">
              <div className="flex items-start gap-2">
                <span
                  aria-hidden="true"
                  className="bg-foreground/[0.06] text-muted-foreground mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-medium tabular-nums"
                >
                  {number(index + 1)}
                </span>
                <div className="min-w-0 space-y-0.5">
                  {question.header ? (
                    <p className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
                      {question.header}
                    </p>
                  ) : null}
                  <p className="whitespace-pre-wrap text-[13px] font-medium leading-5">
                    {question.question}
                  </p>
                  {question.detail ? (
                    <p className="text-muted-foreground whitespace-pre-wrap text-[11px] leading-4">
                      {question.detail}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="ms-6 min-w-0 border-s border-border/70 ps-2.5">
                <AnswerRecord
                  answer={answer}
                  recommendedLabels={recommendedLabels}
                  pending={pending}
                  cancelled={cancelled}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
};
