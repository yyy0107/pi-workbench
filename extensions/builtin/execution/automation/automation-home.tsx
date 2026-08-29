"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ActivityIcon,
  CirclePauseIcon,
  CirclePlayIcon,
  Clock3Icon,
  FileCheck2Icon,
  GitCommitHorizontalIcon,
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
import { useI18n } from "@/i18n";
import { ProjectTrustDialog } from "@/components/ui/project-trust-dialog";
import { cn } from "@/lib/utils";
import { useMainViewService } from "@/platform/extensions";
import { automationClient } from "@/runtime/pi/client/automations/automation-client";
import { usePiWorkspaces } from "@/runtime/pi/client/runtime/context";
import type { AutomationSummary } from "@/runtime/shared/automation";

import {
  describeScheduleCron,
  formatRelativeTimeUntil,
  parseScheduleCron,
} from "./automation-schedule";
import { AUTOMATION_TASK_PRESETS, type AutomationTaskPreset } from "./automation-task-presets";
import { workflowMainViewRequest } from "../execution-main-view";
import { useExecutionTrustAdmission } from "../use-execution-trust-admission";

const AUTOMATION_TEMPLATE_ICONS = {
  "morning-briefing": SunMediumIcon,
  "risk-scan": ActivityIcon,
  "git-standup": GitCommitHorizontalIcon,
  "docs-sync": FileCheck2Icon,
} as const satisfies Record<AutomationTaskPreset, LucideIcon>;

type LoadState = "loading" | "ready" | "error";
type PendingAutomationAction =
  | { automationId: string; type: "run" | "toggle" | "archive" }
  | undefined;

interface AutomationFeedback {
  tone: "status" | "error";
  message: string;
}

export function AutomationHome() {
  const { t } = useI18n();
  const mainViews = useMainViewService();
  const workspaces = usePiWorkspaces();
  const [automations, setAutomations] = useState<AutomationSummary[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [pendingAction, setPendingAction] = useState<PendingAutomationAction>();
  const [feedback, setFeedback] = useState<AutomationFeedback>();
  const [now, setNow] = useState(() => Date.now());
  const trustAdmission = useExecutionTrustAdmission(() => undefined);

  const refresh = useCallback(async () => {
    setLoadState("loading");
    try {
      const value = await automationClient.list();
      setAutomations(value.items);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, []);

  useEffect(() => void refresh(), [refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const openCreate = (preset?: AutomationTaskPreset) =>
    mainViews.open(
      workflowMainViewRequest({
        page: "automation-create",
        ...(preset ? { preset } : {}),
      }),
    );
  const openAutomation = (automationId: string) =>
    mainViews.open(workflowMainViewRequest({ page: "automation-edit", automationId }));

  const runNow = async (automation: AutomationSummary) => {
    setPendingAction({ automationId: automation.id, type: "run" });
    setFeedback(undefined);
    const workspace = workspaces.find(({ id }) => id === automation.workspaceId);
    if (!workspace) {
      setFeedback({
        tone: "error",
        message: t("extensions.workflows.automationHome.runFailed", { name: automation.name }),
      });
      setPendingAction(undefined);
      return;
    }
    await trustAdmission.admit(
      workspace.cwd,
      async () => {
        await automationClient.runNow({ automationId: automation.id });
        setFeedback({
          tone: "status",
          message: t("extensions.workflows.automationHome.runStarted", {
            name: automation.name,
          }),
        });
        await refresh();
      },
      () => {
        setFeedback({
          tone: "error",
          message: t("extensions.workflows.automationHome.runFailed", {
            name: automation.name,
          }),
        });
      },
    );
    setPendingAction(undefined);
  };

  const setAutomationEnabled = async (automation: AutomationSummary, enabled: boolean) => {
    setPendingAction({ automationId: automation.id, type: "toggle" });
    setFeedback(undefined);
    try {
      await automationClient.setEnabled({ automationId: automation.id, enabled });
      setFeedback({
        tone: "status",
        message: t(
          enabled
            ? "extensions.workflows.automationHome.enabledFeedback"
            : "extensions.workflows.automationHome.disabledFeedback",
          { name: automation.name },
        ),
      });
      await refresh();
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

  const archiveAutomation = async (automation: AutomationSummary) => {
    setPendingAction({ automationId: automation.id, type: "archive" });
    setFeedback(undefined);
    try {
      await automationClient.archive({ automationId: automation.id, archived: true });
      setFeedback({
        tone: "status",
        message: t("extensions.workflows.automationHome.deletedFeedback", {
          name: automation.name,
        }),
      });
      await refresh();
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
    <>
      <section
        aria-labelledby="automation-home-title"
        className="bg-background h-full min-h-0 overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-10 lg:py-12">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1
                id="automation-home-title"
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

          <section
            aria-label={t("extensions.workflows.automationHome.tasksLabel")}
            className="mt-5 flex flex-col"
          >
            {loadState === "loading" ? (
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
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-3">
                  <h2 className="text-sm font-medium">
                    {t("extensions.workflows.automationHome.myAutomations")}
                  </h2>
                  {feedback ? (
                    <p
                      className={cn(
                        "ms-auto text-end text-sm",
                        feedback.tone === "error" ? "text-destructive" : "text-muted-foreground",
                      )}
                      role={feedback.tone === "error" ? "alert" : "status"}
                    >
                      {feedback.message}
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-3 py-3 sm:py-4 lg:grid-cols-2">
                  {automations.map((automation) => (
                    <AutomationCard
                      key={automation.id}
                      automation={automation}
                      now={now}
                      pendingAction={
                        pendingAction?.automationId === automation.id
                          ? pendingAction.type
                          : undefined
                      }
                      onOpen={() => openAutomation(automation.id)}
                      onRunNow={() => runNow(automation)}
                      onSetEnabled={(enabled) => setAutomationEnabled(automation, enabled)}
                      onArchive={() => archiveAutomation(automation)}
                    />
                  ))}
                </div>
              </div>
            )}
          </section>

          <section
            aria-labelledby="automation-templates-title"
            className="border-border mt-10 border-t pt-8"
          >
            <h2
              id="automation-templates-title"
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
      <ProjectTrustDialog {...trustAdmission.dialog} />
    </>
  );
}

function AutomationCard({
  automation,
  now,
  pendingAction,
  onOpen,
  onRunNow,
  onSetEnabled,
  onArchive,
}: {
  automation: AutomationSummary;
  now: number;
  pendingAction?: "run" | "toggle" | "archive";
  onOpen(): void;
  onRunNow(): Promise<void>;
  onSetEnabled(enabled: boolean): Promise<void>;
  onArchive(): Promise<void>;
}) {
  const { locale, relativeTime, t } = useI18n();
  const parsedSchedule = parseScheduleCron(automation.schedule.cron);
  const recurrence = t(
    `extensions.workflows.automationTask.frequencySummary.${parsedSchedule.frequency}`,
  );
  const customScheduleDescription =
    parsedSchedule.frequency === "custom"
      ? describeScheduleCron(parsedSchedule.customCron, locale)
      : undefined;
  const scheduleLabel =
    parsedSchedule.frequency === "custom"
      ? (customScheduleDescription ??
        t("extensions.workflows.automationHome.customSchedule", {
          cron: parsedSchedule.customCron,
        }))
      : parsedSchedule.frequency === "hourly"
        ? recurrence
        : t("extensions.workflows.automationHome.scheduleAt", {
            recurrence,
            time: parsedSchedule.time,
          });
  const nextRunLabel = automation.enabled
    ? automation.nextRunAt === undefined
      ? t("extensions.workflows.automationHome.noNextRun")
      : t("extensions.workflows.automationHome.nextRunRelative", {
          time: formatRelativeTimeUntil(automation.nextRunAt, now, relativeTime),
        })
    : undefined;
  const scheduleTimingLabel = nextRunLabel
    ? t("extensions.workflows.automationHome.scheduleWithNextRun", {
        schedule: scheduleLabel,
        nextRun: nextRunLabel,
      })
    : scheduleLabel;

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
        <span className="text-muted-foreground mt-2 line-clamp-2 pe-8 text-sm leading-5">
          {automation.prompt}
        </span>
        <span className="mt-auto flex w-full flex-wrap items-center justify-between gap-2 pt-4 text-xs">
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {!automation.enabled ? (
              <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                <CirclePauseIcon aria-hidden="true" className="size-4 shrink-0" />
                {t("extensions.workflows.automationHome.paused")}
              </span>
            ) : null}
            <span
              aria-label={scheduleTimingLabel}
              className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2 py-1 text-emerald-600 dark:text-emerald-400"
            >
              <Clock3Icon aria-hidden="true" className="size-4 shrink-0" />
              <span className="truncate whitespace-nowrap">{scheduleTimingLabel}</span>
            </span>
          </span>
          <span className="bg-muted text-muted-foreground -me-2 shrink-0 rounded-lg px-2 py-1 sm:-me-1.5">
            {t("extensions.workflows.automationHome.runCount", {
              count: automation.sessionCount,
            })}
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
              disabled={Boolean(pendingAction)}
              onClick={() => void onRunNow()}
            >
              {pendingAction === "run" ? (
                <RefreshCwIcon aria-hidden="true" className="animate-spin" />
              ) : (
                <PlayIcon aria-hidden="true" />
              )}
              {t(
                pendingAction === "run"
                  ? "extensions.workflows.automationHome.starting"
                  : "extensions.workflows.automationHome.runNow",
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="min-h-9 gap-2 px-2.5"
              disabled={Boolean(pendingAction)}
              onClick={() => void onSetEnabled(!automation.enabled)}
            >
              {pendingAction === "toggle" ? (
                <RefreshCwIcon aria-hidden="true" className="animate-spin" />
              ) : automation.enabled ? (
                <CirclePauseIcon aria-hidden="true" />
              ) : (
                <CirclePlayIcon aria-hidden="true" />
              )}
              {t(
                automation.enabled
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
              {pendingAction === "archive" ? (
                <RefreshCwIcon aria-hidden="true" className="animate-spin" />
              ) : (
                <Trash2Icon aria-hidden="true" />
              )}
              {t(
                pendingAction === "archive"
                  ? "extensions.workflows.automationHome.deleting"
                  : "extensions.workflows.automationHome.delete",
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
}
