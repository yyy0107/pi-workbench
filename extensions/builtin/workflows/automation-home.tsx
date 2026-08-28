"use client";

import { useMemo, useState } from "react";
import {
  ActivityIcon,
  CirclePauseIcon,
  CirclePlayIcon,
  Clock3Icon,
  FileCheck2Icon,
  GitCommitHorizontalIcon,
  InfoIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  SunMediumIcon,
  Trash2Icon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { useMainViewService } from "@/platform/extensions";
import { workflowClient } from "@/runtime/pi/client/workflows/workflow-client";
import type {
  WorkflowRunStatus,
  WorkflowRunSummary,
  WorkflowSummary,
  WorkflowTriggerState,
} from "@/runtime/shared/execution";

import { AUTOMATION_TASK_PRESETS, type AutomationTaskPreset } from "./automation-task-presets";
import { workflowMainViewRequest } from "./workflow-main-view";
import { useWorkflowCatalogStore } from "./workflow-state";

const AUTOMATION_TEMPLATE_ICONS = {
  "morning-briefing": SunMediumIcon,
  "risk-scan": ActivityIcon,
  "git-standup": GitCommitHorizontalIcon,
  "docs-sync": FileCheck2Icon,
} as const satisfies Record<AutomationTaskPreset, LucideIcon>;

const ACTIVE_RUN_STATUSES: readonly WorkflowRunStatus[] = [
  "queued",
  "running",
  "waiting-for-approval",
];

const RUN_STATUS_KEYS = {
  queued: "queued",
  running: "running",
  "waiting-for-approval": "waitingForApproval",
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
  interrupted: "interrupted",
} as const satisfies Record<WorkflowRunStatus, string>;

type PendingAutomationAction =
  | { workflowId: string; type: "run" | "toggle" | "archive" }
  | undefined;

interface AutomationFeedback {
  tone: "status" | "error";
  message: string;
}

export function AutomationHome() {
  const { t } = useI18n();
  const mainViews = useMainViewService();
  const items = useWorkflowCatalogStore((state) => state.items);
  const runs = useWorkflowCatalogStore((state) => state.runs);
  const triggerStates = useWorkflowCatalogStore((state) => state.triggerStates);
  const loadState = useWorkflowCatalogStore((state) => state.loadState);
  const keepAwake = useWorkflowCatalogStore((state) => state.keepAwake);
  const wakeLockState = useWorkflowCatalogStore((state) => state.wakeLockState);
  const setKeepAwake = useWorkflowCatalogStore((state) => state.setKeepAwake);
  const refresh = useWorkflowCatalogStore((state) => state.refresh);
  const [pendingAction, setPendingAction] = useState<PendingAutomationAction>();
  const [feedback, setFeedback] = useState<AutomationFeedback>();

  const automations = useMemo(
    () => items.filter(({ kind, archivedAt }) => kind === "automation" && archivedAt === undefined),
    [items],
  );
  const openCreate = (preset?: AutomationTaskPreset) =>
    mainViews.open(
      workflowMainViewRequest({
        page: "automation-create",
        ...(preset ? { preset } : {}),
      }),
    );
  const openAutomation = (workflowId: string) =>
    mainViews.open(workflowMainViewRequest({ page: "automation-edit", workflowId }));

  const runNow = async (automation: WorkflowSummary) => {
    setPendingAction({ workflowId: automation.id, type: "run" });
    setFeedback(undefined);
    try {
      const { document } = await workflowClient.read({ workflowId: automation.id });
      if (!document.publishedRevisionId) {
        setFeedback({
          tone: "error",
          message: t("extensions.workflows.automationHome.publishBeforeRun"),
        });
        return;
      }
      const targetWorkspaceId =
        document.scope.type === "personal"
          ? document.triggers.find((trigger) => trigger.targetWorkspaceId)?.targetWorkspaceId
          : undefined;
      const admission = await workflowClient.startRun({
        workflowId: document.id,
        revisionSource: "published",
        revisionId: document.publishedRevisionId,
        source: "manual",
        ...(targetWorkspaceId ? { targetWorkspaceId } : {}),
      });
      if (admission.kind === "skipped") {
        setFeedback({
          tone: "status",
          message: t("extensions.workflows.automationHome.alreadyRunning", {
            name: automation.name,
          }),
        });
      } else {
        useWorkflowCatalogStore.getState().applyHostPayload({
          type: "host/workflow-run-changed",
          run: admission.run,
        });
        setFeedback({
          tone: "status",
          message: t("extensions.workflows.automationHome.runStarted", {
            name: automation.name,
          }),
        });
      }
    } catch {
      setFeedback({
        tone: "error",
        message: t("extensions.workflows.automationHome.runFailed", {
          name: automation.name,
        }),
      });
    } finally {
      setPendingAction(undefined);
    }
  };

  const setAutomationEnabled = async (automation: WorkflowSummary, enabled: boolean) => {
    setPendingAction({ workflowId: automation.id, type: "toggle" });
    setFeedback(undefined);
    try {
      const snapshot = await workflowClient.listTriggers({ workflowId: automation.id });
      if (snapshot.states.length === 0) {
        setFeedback({
          tone: "error",
          message: t("extensions.workflows.automationHome.noTriggerToEnable", {
            name: automation.name,
          }),
        });
        return;
      }
      const nextStates = await Promise.all(
        snapshot.states.map(({ triggerId }) =>
          workflowClient.setTriggerEnabled({
            workflowId: automation.id,
            triggerId,
            enabled,
          }),
        ),
      );
      nextStates.forEach((state) =>
        useWorkflowCatalogStore.getState().applyHostPayload({
          type: "host/workflow-trigger-changed",
          state,
        }),
      );
      setFeedback({
        tone: "status",
        message: t(
          enabled
            ? "extensions.workflows.automationHome.enabledFeedback"
            : "extensions.workflows.automationHome.disabledFeedback",
          { name: automation.name },
        ),
      });
    } catch {
      setFeedback({
        tone: "error",
        message: t("extensions.workflows.automationHome.toggleFailed", {
          name: automation.name,
        }),
      });
    } finally {
      setPendingAction(undefined);
    }
  };

  const archiveAutomation = async (automation: WorkflowSummary) => {
    setPendingAction({ workflowId: automation.id, type: "archive" });
    setFeedback(undefined);
    try {
      await workflowClient.archive({ workflowId: automation.id, archived: true });
      useWorkflowCatalogStore.getState().applyHostPayload({
        type: "host/workflow-removed",
        workflowId: automation.id,
      });
      setFeedback({
        tone: "status",
        message: t("extensions.workflows.automationHome.deletedFeedback", {
          name: automation.name,
        }),
      });
    } catch {
      setFeedback({
        tone: "error",
        message: t("extensions.workflows.automationHome.deleteFailed", {
          name: automation.name,
        }),
      });
    } finally {
      setPendingAction(undefined);
    }
  };

  return (
    <section
      aria-labelledby="workflow-automation-home-title"
      className="bg-background h-full min-h-0 overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-10 lg:py-12">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1
              id="workflow-automation-home-title"
              className="text-foreground text-3xl font-semibold tracking-tight"
            >
              {t("extensions.workflows.automationHome.title")}
            </h1>
            <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-6">
              {t("extensions.workflows.automationHome.description")}
            </p>
          </div>
          <Button type="button" onClick={() => openCreate()}>
            <PlusIcon aria-hidden="true" />
            {t("extensions.workflows.automationHome.newAutomation")}
          </Button>
        </header>

        <div className="bg-muted/60 mt-6 flex min-h-12 items-center gap-3 rounded-[var(--radius-lg)] px-4 py-2">
          <InfoIcon aria-hidden="true" className="text-muted-foreground size-5 shrink-0" />
          <div id="workflow-automation-wake-lock-description" className="min-w-0 flex-1">
            <p className="text-muted-foreground text-sm">
              {t("extensions.workflows.automationHome.keepAwake")}
            </p>
            {wakeLockState === "unsupported" || wakeLockState === "error" ? (
              <p className="text-destructive mt-0.5 text-xs" role="status">
                {t("extensions.workflows.automationHome.wakeLockUnavailable")}
              </p>
            ) : null}
          </div>
          <Switch
            checked={keepAwake}
            aria-label={t("extensions.workflows.automationHome.keepAwake")}
            aria-describedby="workflow-automation-wake-lock-description"
            onCheckedChange={setKeepAwake}
          />
        </div>

        <section
          aria-label={t("extensions.workflows.automationHome.tasksLabel")}
          className="mt-5 flex flex-col"
        >
          {loadState === "loading" || loadState === "idle" ? (
            <div className="text-muted-foreground flex min-h-72 items-center justify-center gap-2 text-sm">
              <RefreshCwIcon aria-hidden="true" className="size-4 animate-spin" />
              {t("extensions.workflows.automationHome.loading")}
            </div>
          ) : loadState === "error" ? (
            <div className="flex min-h-72 flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-muted-foreground text-sm">
                {t("extensions.workflows.automationHome.loadFailed")}
              </p>
              <Button variant="outline" size="sm" onClick={() => void refresh()}>
                <RefreshCwIcon aria-hidden="true" />
                {t("extensions.workflows.sidebar.retry")}
              </Button>
            </div>
          ) : automations.length === 0 ? (
            <div className="flex min-h-72 flex-col items-center justify-center gap-2 p-6 text-center">
              <ZapIcon aria-hidden="true" className="text-muted-foreground size-6" />
              <p className="text-sm font-medium">
                {t("extensions.workflows.automationHome.empty")}
              </p>
              <p className="text-muted-foreground max-w-md text-sm leading-6">
                {t("extensions.workflows.automationHome.emptyDescription")}
              </p>
            </div>
          ) : (
            <div className="flex flex-col">
              <div className="flex items-center pt-3">
                <h2 className="text-sm font-medium">
                  {t("extensions.workflows.automationHome.myAutomations")}
                </h2>
              </div>
              <AutomationList
                automations={automations}
                runs={runs}
                triggerStates={triggerStates}
                pendingAction={pendingAction}
                onOpen={openAutomation}
                onRunNow={runNow}
                onSetEnabled={setAutomationEnabled}
                onArchive={archiveAutomation}
              />
            </div>
          )}
        </section>

        {feedback ? (
          <p
            className={cn(
              "mt-4 text-sm",
              feedback.tone === "error" ? "text-destructive" : "text-muted-foreground",
            )}
            role={feedback.tone === "error" ? "alert" : "status"}
          >
            {feedback.message}
          </p>
        ) : null}

        <section
          aria-labelledby="workflow-automation-templates-title"
          className="border-border mt-10 border-t pt-8"
        >
          <h2
            id="workflow-automation-templates-title"
            className="text-muted-foreground text-sm font-medium"
          >
            {t("extensions.workflows.automationHome.scheduledTemplates")}
          </h2>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {AUTOMATION_TASK_PRESETS.map((preset) => {
              const Icon = AUTOMATION_TEMPLATE_ICONS[preset.id];
              return (
                <button
                  key={preset.id}
                  type="button"
                  className="border-border focus-visible:ring-ring group/template flex min-h-32 w-full flex-col rounded-[var(--radius-lg)] border p-4 text-start outline-none transition-colors hover:[background:var(--button-background-hover)] focus-visible:ring-2 active:[background:var(--button-background-active)]"
                  onClick={() => openCreate(preset.id)}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <Icon
                      aria-hidden="true"
                      className="text-muted-foreground size-[var(--icon-size-md)] shrink-0 transition-colors group-hover/template:text-foreground"
                    />
                    {t(preset.nameKey)}
                  </span>
                  <span className="text-muted-foreground mt-2 line-clamp-2 text-sm leading-5">
                    {t(preset.descriptionKey)}
                  </span>
                  <span className="text-muted-foreground mt-auto pt-3 text-xs">
                    {t(preset.scheduleLabelKey)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </section>
  );
}

function AutomationList({
  automations,
  runs,
  triggerStates,
  pendingAction,
  onOpen,
  onRunNow,
  onSetEnabled,
  onArchive,
}: {
  automations: WorkflowSummary[];
  runs: WorkflowRunSummary[];
  triggerStates: WorkflowTriggerState[];
  pendingAction: PendingAutomationAction;
  onOpen(workflowId: string): void;
  onRunNow(automation: WorkflowSummary): Promise<void>;
  onSetEnabled(automation: WorkflowSummary, enabled: boolean): Promise<void>;
  onArchive(automation: WorkflowSummary): Promise<void>;
}) {
  return (
    <div className="grid gap-3 py-3 sm:py-4 lg:grid-cols-2">
      {automations.map((automation) => (
        <AutomationCard
          key={automation.id}
          automation={automation}
          runs={runs.filter(({ workflowId }) => workflowId === automation.id)}
          triggerStates={triggerStates.filter(({ workflowId }) => workflowId === automation.id)}
          pendingAction={
            pendingAction?.workflowId === automation.id ? pendingAction.type : undefined
          }
          onOpen={() => onOpen(automation.id)}
          onRunNow={() => onRunNow(automation)}
          onSetEnabled={(enabled) => onSetEnabled(automation, enabled)}
          onArchive={() => onArchive(automation)}
        />
      ))}
    </div>
  );
}

function AutomationCard({
  automation,
  runs,
  triggerStates,
  pendingAction,
  onOpen,
  onRunNow,
  onSetEnabled,
  onArchive,
}: {
  automation: WorkflowSummary;
  runs: WorkflowRunSummary[];
  triggerStates: WorkflowTriggerState[];
  pendingAction?: "run" | "toggle" | "archive";
  onOpen(): void;
  onRunNow(): Promise<void>;
  onSetEnabled(enabled: boolean): Promise<void>;
  onArchive(): Promise<void>;
}) {
  const { locale, t } = useI18n();
  const dateTime = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );
  const activeRun = runs.find(({ status }) => ACTIVE_RUN_STATUSES.includes(status));
  const enabled =
    triggerStates.length > 0
      ? triggerStates.some((state) => state.enabled)
      : automation.enabledTriggerCount > 0;
  const nextRunAt = triggerStates.reduce<number | undefined>((next, state) => {
    if (!state.enabled || state.nextRunAt === undefined) return next;
    return next === undefined || state.nextRunAt < next ? state.nextRunAt : next;
  }, undefined);
  const published = Boolean(automation.publishedRevisionId);
  const scheduleLabel = activeRun
    ? t(`extensions.workflows.automationHome.runStatus.${RUN_STATUS_KEYS[activeRun.status]}`)
    : nextRunAt !== undefined
      ? t("extensions.workflows.automationHome.nextRun", {
          time: dateTime.format(nextRunAt),
        })
      : enabled
        ? t("extensions.workflows.automationHome.noNextRun")
        : t("extensions.workflows.automationHome.disabled");
  const statusTone = activeRun ? "active" : enabled ? "enabled" : "disabled";
  const togglePending = pendingAction === "toggle";
  const runPending = pendingAction === "run";
  const archivePending = pendingAction === "archive";

  return (
    <article className="group/card border-border relative min-h-36 overflow-visible rounded-[var(--radius-lg)] border">
      <button
        type="button"
        className="focus-visible:ring-ring flex min-h-36 w-full flex-col rounded-[var(--radius-lg)] px-4 py-3.5 text-start outline-none transition-colors hover:[background:var(--button-background-hover)] focus-visible:ring-2"
        onClick={onOpen}
      >
        <span className="min-w-0 max-w-full truncate pe-8 text-sm font-semibold">
          {automation.name}
        </span>
        {automation.description ? (
          <span className="text-muted-foreground mt-2 line-clamp-2 pe-8 text-sm leading-5">
            {automation.description}
          </span>
        ) : null}
        <span className="mt-auto flex w-full flex-wrap items-center justify-between gap-2 pt-4 text-xs">
          <span
            className={cn(
              "inline-flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1",
              statusTone === "enabled"
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : statusTone === "active"
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground",
            )}
          >
            <Clock3Icon aria-hidden="true" className="size-4 shrink-0" />
            <span className="truncate">{scheduleLabel}</span>
          </span>
          <span className="bg-muted text-muted-foreground -me-2 shrink-0 rounded-lg px-2 py-1 sm:-me-1.5">
            {t("extensions.workflows.automationHome.runCount", { count: runs.length })}
          </span>
        </span>
      </button>

      <div className="absolute end-2 top-2 z-10 sm:end-2.5 sm:top-2.5">
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t("extensions.workflows.automationHome.moreActions", {
              name: automation.name,
            })}
            className="text-muted-foreground hover:text-foreground flex size-[var(--icon-frame-size-default)] items-center justify-center rounded-[var(--button-radius)] outline-none transition-colors hover:[background:var(--icon-frame-background-hover)] focus-visible:ring-2 focus-visible:ring-ring data-popup-open:[background:var(--icon-frame-background-selected)] data-popup-open:[color:var(--icon-frame-foreground-selected)]"
          >
            <MoreHorizontalIcon aria-hidden="true" className="size-[var(--icon-size-md)]" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom" sideOffset={4} className="min-w-48 p-1.5">
            <DropdownMenuItem
              className="min-h-9 gap-2 px-2.5"
              disabled={!published || Boolean(pendingAction)}
              onClick={() => void onRunNow()}
            >
              {runPending ? (
                <RefreshCwIcon aria-hidden="true" className="animate-spin" />
              ) : (
                <PlayIcon aria-hidden="true" />
              )}
              {t(
                runPending
                  ? "extensions.workflows.automationHome.starting"
                  : "extensions.workflows.automationHome.runNow",
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="min-h-9 gap-2 px-2.5"
              disabled={!published || automation.triggerCount === 0 || Boolean(pendingAction)}
              onClick={() => void onSetEnabled(!enabled)}
            >
              {togglePending ? (
                <RefreshCwIcon aria-hidden="true" className="animate-spin" />
              ) : enabled ? (
                <CirclePauseIcon aria-hidden="true" />
              ) : (
                <CirclePlayIcon aria-hidden="true" />
              )}
              {t(
                enabled
                  ? "extensions.workflows.automationHome.pause"
                  : "extensions.workflows.automationHome.enable",
              )}
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-9 gap-2 px-2.5" onClick={onOpen}>
              <PencilIcon aria-hidden="true" />
              {t("extensions.workflows.automationHome.editScheduledTask")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              className="min-h-9 gap-2 px-2.5"
              disabled={Boolean(pendingAction)}
              onClick={() => void onArchive()}
            >
              {archivePending ? (
                <RefreshCwIcon aria-hidden="true" className="animate-spin" />
              ) : (
                <Trash2Icon aria-hidden="true" />
              )}
              {t(
                archivePending
                  ? "extensions.workflows.automationHome.deleting"
                  : "extensions.workflows.automationHome.delete",
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {togglePending ? (
          <span className="sr-only" role="status">
            {t("extensions.workflows.automationHome.updatingStatus")}
          </span>
        ) : null}
      </div>
    </article>
  );
}
