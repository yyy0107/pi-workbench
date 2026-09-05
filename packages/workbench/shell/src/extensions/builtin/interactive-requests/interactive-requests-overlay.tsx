"use client";

import { LoaderCircleIcon, ShieldAlertIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { Button } from "@workbench/shell/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workbench/shell/ui";
import { useI18n } from "@workbench/shell/i18n";
import type { ComposerOverlaySlotContext } from "@workbench/extension-sdk";
import { useWorkbenchAgentThreadId } from "@workbench/agent-runtime-client/context";
import {
  WorkbenchAgentCapabilityError,
  type WorkbenchInteractionCapability,
} from "@workbench/agent-runtime-client/capabilities";
import type {
  WorkbenchInteractionResponse,
  WorkbenchPendingInteraction,
} from "@workbench/agent-runtime-contracts/runtime-capabilities";
import { useWorkbenchInteractionCapability } from "@workbench/agent-runtime-client/context";

import { AskUserPanel } from "./ask-user-panel";
import { useAskUserPreferences } from "./ask-user-preferences";
import type { AskUserQuestion } from "./interaction-form-state";

type SubmitError = "bad-response" | "network" | "not-pending";

function optionLabel(question: AskUserQuestion, label: string, yes: string, no: string): string {
  if (question.id !== "confirmation") return label;
  if (label === "true") return yes;
  if (label === "false") return no;
  return label;
}

function InteractionMetadata({
  interaction,
  pendingCount,
}: {
  interaction: WorkbenchPendingInteraction;
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
  manager: WorkbenchInteractionCapability,
  requestId: string,
): {
  error: SubmitError | null;
  submitting: boolean;
  submit(response: WorkbenchInteractionResponse): Promise<void>;
} {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<SubmitError | null>(null);
  const requestInFlight = useRef(false);

  const submit = useCallback(
    async (response: WorkbenchInteractionResponse) => {
      if (requestInFlight.current) return;
      requestInFlight.current = true;
      setSubmitting(true);
      setError(null);

      try {
        await manager.respondInteraction(requestId, response);
      } catch (cause) {
        setError(
          cause instanceof WorkbenchAgentCapabilityError && cause.code === "request-ended"
            ? "not-pending"
            : cause instanceof WorkbenchAgentCapabilityError && cause.code === "invalid-request"
              ? "bad-response"
              : "network",
        );
        requestInFlight.current = false;
        setSubmitting(false);
      }
    },
    [manager, requestId],
  );

  return { error, submitting, submit };
}

function QuestionComposerOverlay({
  interaction,
  manager,
  setOverlayVisible,
}: {
  interaction: Extract<WorkbenchPendingInteraction, { kind: "question" }>;
  manager: WorkbenchInteractionCapability;
  setOverlayVisible(visible: boolean): void;
}) {
  const { t } = useI18n();
  const askUserPreference = useAskUserPreferences();
  const { error, submitting, submit } = useInteractionSubmit(manager, interaction.requestId);
  const preferenceReady = askUserPreference.status !== "loading";
  const showQuestion = !preferenceReady || askUserPreference.enabled || error !== null;

  useLayoutEffect(() => {
    if (!showQuestion) return;
    setOverlayVisible(true);
    return () => setOverlayVisible(false);
  }, [setOverlayVisible, showQuestion]);

  useEffect(() => {
    if (!preferenceReady || askUserPreference.enabled) return;
    void submit({ kind: "cancel" });
  }, [askUserPreference.enabled, preferenceReady, submit]);

  // Decline disabled requests without covering the composer. If that response fails,
  // surface the panel again so the session cannot remain invisibly blocked.
  if (!showQuestion) return null;

  const errorMessage =
    error === "bad-response"
      ? t("extensions.interactiveRequests.errors.badResponse")
      : error === "not-pending"
        ? t("extensions.interactiveRequests.errors.notPending")
        : error === "network"
          ? t("extensions.interactiveRequests.errors.network")
          : undefined;

  return (
    <AskUserPanel
      questions={interaction.questions}
      expiresAt={interaction.expiresAt}
      progress={interaction.progress}
      disabled={submitting}
      error={errorMessage}
      formatOptionLabel={(question, label) =>
        optionLabel(
          question,
          label,
          t("extensions.interactiveRequests.yes"),
          t("extensions.interactiveRequests.no"),
        )
      }
      onCancel={() => void submit({ kind: "cancel" })}
      onSubmit={(answers, nextQuestionIndex) =>
        void submit({
          kind: "question",
          ...(nextQuestionIndex === undefined ? {} : { nextQuestionIndex }),
          answers: answers.map((answer) => ({
            ...answer,
            selected: [...answer.selected],
          })),
        })
      }
    />
  );
}

function ApprovalDialog({
  interaction,
  manager,
  pendingCount,
}: {
  interaction: Extract<WorkbenchPendingInteraction, { kind: "approval" }>;
  manager: WorkbenchInteractionCapability;
  pendingCount: number;
}) {
  const { t } = useI18n();
  const { error, submitting, submit } = useInteractionSubmit(manager, interaction.requestId);

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

function usePendingInteractions() {
  const manager = useWorkbenchInteractionCapability();
  const activeSessionId = useWorkbenchAgentThreadId();
  const revision = useSyncExternalStore(
    manager?.subscribe ?? (() => () => undefined),
    manager?.getRevision ?? (() => 0),
    manager?.getRevision ?? (() => 0),
  );
  const pending = useMemo(
    () => (activeSessionId ? (manager?.getPendingInteractions(activeSessionId) ?? []) : []),
    [activeSessionId, manager, revision],
  );
  return { manager, pending };
}

export function InteractiveQuestionComposerOverlay({
  setOverlayVisible,
}: ComposerOverlaySlotContext) {
  const { manager, pending } = usePendingInteractions();
  const interaction = pending[0];
  if (
    !manager ||
    !interaction ||
    interaction.kind !== "question" ||
    interaction.questions.length === 0
  ) {
    return null;
  }

  return (
    <QuestionComposerOverlay
      key={interaction.requestId}
      interaction={interaction}
      manager={manager}
      setOverlayVisible={setOverlayVisible}
    />
  );
}

export function InteractiveRequestsOverlay({ setOverlayVisible }: ComposerOverlaySlotContext) {
  const { manager, pending } = usePendingInteractions();
  const interaction = pending[0];
  const approvalVisible = interaction?.kind === "approval";

  useLayoutEffect(() => {
    if (!approvalVisible) return;
    setOverlayVisible(true);
    return () => setOverlayVisible(false);
  }, [approvalVisible, setOverlayVisible]);

  if (!manager || !interaction || interaction.kind !== "approval") return null;

  return (
    <ApprovalDialog
      key={interaction.requestId}
      interaction={interaction}
      manager={manager}
      pendingCount={pending.length}
    />
  );
}
