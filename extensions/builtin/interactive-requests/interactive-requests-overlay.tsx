"use client";

import { LoaderCircleIcon, ShieldAlertIcon } from "lucide-react";
import { useId, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n";
import { usePiSessionManager } from "@/runtime/pi/client/runtime/context";
import type {
  PiInteractionResponse,
  PiPendingInteraction,
  PiSessionManager,
} from "@/runtime/pi/client/runtime/manager";
import { PiApiError } from "@/runtime/pi/client/transport/api";
import type { QuestionItem } from "@/runtime/pi/stream-contracts";

import {
  buildQuestionAnswers,
  canSubmitQuestionAnswers,
  createQuestionAnswerDrafts,
  selectQuestionOption,
  setQuestionCustomAnswer,
} from "./interaction-form-state";

type SubmitError = "bad-response" | "network" | "not-pending";

function optionLabel(question: QuestionItem, label: string, yes: string, no: string): string {
  if (question.id !== "confirmation") return label;
  if (label === "true") return yes;
  if (label === "false") return no;
  return label;
}

function InteractionMetadata({
  interaction,
  pendingCount,
}: {
  interaction: PiPendingInteraction;
  pendingCount: number;
}) {
  const { t } = useI18n();

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span>
        {t("extensions.interactiveRequests.session", { sessionId: interaction.sessionId })}
      </span>
      <span>{t("extensions.interactiveRequests.pending", { count: pendingCount })}</span>
    </div>
  );
}

function SubmitErrorMessage({ error }: { error: SubmitError | null }) {
  const { t } = useI18n();
  if (!error) return null;

  const message =
    error === "bad-response"
      ? t("extensions.interactiveRequests.errors.badResponse")
      : error === "not-pending"
        ? t("extensions.interactiveRequests.errors.notPending")
        : t("extensions.interactiveRequests.errors.network");

  return (
    <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  );
}

function useInteractionSubmit(
  manager: PiSessionManager,
  rpcId: string,
): {
  error: SubmitError | null;
  submitting: boolean;
  submit(response: PiInteractionResponse): Promise<void>;
} {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<SubmitError | null>(null);
  const requestInFlight = useRef(false);

  const submit = async (response: PiInteractionResponse) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setSubmitting(true);
    setError(null);

    try {
      const receipt = await manager.respondInteraction(rpcId, response);
      if (!receipt.accepted) {
        setError(receipt.reason === "bad-response" ? "bad-response" : "not-pending");
        requestInFlight.current = false;
        setSubmitting(false);
      }
    } catch (cause) {
      setError(
        cause instanceof PiApiError && cause.code === "pi_interaction_not_found"
          ? "not-pending"
          : "network",
      );
      requestInFlight.current = false;
      setSubmitting(false);
    }
  };

  return { error, submitting, submit };
}

function QuestionField({
  question,
  questionIndex,
  groupName,
  disabled,
  draft,
  onOptionChange,
  onCustomChange,
}: {
  question: QuestionItem;
  questionIndex: number;
  groupName: string;
  disabled: boolean;
  draft: ReturnType<typeof createQuestionAnswerDrafts>[number];
  onOptionChange(label: string, checked: boolean): void;
  onCustomChange(value: string): void;
}) {
  const { t } = useI18n();
  const options = question.options ?? [];

  return (
    <fieldset className="space-y-3 rounded-xl border bg-background/60 p-3" disabled={disabled}>
      <legend className="max-w-full space-y-1 px-1 text-foreground">
        {question.header ? (
          <span className="block text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {question.header}
          </span>
        ) : null}
        <span className="block text-sm font-medium">{question.question}</span>
      </legend>
      {question.detail ? <p className="text-sm text-muted-foreground">{question.detail}</p> : null}

      {options.length > 0 ? (
        <div className="space-y-2">
          {options.map((option, optionIndex) => {
            const checked = draft.selected.includes(option.label);
            return (
              <label
                key={`${option.label}:${optionIndex}`}
                className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors has-checked:border-primary/50 has-checked:bg-primary/5 has-disabled:cursor-not-allowed has-disabled:opacity-60"
              >
                <input
                  type={question.multiSelect ? "checkbox" : "radio"}
                  name={`${groupName}-${questionIndex}`}
                  value={option.label}
                  checked={checked}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  onChange={(event) => onOptionChange(option.label, event.currentTarget.checked)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {optionLabel(
                      question,
                      option.label,
                      t("extensions.interactiveRequests.yes"),
                      t("extensions.interactiveRequests.no"),
                    )}
                  </span>
                  {option.description ? (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
      ) : (
        <Textarea
          value={draft.custom}
          aria-label={t("extensions.interactiveRequests.answerLabel", {
            question: question.question,
          })}
          placeholder={t("extensions.interactiveRequests.answerPlaceholder")}
          className="min-h-20 resize-y"
          onChange={(event) => onCustomChange(event.currentTarget.value)}
        />
      )}
    </fieldset>
  );
}

function QuestionDialog({
  interaction,
  manager,
  pendingCount,
}: {
  interaction: Extract<PiPendingInteraction, { kind: "question" }>;
  manager: PiSessionManager;
  pendingCount: number;
}) {
  const { t } = useI18n();
  const groupName = useId();
  const [drafts, setDrafts] = useState(() => createQuestionAnswerDrafts(interaction.questions));
  const { error, submitting, submit } = useInteractionSubmit(manager, interaction.rpcId);
  const canSubmit = canSubmitQuestionAnswers(interaction.questions, drafts);

  const cancel = () => submit({ kind: "cancel" });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) void cancel();
      }}
    >
      <DialogContent
        closeLabel={t("extensions.interactiveRequests.cancel")}
        className="flex max-h-[min(42rem,calc(100dvh-2rem))] max-w-xl grid-rows-none flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
        aria-busy={submitting}
      >
        <DialogHeader className="border-b px-5 py-4 pe-12">
          <DialogTitle>{t("extensions.interactiveRequests.questionTitle")}</DialogTitle>
          <DialogDescription>
            {t("extensions.interactiveRequests.questionDescription")}
          </DialogDescription>
          <InteractionMetadata interaction={interaction} pendingCount={pendingCount} />
        </DialogHeader>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit || submitting) return;
            void submit({
              kind: "question",
              answers: buildQuestionAnswers(interaction.questions, drafts),
            });
          }}
        >
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {interaction.questions.map((question, index) => (
              <QuestionField
                key={`${question.id}:${index}`}
                question={question}
                questionIndex={index}
                groupName={groupName}
                disabled={submitting}
                draft={drafts[index]!}
                onOptionChange={(label, checked) => {
                  setDrafts((current) =>
                    selectQuestionOption(current, interaction.questions, index, label, checked),
                  );
                }}
                onCustomChange={(value) => {
                  setDrafts((current) => setQuestionCustomAnswer(current, index, value));
                }}
              />
            ))}
            <SubmitErrorMessage error={error} />
          </div>

          <DialogFooter closeLabel={t("extensions.interactiveRequests.cancel")}>
            <Button type="button" variant="outline" disabled={submitting} onClick={cancel}>
              {t("extensions.interactiveRequests.cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit || submitting}>
              {submitting ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : null}
              {submitting
                ? t("extensions.interactiveRequests.submitting")
                : t("extensions.interactiveRequests.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ApprovalDialog({
  interaction,
  manager,
  pendingCount,
}: {
  interaction: Extract<PiPendingInteraction, { kind: "approval" }>;
  manager: PiSessionManager;
  pendingCount: number;
}) {
  const { t } = useI18n();
  const { error, submitting, submit } = useInteractionSubmit(manager, interaction.rpcId);

  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent
        closeLabel={t("extensions.interactiveRequests.close")}
        showCloseButton={false}
        className="max-w-lg gap-0 overflow-hidden p-0 sm:max-w-lg"
        aria-busy={submitting}
      >
        <DialogHeader className="border-b px-5 py-4">
          <div className="flex items-center gap-2">
            <ShieldAlertIcon className="size-5 text-amber-600" aria-hidden="true" />
            <DialogTitle>{t("extensions.interactiveRequests.approvalTitle")}</DialogTitle>
          </div>
          <DialogDescription>
            {t("extensions.interactiveRequests.approvalDescription")}
          </DialogDescription>
          <InteractionMetadata interaction={interaction} pendingCount={pendingCount} />
        </DialogHeader>

        <div className="space-y-3 p-5">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-xl border bg-background/60 p-3 text-sm">
            <dt className="text-muted-foreground">{t("extensions.interactiveRequests.tool")}</dt>
            <dd className="min-w-0 break-words font-mono">{interaction.toolName}</dd>
            {interaction.callId ? (
              <>
                <dt className="text-muted-foreground">
                  {t("extensions.interactiveRequests.callId")}
                </dt>
                <dd className="min-w-0 break-all font-mono text-xs">{interaction.callId}</dd>
              </>
            ) : null}
          </dl>
          {interaction.reason ? (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                {t("extensions.interactiveRequests.reason")}
              </p>
              <p className="whitespace-pre-wrap text-sm">{interaction.reason}</p>
            </div>
          ) : null}
          <SubmitErrorMessage error={error} />
        </div>

        <DialogFooter closeLabel={t("extensions.interactiveRequests.close")}>
          <Button
            type="button"
            variant="destructive"
            disabled={submitting}
            onClick={() => void submit({ kind: "approval", outcome: "rejected" })}
          >
            {t("extensions.interactiveRequests.reject")}
          </Button>
          <Button
            type="button"
            disabled={submitting}
            onClick={() => void submit({ kind: "approval", outcome: "allowed-once" })}
          >
            {submitting ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : null}
            {submitting
              ? t("extensions.interactiveRequests.submitting")
              : t("extensions.interactiveRequests.allowOnce")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function InteractiveRequestsOverlay() {
  const manager = usePiSessionManager();
  const revision = useSyncExternalStore(
    manager.subscribe,
    manager.getSnapshot,
    manager.getSnapshot,
  );
  const pending = useMemo(() => manager.getPendingInteractions(), [manager, revision]);
  const interaction = pending[0];
  if (!interaction) return null;

  return interaction.kind === "question" ? (
    <QuestionDialog
      key={interaction.rpcId}
      interaction={interaction}
      manager={manager}
      pendingCount={pending.length}
    />
  ) : (
    <ApprovalDialog
      key={interaction.rpcId}
      interaction={interaction}
      manager={manager}
      pendingCount={pending.length}
    />
  );
}
