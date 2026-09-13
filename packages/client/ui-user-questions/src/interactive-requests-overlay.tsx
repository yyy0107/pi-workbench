"use client";
import { userQuestionsTranslationBundle } from "./i18n";
import { useI18n } from "@workbench/i18n";

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

import { Button } from "@workbench/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workbench/ui";

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
import type { AskUserQuestion } from "../lib/interaction-form-state";
import {
  QUESTION_HANDOFF_TIMEOUT_MS,
  completeQuestionExit,
  createQuestionPresence,
  expectQuestionContinuation,
  expireQuestionContinuation,
  reconcileQuestionPresence,
  type QuestionInteraction,
} from "../lib/question-interaction-presence";
import styles from "./interactive-requests-overlay.module.css";

type SubmitError = "bad-response" | "network" | "not-pending";
type SubmitOutcome = "submitted" | "failed" | "ignored";

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
  const { t } = useI18n(userQuestionsTranslationBundle);

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
  const { t } = useI18n(userQuestionsTranslationBundle);
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
  submit(response: WorkbenchInteractionResponse, onStart?: () => void): Promise<SubmitOutcome>;
} {
  const scope = useMemo(() => ({ manager, requestId }), [manager, requestId]);
  const activeScope = useRef<typeof scope | null>(scope);
  const [submission, setSubmission] = useState<{
    scope: typeof scope;
    error: SubmitError | null;
    submitting: boolean;
  }>({ scope, error: null, submitting: false });
  const requestInFlight = useRef<typeof scope | undefined>(undefined);

  useLayoutEffect(() => {
    activeScope.current = scope;
    return () => {
      activeScope.current = null;
    };
  }, [scope]);

  const submit = useCallback(
    async (
      response: WorkbenchInteractionResponse,
      onStart?: () => void,
    ): Promise<SubmitOutcome> => {
      if (activeScope.current !== scope || requestInFlight.current === scope) return "ignored";
      requestInFlight.current = scope;
      setSubmission({ scope, error: null, submitting: true });
      onStart?.();

      try {
        await manager.respondInteraction(requestId, response);
        return "submitted";
      } catch (cause) {
        // An older response may reject after the next request/provider has become active.
        // Do not clear its submission state or its expected question continuation.
        if (activeScope.current !== scope || requestInFlight.current !== scope) return "ignored";
        const error =
          cause instanceof WorkbenchAgentCapabilityError && cause.code === "request-ended"
            ? "not-pending"
            : cause instanceof WorkbenchAgentCapabilityError && cause.code === "invalid-request"
              ? "bad-response"
              : "network";
        requestInFlight.current = undefined;
        setSubmission({ scope, error, submitting: false });
        return "failed";
      }
    },
    [manager, requestId, scope],
  );

  return {
    error: submission.scope === scope ? submission.error : null,
    submitting: submission.scope === scope && submission.submitting,
    submit,
  };
}

function QuestionComposerOverlay({
  interaction,
  manager,
  exiting,
  waiting,
  onExitComplete,
  onNextQuestionExpected,
  setOverlayVisible,
}: {
  interaction: QuestionInteraction;
  manager: WorkbenchInteractionCapability;
  exiting: boolean;
  waiting: boolean;
  onExitComplete(): void;
  onNextQuestionExpected(index: number | undefined): void;
  setOverlayVisible(visible: boolean): void;
}) {
  const { t } = useI18n(userQuestionsTranslationBundle);
  const askUserPreference = useAskUserPreferences();
  const { error, submitting, submit } = useInteractionSubmit(manager, interaction.requestId);
  const exitTransitionRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (!exiting) return;
    if (!showQuestion) {
      onExitComplete();
      return;
    }

    const element = exitTransitionRef.current;
    const view = element?.ownerDocument.defaultView;
    if (!element || !view) {
      onExitComplete();
      return;
    }

    let cancelled = false;
    const frame = view.requestAnimationFrame(() => {
      const animations = element.getAnimations();
      if (animations.length === 0) {
        onExitComplete();
        return;
      }
      void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
        if (!cancelled) onExitComplete();
      });
    });

    return () => {
      cancelled = true;
      view.cancelAnimationFrame(frame);
    };
  }, [exiting, onExitComplete, showQuestion]);

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

  const respond = async (response: WorkbenchInteractionResponse) => {
    const result = await submit(response, () =>
      onNextQuestionExpected(response.kind === "question" ? response.nextQuestionIndex : undefined),
    );
    if (result === "failed") onNextQuestionExpected(undefined);
  };

  return (
    <div
      ref={exitTransitionRef}
      inert={exiting}
      aria-hidden={exiting || undefined}
      data-state={exiting ? "exiting" : "open"}
      className={styles.questionOverlay}
    >
      <AskUserPanel
        interactionKey={interaction.requestId}
        questions={interaction.questions}
        expiresAt={interaction.expiresAt}
        progress={interaction.progress}
        disabled={submitting || waiting || exiting}
        error={errorMessage}
        formatOptionLabel={(question, label) =>
          optionLabel(
            question,
            label,
            t("extensions.interactiveRequests.yes"),
            t("extensions.interactiveRequests.no"),
          )
        }
        onCancel={() => {
          void respond({ kind: "cancel" });
        }}
        onSubmit={(answers, nextQuestionIndex) => {
          void respond({
            kind: "question",
            ...(nextQuestionIndex === undefined ? {} : { nextQuestionIndex }),
            answers: answers.map((answer) => ({
              ...answer,
              selected: [...answer.selected],
            })),
          });
        }}
      />
    </div>
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
  const { t } = useI18n(userQuestionsTranslationBundle);
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
  return { manager, pending, activeSessionId };
}

export function InteractiveQuestionComposerOverlay({
  setOverlayVisible,
}: ComposerOverlaySlotContext) {
  const { manager, pending, activeSessionId } = usePendingInteractions();
  const currentInteraction = pending[0];
  const currentQuestion =
    currentInteraction?.kind === "question" && currentInteraction.questions.length > 0
      ? currentInteraction
      : undefined;
  const [presence, setPresence] = useState(() =>
    createQuestionPresence(manager, activeSessionId, currentQuestion),
  );
  const reconciled = reconcileQuestionPresence(presence, manager, activeSessionId, currentQuestion);
  // Commit one coherent snapshot. Session/provider changes never paint a retained old question,
  // and matching requests refresh retained metadata before a subsequent removal from the store.
  if (reconciled !== presence) setPresence(reconciled);

  const { group, revision, scopeRevision } = reconciled;
  const waitingForNextQuestion = group?.phase === "waiting";

  useEffect(() => {
    if (!waitingForNextQuestion) return;
    const timeout = window.setTimeout(
      () => setPresence((state) => expireQuestionContinuation(state, revision)),
      QUESTION_HANDOFF_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [revision, waitingForNextQuestion]);

  const completeExit = useCallback(() => {
    setPresence((state) => completeQuestionExit(state, revision));
  }, [revision]);

  if (!manager || !group) return null;

  return (
    <QuestionComposerOverlay
      key={`${scopeRevision}:${group.initialRequestId}`}
      interaction={group.question}
      manager={manager}
      exiting={group.phase === "exiting"}
      waiting={waitingForNextQuestion}
      onExitComplete={completeExit}
      onNextQuestionExpected={(index) => {
        setPresence((state) =>
          expectQuestionContinuation(state, scopeRevision, group.question.requestId, index),
        );
      }}
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
