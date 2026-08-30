"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  CirclePauseIcon,
  CirclePlayIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { ModelSelector as ModelSelectorControl } from "@/components/ui/model-selector";
import type { ModelSelectorOption } from "@/components/ui/model-selector-models";
import { ProjectTrustDialog } from "@/components/ui/project-trust-dialog";
import { Textarea } from "@/components/ui/textarea";
import { TimePicker } from "@/components/ui/time-picker";
import { WorkspaceSelector } from "@/components/ui/workspace-selector";
import { useI18n } from "@/i18n";
import { formatCompactDuration } from "@/lib/format-duration";
import { cn } from "@/lib/utils";
import { useMainViewService, useNavigationService } from "@/platform/extensions";
import { useWorkbenchAgentThreadSnapshots } from "@workbench/agent-runtime-client/context";
import { useWorkspaceSelection } from "@workbench/agent-runtime-client/workspaces";
import { listPiModelCatalog } from "@/workbench/runtime-contributions/pi/client/configuration";
import { automationClient } from "@/workbench/runtime-contributions/pi/client/execution";
import {
  MAX_AUTOMATION_DURATION_SECONDS,
  MIN_AUTOMATION_DURATION_SECONDS,
  type AutomationDefinition,
  type AutomationSessionReference,
} from "@workbench/automation-contracts";
import type { ModelSelection } from "@workbench/contracts/model-selection";

import {
  draftSelectorModels,
  modelChangeSelection,
  modelSelection,
  modelSelectorId,
  resolveDraftSelectorModel,
} from "@/extensions/shared/model-selector/model-selector-state";
import { reasoningEffortLabel } from "@/extensions/shared/model-selector/reasoning-effort-label";
import { workflowMainViewRequest, type WorkflowMainViewParams } from "../execution-main-view";
import { useExecutionTrustAdmission } from "../use-execution-trust-admission";
import {
  SCHEDULE_FREQUENCIES,
  describeScheduleCron,
  parseScheduleCron,
  scheduleCron,
  timezoneOffset,
  type ScheduleFrequency,
} from "./automation-schedule";
import { findAutomationTaskPreset } from "./automation-task-presets";

type AutomationTaskParams = Extract<
  WorkflowMainViewParams,
  { page: "automation-create" | "automation-edit" }
>;
type AutomationTaskTab = "settings" | "history";
type PendingTaskAction = "save" | "run" | "toggle" | "archive";
type RunDeleteState = "idle" | "deleting" | "error";

interface RunDeleteTarget {
  reference: AutomationSessionReference;
  triggeredAtLabel: string;
}

const MIN_DURATION_MINUTES = MIN_AUTOMATION_DURATION_SECONDS / 60;
const MAX_DURATION_MINUTES = MAX_AUTOMATION_DURATION_SECONDS / 60;

function unavailableModel(selection: ModelSelection): ModelSelectorOption {
  const id = modelSelectorId(selection.provider, selection.model);
  return {
    id,
    provider: selection.provider,
    providerName: selection.provider,
    model: selection.model,
    name: selection.model,
    ...(selection.reasoningEffort
      ? {
          efforts: [{ id: selection.reasoningEffort, name: selection.reasoningEffort }],
          defaultEffort: selection.reasoningEffort,
        }
      : {}),
    unavailable: true,
  };
}

export function AutomationTaskForm({ params }: { params: AutomationTaskParams }) {
  const { locale, t } = useI18n();
  const mainViews = useMainViewService();
  const navigation = useNavigationService();
  const { workspaces } = useWorkspaceSelection();
  const editingAutomationId = params.page === "automation-edit" ? params.automationId : undefined;
  const presetName = params.page === "automation-create" ? params.preset : undefined;
  const presetDefinition = presetName ? findAutomationTaskPreset(presetName) : undefined;
  const preset = useMemo(() => {
    if (!presetDefinition) return undefined;
    return {
      title: t(presetDefinition.nameKey),
      prompt: t(presetDefinition.promptKey),
      time: presetDefinition.time,
      frequency: presetDefinition.frequency,
      customCron: "customCron" in presetDefinition ? presetDefinition.customCron : "",
    };
  }, [presetDefinition, t]);
  const localTimezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  const [title, setTitle] = useState(
    preset?.title ?? t("extensions.workflows.automationTask.untitledTask"),
  );
  const [prompt, setPrompt] = useState(preset?.prompt ?? "");
  const [frequency, setFrequency] = useState<ScheduleFrequency>(preset?.frequency ?? "weekdays");
  const [time, setTime] = useState<string>(preset?.time ?? "09:00");
  const [customCron, setCustomCron] = useState(preset?.customCron ?? "");
  const [hasSchedule, setHasSchedule] = useState(Boolean(preset));
  const [timezone, setTimezone] = useState(localTimezone);
  const [maxRunDurationMinutes, setMaxRunDurationMinutes] = useState("");
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [models, setModels] = useState<ModelSelectorOption[]>([]);
  const [fallbackModel, setFallbackModel] = useState<ModelSelectorOption>();
  const [modelState, setModelState] = useState<"loading" | "ready" | "error">("loading");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [selectedEffort, setSelectedEffort] = useState<string>();
  const [automation, setAutomation] = useState<AutomationDefinition>();
  const [sessions, setSessions] = useState<AutomationSessionReference[]>([]);
  const [activeTab, setActiveTab] = useState<AutomationTaskTab>("settings");
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    editingAutomationId ? "loading" : "ready",
  );
  const [historyState, setHistoryState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [validationRequested, setValidationRequested] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingTaskAction>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [deleteTarget, setDeleteTarget] = useState<RunDeleteTarget>();
  const [deleteState, setDeleteState] = useState<RunDeleteState>("idle");
  const trustAdmission = useExecutionTrustAdmission((nextError) => {
    setError(nextError instanceof Error ? nextError.message : "automation-save-failed");
  });
  const titleInputRef = useRef<HTMLInputElement>(null);
  const timePickerRef = useRef<HTMLButtonElement>(null);
  const customCronInputRef = useRef<HTMLInputElement>(null);
  const promptInputRef = useRef<HTMLTextAreaElement>(null);
  const sessionSnapshots = useWorkbenchAgentThreadSnapshots(
    sessions.map(({ sessionId }) => sessionId),
  );

  const selectableModels = useMemo(() => {
    if (!fallbackModel || models.some(({ id }) => id === fallbackModel.id)) return models;
    return [fallbackModel, ...models];
  }, [fallbackModel, models]);
  const selectedModel = selectableModels.find(({ id }) => id === selectedModelId);

  useEffect(() => {
    if (!workspaceId && workspaces[0]) setWorkspaceId(workspaces[0].id);
  }, [workspaceId, workspaces]);

  useEffect(() => {
    let disposed = false;
    setModelState("loading");
    void listPiModelCatalog().then(
      (catalog) => {
        if (disposed) return;
        const nextModels = draftSelectorModels(catalog);
        setModels(nextModels);
        setSelectedModelId((current) => {
          if (current) return current;
          return resolveDraftSelectorModel(nextModels, undefined, undefined)?.id ?? "";
        });
        setModelState("ready");
      },
      () => {
        if (!disposed) setModelState("error");
      },
    );
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedModel) return;
    const selection = modelSelection(selectedModel, selectedEffort);
    if (selection.reasoningEffort !== selectedEffort) {
      setSelectedEffort(selection.reasoningEffort);
    }
  }, [selectedEffort, selectedModel]);

  useEffect(() => {
    if (!editingAutomationId) return;
    let disposed = false;
    setLoadState("loading");
    setError(undefined);
    void automationClient.read({ automationId: editingAutomationId }).then(
      ({ automation: loaded }) => {
        if (disposed) return;
        const parsed = parseScheduleCron(loaded.schedule.cron);
        setAutomation(loaded);
        setSessions(loaded.sessions);
        setTitle(loaded.name);
        setPrompt(loaded.prompt);
        setFrequency(parsed.frequency);
        setTime(parsed.time);
        setCustomCron(parsed.customCron);
        setHasSchedule(true);
        setTimezone(loaded.schedule.timezone);
        setMaxRunDurationMinutes(
          loaded.schedule.maxDurationSeconds === undefined
            ? ""
            : String(loaded.schedule.maxDurationSeconds / 60),
        );
        setWorkspaceId(loaded.workspaceId);
        if (loaded.model) {
          setFallbackModel(unavailableModel(loaded.model));
          setSelectedModelId(modelSelectorId(loaded.model.provider, loaded.model.model));
          setSelectedEffort(loaded.model.reasoningEffort);
        }
        setLoadState("ready");
      },
      () => {
        if (!disposed) setLoadState("error");
      },
    );
    return () => {
      disposed = true;
    };
  }, [editingAutomationId, loadAttempt]);

  const refreshSessions = async () => {
    if (!editingAutomationId) return;
    setHistoryState("loading");
    try {
      const value = await automationClient.sessions({ automationId: editingAutomationId });
      setSessions(value.items);
      setHistoryState("ready");
    } catch {
      setHistoryState("error");
    }
  };

  useEffect(() => {
    if (activeTab === "history") void refreshSessions();
    // The active tab is the only automatic history refresh trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }),
    [locale],
  );
  const titleInvalid = validationRequested && !title.trim();
  const promptInvalid = validationRequested && !prompt.trim();
  const workspace = workspaces.find(({ id }) => id === workspaceId);
  const timeValid = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
  const customCronValid = Boolean(customCron.trim());
  const parsedMaxRunDurationMinutes = Number(maxRunDurationMinutes);
  const maxRunDurationValid =
    maxRunDurationMinutes.trim() === "" ||
    (Number.isInteger(parsedMaxRunDurationMinutes) &&
      parsedMaxRunDurationMinutes >= MIN_DURATION_MINUTES &&
      parsedMaxRunDurationMinutes <= MAX_DURATION_MINUTES);
  const scheduleUsesTime = frequency !== "hourly" && frequency !== "custom";
  const scheduleValid =
    hasSchedule &&
    maxRunDurationValid &&
    (frequency === "custom" ? customCronValid : !scheduleUsesTime || timeValid);
  const frequencyLabel = t(`extensions.workflows.automationTask.frequency.${frequency}`);
  const recurrence = t(`extensions.workflows.automationTask.frequencySummary.${frequency}`);
  const timezoneLabel = timezoneOffset(timezone, locale);
  const customCronDescription = useMemo(
    () => describeScheduleCron(customCron, locale),
    [customCron, locale],
  );
  const scheduleSummary =
    frequency === "custom"
      ? customCronValid
        ? customCronDescription
          ? t("extensions.workflows.automationTask.customScheduleSummary", {
              timezone: timezoneLabel,
              description: customCronDescription,
            })
          : t("extensions.workflows.automationTask.customScheduleFallback", {
              timezone: timezoneLabel,
              cron: customCron.trim(),
            })
        : undefined
      : scheduleUsesTime
        ? t("extensions.workflows.automationTask.scheduleSummary", {
            timezone: timezoneLabel,
            recurrence,
            time,
          })
        : t("extensions.workflows.automationTask.scheduleSummaryWithoutTime", {
            timezone: timezoneLabel,
            recurrence,
          });

  const submit = async (runAfterSave = false) => {
    setValidationRequested(true);
    if (!title.trim() || !prompt.trim() || !workspace || !scheduleValid) {
      setActiveTab("settings");
      requestAnimationFrame(() => {
        if (!title.trim()) titleInputRef.current?.focus();
        else if (!hasSchedule) document.getElementById("automation-task-add-schedule")?.focus();
        else if (frequency === "custom" && !customCronValid) customCronInputRef.current?.focus();
        else if (scheduleUsesTime && !timeValid) timePickerRef.current?.focus();
        else if (!maxRunDurationValid)
          document.getElementById("automation-task-max-run-duration")?.focus();
        else if (!prompt.trim()) promptInputRef.current?.focus();
        else if (!workspace) document.getElementById("automation-task-workspace-trigger")?.focus();
      });
      return;
    }

    setPendingAction(runAfterSave ? "run" : "save");
    setError(undefined);
    setNotice(undefined);
    const save = async () => {
      const model = selectedModel ? modelSelection(selectedModel, selectedEffort) : undefined;
      const value = await automationClient.save({
        ...(automation ? { automationId: automation.id, baseRevision: automation.revision } : {}),
        name: title.trim(),
        prompt: prompt.trim(),
        workspaceId,
        ...(model ? { model } : {}),
        schedule: {
          cron: scheduleCron(frequency, time, customCron),
          timezone,
          ...(maxRunDurationMinutes.trim()
            ? { maxDurationSeconds: parsedMaxRunDurationMinutes * 60 }
            : {}),
        },
        enabled: automation?.enabled ?? true,
      });
      setAutomation(value.automation);
      setSessions(value.automation.sessions);
      if (runAfterSave) {
        await automationClient.runNow({ automationId: value.automation.id });
        await refreshSessions();
        setNotice(
          t("extensions.workflows.automationHome.runStarted", { name: value.automation.name }),
        );
      } else if (editingAutomationId) {
        setNotice(t("extensions.workflows.automationTask.saved"));
      } else {
        mainViews.open(workflowMainViewRequest({ page: "automations" }));
      }
    };

    try {
      await trustAdmission.admit(workspace.rootPath, save, (nextError) => {
        setError(nextError instanceof Error ? nextError.message : "automation-save-failed");
      });
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : t(
              editingAutomationId
                ? "extensions.workflows.automationTask.saveFailed"
                : "extensions.workflows.automationTask.createFailed",
            ),
      );
    } finally {
      setPendingAction(undefined);
    }
  };

  const setTaskEnabled = async (enabled: boolean) => {
    if (!automation) return;
    setPendingAction("toggle");
    setError(undefined);
    setNotice(undefined);
    try {
      const value = await automationClient.setEnabled({ automationId: automation.id, enabled });
      setAutomation(value.automation);
      setNotice(
        t(
          enabled
            ? "extensions.workflows.automationHome.enabledFeedback"
            : "extensions.workflows.automationHome.disabledFeedback",
          { name: value.automation.name },
        ),
      );
    } catch {
      setError(t("extensions.workflows.automationHome.toggleFailed", { name: automation.name }));
    } finally {
      setPendingAction(undefined);
    }
  };

  const archiveTask = async () => {
    if (!automation) return;
    setPendingAction("archive");
    try {
      await automationClient.archive({ automationId: automation.id, archived: true });
      mainViews.open(workflowMainViewRequest({ page: "automations" }));
    } catch {
      setError(t("extensions.workflows.automationHome.deleteFailed", { name: automation.name }));
    } finally {
      setPendingAction(undefined);
    }
  };

  const requestDeleteRun = (reference: AutomationSessionReference, triggeredAtLabel: string) => {
    setDeleteState("idle");
    setDeleteTarget({ reference, triggeredAtLabel });
  };

  const deleteRun = async () => {
    if (!automation || !deleteTarget || deleteState === "deleting") return;
    setDeleteState("deleting");
    setNotice(undefined);
    const { sessionId } = deleteTarget.reference;
    try {
      await automationClient.removeSession({ automationId: automation.id, sessionId });
      setSessions((current) => current.filter((session) => session.sessionId !== sessionId));
      setAutomation((current) => {
        if (!current) return current;
        const sessions = current.sessions.filter((session) => session.sessionId !== sessionId);
        const latest = sessions[0];
        const {
          lastSessionId: _lastSessionId,
          lastTriggeredAt: _lastTriggeredAt,
          ...rest
        } = current;
        return {
          ...rest,
          sessions,
          ...(latest
            ? { lastSessionId: latest.sessionId, lastTriggeredAt: latest.triggeredAt }
            : {}),
        };
      });
      setNotice(
        t("extensions.workflows.automationTask.deleteRunSucceeded", {
          time: deleteTarget.triggeredAtLabel,
        }),
      );
      setDeleteTarget(undefined);
      setDeleteState("idle");
    } catch {
      setDeleteState("error");
    }
  };

  if (editingAutomationId && loadState !== "ready") {
    return (
      <section className="bg-background flex h-full min-h-0 items-center justify-center p-6">
        {loadState === "loading" ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm" role="status">
            <RefreshCwIcon aria-hidden="true" className="size-4 animate-spin" />
            {t("extensions.workflows.automationTask.loading")}
          </p>
        ) : (
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="text-destructive text-sm" role="alert">
              {t("extensions.workflows.automationTask.loadFailed")}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLoadAttempt((value) => value + 1)}
            >
              <RefreshCwIcon aria-hidden="true" />
              {t("extensions.workflows.sidebar.retry")}
            </Button>
          </div>
        )}
      </section>
    );
  }

  return (
    <>
      <section
        aria-labelledby="automation-task-title"
        className="bg-background h-full min-h-0 overflow-y-auto"
      >
        <form
          className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-10"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <header>
            <h1
              id="automation-task-title"
              className="text-foreground text-2xl font-semibold tracking-tight"
            >
              {t(
                editingAutomationId
                  ? "extensions.workflows.automationTask.editTitle"
                  : "extensions.workflows.automationTask.title",
              )}
            </h1>
            <p className="text-muted-foreground mt-2 text-sm leading-6">
              {t(
                editingAutomationId
                  ? "extensions.workflows.automationTask.editDescription"
                  : "extensions.workflows.automationTask.description",
              )}
            </p>
          </header>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
            <div
              className="bg-muted/60 flex items-center rounded-[var(--button-radius)] p-0.5"
              role="tablist"
              aria-label={t("extensions.workflows.automationTask.tabsLabel")}
            >
              {(["settings", "history"] as const).map((tab) => (
                <Button
                  key={tab}
                  type="button"
                  role="tab"
                  variant="ghost"
                  size="sm"
                  aria-selected={activeTab === tab}
                  className={cn("px-4", activeTab !== tab && "text-muted-foreground")}
                  onClick={() => setActiveTab(tab)}
                >
                  {t(`extensions.workflows.automationTask.${tab}`)}
                </Button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <Button type="submit" disabled={Boolean(pendingAction)}>
                {pendingAction === "save" ? (
                  <RefreshCwIcon aria-hidden="true" className="animate-spin" />
                ) : null}
                {t(
                  pendingAction === "save"
                    ? editingAutomationId
                      ? "extensions.workflows.automationTask.saving"
                      : "extensions.workflows.automationTask.creating"
                    : editingAutomationId
                      ? "extensions.workflows.automationTask.save"
                      : "extensions.workflows.automationTask.create",
                )}
              </Button>

              {editingAutomationId ? (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={Boolean(pendingAction)}
                    onClick={() => void submit(true)}
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
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          type="button"
                          variant="secondary"
                          size="icon"
                          aria-label={t("extensions.workflows.automationTask.moreActions")}
                        >
                          <MoreHorizontalIcon aria-hidden="true" />
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end" className="min-w-44 p-1.5">
                      <DropdownMenuItem
                        disabled={!automation || Boolean(pendingAction)}
                        onClick={() => void setTaskEnabled(!automation?.enabled)}
                      >
                        {automation?.enabled ? (
                          <CirclePauseIcon aria-hidden="true" />
                        ) : (
                          <CirclePlayIcon aria-hidden="true" />
                        )}
                        {t(
                          automation?.enabled
                            ? "extensions.workflows.automationHome.pause"
                            : "extensions.workflows.automationHome.enable",
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={!automation || Boolean(pendingAction)}
                        onClick={() => void archiveTask()}
                      >
                        <Trash2Icon aria-hidden="true" />
                        {t("extensions.workflows.automationHome.delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              ) : null}
            </div>
          </div>

          {activeTab === "settings" ? (
            <section className="mt-8 space-y-6" role="tabpanel">
              {automation ? (
                <div className="space-y-2">
                  <span className="text-muted-foreground text-sm">
                    {t("extensions.workflows.automationTask.status")}
                  </span>
                  <div>
                    <span className="bg-muted inline-flex h-[var(--button-height-default)] items-center gap-3 rounded-[var(--radius-md)] px-4 text-sm">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "size-2 rounded-full",
                          automation.enabled ? "bg-emerald-500" : "bg-muted-foreground",
                        )}
                      />
                      {t(
                        `extensions.workflows.automationTask.${automation.enabled ? "statusRunning" : "statusPaused"}`,
                      )}
                    </span>
                  </div>
                </div>
              ) : null}

              <div className="space-y-2">
                <label htmlFor="automation-task-name" className="text-muted-foreground text-sm">
                  {t("extensions.workflows.automationTask.taskTitle")}
                </label>
                <Input
                  id="automation-task-name"
                  ref={titleInputRef}
                  autoFocus
                  value={title}
                  aria-invalid={titleInvalid}
                  placeholder={t("extensions.workflows.automationTask.taskTitlePlaceholder")}
                  onChange={(event) => {
                    setNotice(undefined);
                    setTitle(event.currentTarget.value);
                  }}
                />
                {titleInvalid ? (
                  <p className="text-destructive text-xs" role="alert">
                    {t("extensions.workflows.automationTask.taskTitleRequired")}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-muted-foreground text-sm">
                  {t("extensions.workflows.automationTask.schedule")}
                </span>
                <div className="border-border bg-[var(--input-control-background)] flex min-h-[var(--input-control-height)] flex-wrap items-center gap-2 rounded-[var(--input-control-radius)] border p-1.5">
                  {hasSchedule ? (
                    <>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button type="button" size="sm" variant="outline">
                              {frequencyLabel}
                              <ChevronDownIcon aria-hidden="true" data-icon="inline-end" />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="start">
                          {SCHEDULE_FREQUENCIES.map((candidate) => (
                            <DropdownMenuItem
                              key={candidate}
                              onClick={() => setFrequency(candidate)}
                            >
                              {frequency === candidate ? <CheckIcon aria-hidden="true" /> : null}
                              {t(`extensions.workflows.automationTask.frequency.${candidate}`)}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      {frequency === "custom" ? (
                        <Input
                          id="automation-task-custom-cron"
                          ref={customCronInputRef}
                          value={customCron}
                          aria-label={t("extensions.workflows.automationTask.customCron")}
                          placeholder={t(
                            "extensions.workflows.automationTask.customCronPlaceholder",
                          )}
                          className="min-w-56 flex-1 font-mono"
                          onChange={(event) => setCustomCron(event.currentTarget.value)}
                        />
                      ) : scheduleUsesTime ? (
                        <TimePicker
                          ref={timePickerRef}
                          value={time}
                          required
                          invalid={validationRequested && !timeValid}
                          labels={{
                            time: t("extensions.workflows.automationTask.timeLabel", { time }),
                            hour: t("extensions.workflows.automationTask.hour"),
                            minute: t("extensions.workflows.automationTask.minute"),
                          }}
                          onValueChange={setTime}
                        />
                      ) : null}
                      {scheduleSummary ? (
                        <span className="text-muted-foreground min-w-48 flex-1 text-sm">
                          {scheduleSummary}
                        </span>
                      ) : null}
                      <InputGroup className="w-40 shrink-0">
                        <InputGroupInput
                          id="automation-task-max-run-duration"
                          type="number"
                          min={MIN_DURATION_MINUTES}
                          max={MAX_DURATION_MINUTES}
                          step={1}
                          value={maxRunDurationMinutes}
                          aria-label={t("extensions.workflows.automationTask.maxRunDuration")}
                          placeholder={t(
                            "extensions.workflows.automationTask.maxRunDurationPlaceholder",
                          )}
                          onChange={(event) => setMaxRunDurationMinutes(event.currentTarget.value)}
                        />
                        <InputGroupAddon align="inline-end">
                          {t("extensions.workflows.automationTask.minutes")}
                        </InputGroupAddon>
                      </InputGroup>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t("extensions.workflows.automationTask.removeSchedule")}
                        onClick={() => setHasSchedule(false)}
                      >
                        <Trash2Icon aria-hidden="true" />
                      </Button>
                    </>
                  ) : (
                    <Button
                      id="automation-task-add-schedule"
                      type="button"
                      variant="ghost"
                      onClick={() => setHasSchedule(true)}
                    >
                      <PlusIcon aria-hidden="true" />
                      {t("extensions.workflows.automationTask.addSchedule")}
                    </Button>
                  )}
                </div>
                {validationRequested && !scheduleValid ? (
                  <p className="text-destructive text-xs" role="alert">
                    {!hasSchedule
                      ? t("extensions.workflows.automationTask.scheduleRequired")
                      : !maxRunDurationValid
                        ? t("extensions.workflows.automationTask.maxRunDurationInvalid", {
                            max: MAX_DURATION_MINUTES,
                          })
                        : frequency === "custom"
                          ? t("extensions.workflows.automationTask.customCronRequired")
                          : t("extensions.workflows.automationTask.timeRequired")}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <label htmlFor="automation-task-prompt" className="text-muted-foreground text-sm">
                  {t("extensions.workflows.automationTask.instructions")}
                </label>
                <InputGroup aria-invalid={promptInvalid}>
                  <Textarea
                    id="automation-task-prompt"
                    ref={promptInputRef}
                    value={prompt}
                    aria-invalid={promptInvalid}
                    placeholder={t("extensions.workflows.automationTask.instructionsPlaceholder")}
                    className="min-h-24 resize-y rounded-none border-0 bg-transparent px-4 py-3 shadow-none focus-visible:ring-0"
                    onChange={(event) => setPrompt(event.currentTarget.value)}
                  />
                  <InputGroupAddon
                    align="block-end"
                    className="border-border flex-wrap justify-between gap-2 border-t px-2.5 py-1.5"
                  >
                    <WorkspaceSelector
                      triggerId="automation-task-workspace-trigger"
                      variant="outline"
                      labels={{
                        select: t("extensions.workspaceDirectory.selectTitle"),
                        clear: t("extensions.workspaceDirectory.clearWorkspace"),
                        selecting: t("extensions.workspaceDirectory.selecting"),
                        selectError: t("extensions.workspaceDirectory.selectError"),
                        empty: t("extensions.workflows.automationTask.noWorkspace"),
                        search: t("extensions.workspaceDirectory.searchLabel"),
                        searchPlaceholder: t("extensions.workspaceDirectory.searchPlaceholder"),
                        noSearchResults: t("extensions.workspaceDirectory.noSearchResults"),
                      }}
                      selectedWorkspace={workspace}
                      workspaces={workspaces}
                      onValueChange={setWorkspaceId}
                    />
                    <ModelSelectorControl
                      labels={{
                        select: t("assistant.model.select"),
                        model: t("assistant.model.model"),
                        reasoningEffort: t("assistant.model.reasoningEffort"),
                        search: t("extensions.modelSelector.searchLabel"),
                        searchPlaceholder: t("extensions.modelSelector.searchPlaceholder"),
                        loadFailed: t("extensions.modelSelector.loadFailed"),
                        noModels: t("extensions.modelSelector.noModels"),
                        noSearchResults: t("extensions.modelSelector.noSearchResults"),
                        selectFailed: t("extensions.modelSelector.selectFailed"),
                        currentUnavailable: t("extensions.modelSelector.currentUnavailable"),
                        saving: t("extensions.modelSelector.saving"),
                      }}
                      loadFailed={modelState === "error"}
                      currentUnavailable={selectedModel?.unavailable}
                      models={selectableModels}
                      selectedEffort={selectedEffort}
                      selectedModelId={selectedModel?.id}
                      getEffortLabel={(effort) => reasoningEffortLabel(effort, t)}
                      onEffortChange={setSelectedEffort}
                      onModelChange={(modelId) => {
                        const nextModel = selectableModels.find(({ id }) => id === modelId);
                        if (!nextModel) return;
                        const nextSelection = modelChangeSelection(nextModel);
                        setSelectedModelId(modelId);
                        setSelectedEffort(nextSelection.reasoningEffort);
                      }}
                    />
                  </InputGroupAddon>
                </InputGroup>
                {promptInvalid ? (
                  <p className="text-destructive text-xs" role="alert">
                    {t("extensions.workflows.automationTask.instructionsRequired")}
                  </p>
                ) : null}
                {validationRequested && !workspace ? (
                  <p className="text-destructive text-xs" role="alert">
                    {t("extensions.workflows.automationTask.workspaceRequired")}
                  </p>
                ) : null}
              </div>
            </section>
          ) : (
            <section className="mt-8" role="tabpanel">
              {historyState === "loading" && sessions.length === 0 ? (
                <div className="border-border text-muted-foreground flex min-h-48 items-center justify-center rounded-[var(--radius-lg)] border p-6 text-sm">
                  {t("extensions.workflows.runs.loading")}
                </div>
              ) : historyState === "error" && sessions.length === 0 ? (
                <div className="border-border flex min-h-48 flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] border p-6">
                  <p className="text-muted-foreground text-sm">
                    {t("extensions.workflows.automationTask.historyLoadFailed")}
                  </p>
                  <Button variant="outline" size="sm" onClick={() => void refreshSessions()}>
                    <RefreshCwIcon aria-hidden="true" />
                    {t("extensions.workflows.sidebar.retry")}
                  </Button>
                </div>
              ) : sessions.length === 0 ? (
                <div className="border-border text-muted-foreground flex min-h-48 items-center justify-center rounded-[var(--radius-lg)] border p-6 text-sm">
                  {t("extensions.workflows.automationTask.historyEmpty")}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-[var(--radius-lg)]">
                  <table className="w-full min-w-[44rem] table-fixed text-sm">
                    <caption className="sr-only">
                      {t("extensions.workflows.automationTask.history")}
                    </caption>
                    <thead className="bg-muted/60 text-muted-foreground">
                      <tr className="border-border h-10 border-b">
                        <th scope="col" className="px-4 text-start font-normal">
                          {t("extensions.workflows.automationTask.historyColumns.triggeredAt")}
                        </th>
                        <th scope="col" className="w-1/6 px-4 text-start font-normal">
                          {t("extensions.workflows.automationTask.historyColumns.source")}
                        </th>
                        <th scope="col" className="w-1/5 px-4 text-start font-normal">
                          {t("extensions.workflows.automationTask.historyColumns.status")}
                        </th>
                        <th scope="col" className="w-1/5 px-4 text-start font-normal">
                          {t("extensions.workflows.automationTask.historyColumns.duration")}
                        </th>
                        <th scope="col" className="w-14">
                          <span className="sr-only">
                            {t("extensions.workflows.automationTask.historyColumns.actions")}
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.map((session) => {
                        const triggeredAt = dateTimeFormatter.format(new Date(session.triggeredAt));
                        const snapshot = sessionSnapshots.get(session.sessionId);
                        const runStatus = snapshot?.isRunning
                          ? "running"
                          : snapshot?.lastMessageAt
                            ? "succeeded"
                            : "unavailable";
                        const completedAt = snapshot?.lastMessageAt?.getTime();
                        const duration =
                          runStatus === "succeeded" &&
                          completedAt !== undefined &&
                          completedAt >= session.triggeredAt
                            ? formatCompactDuration(completedAt - session.triggeredAt, locale, {
                                includeZero: true,
                              })
                            : "—";
                        return (
                          <tr key={session.sessionId} className="text-muted-foreground h-16">
                            <td className="px-4 tabular-nums whitespace-nowrap">{triggeredAt}</td>
                            <td className="px-4 whitespace-nowrap">
                              {t(`extensions.workflows.automationTask.runSource.${session.source}`)}
                            </td>
                            <td className="px-4 whitespace-nowrap">
                              <span
                                className={cn(
                                  "inline-flex items-center gap-2 font-medium",
                                  runStatus === "succeeded"
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : runStatus === "running"
                                      ? "text-primary"
                                      : "text-muted-foreground",
                                )}
                              >
                                <span
                                  aria-hidden="true"
                                  className={cn(
                                    "size-2 rounded-full",
                                    runStatus === "succeeded"
                                      ? "bg-emerald-500"
                                      : runStatus === "running"
                                        ? "bg-primary"
                                        : "bg-muted-foreground/60",
                                  )}
                                />
                                {t(`extensions.workflows.automationTask.runStatus.${runStatus}`)}
                              </span>
                            </td>
                            <td className="px-4 tabular-nums whitespace-nowrap">{duration}</td>
                            <td className="pe-2 text-end">
                              <DropdownMenu>
                                <DropdownMenuTrigger
                                  render={
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      aria-label={t(
                                        "extensions.workflows.automationTask.runActions",
                                        { time: triggeredAt },
                                      )}
                                    >
                                      <MoreHorizontalIcon aria-hidden="true" />
                                    </Button>
                                  }
                                />
                                <DropdownMenuContent align="end" className="min-w-40 p-1.5">
                                  <DropdownMenuItem
                                    onClick={() => navigation.openThread(session.sessionId)}
                                  >
                                    <MessageSquareIcon aria-hidden="true" />
                                    {t("extensions.workflows.automationTask.goToConversation")}
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    variant="destructive"
                                    disabled={runStatus === "running"}
                                    title={
                                      runStatus === "running"
                                        ? t(
                                            "extensions.workflows.automationTask.deleteActiveRunUnavailable",
                                          )
                                        : undefined
                                    }
                                    onClick={() => requestDeleteRun(session, triggeredAt)}
                                  >
                                    <Trash2Icon aria-hidden="true" />
                                    {t("extensions.workflows.automationTask.deleteRun")}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          <div className="min-h-6 pt-4">
            {error ? (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            ) : notice ? (
              <p className="text-muted-foreground text-sm" role="status">
                {notice}
              </p>
            ) : null}
          </div>
        </form>
      </section>
      <Dialog
        open={deleteTarget !== undefined}
        onOpenChange={(open) => {
          if (!open && deleteState !== "deleting") {
            setDeleteTarget(undefined);
            setDeleteState("idle");
          }
        }}
      >
        <DialogContent
          closeLabel={t("extensions.workflows.automationTask.cancelDeleteRun")}
          showCloseButton={false}
        >
          <DialogHeader>
            <DialogTitle>{t("extensions.workflows.automationTask.deleteRunTitle")}</DialogTitle>
            <DialogDescription>
              {t("extensions.workflows.automationTask.deleteRunDescription")}
            </DialogDescription>
          </DialogHeader>
          {deleteState === "error" ? (
            <p className="text-destructive text-xs leading-5" role="alert">
              {t("extensions.workflows.automationTask.deleteRunFailed")}
            </p>
          ) : null}
          <DialogFooter closeLabel={t("extensions.workflows.automationTask.cancelDeleteRun")}>
            <Button
              type="button"
              variant="outline"
              disabled={deleteState === "deleting"}
              onClick={() => {
                setDeleteTarget(undefined);
                setDeleteState("idle");
              }}
            >
              {t("extensions.workflows.automationTask.cancelDeleteRun")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!deleteTarget || deleteState === "deleting"}
              onClick={() => void deleteRun()}
            >
              {deleteState === "deleting" ? (
                <RefreshCwIcon aria-hidden="true" className="animate-spin" />
              ) : (
                <Trash2Icon aria-hidden="true" />
              )}
              {t(
                deleteState === "deleting"
                  ? "extensions.workflows.automationTask.deletingRun"
                  : "extensions.workflows.automationTask.confirmDeleteRun",
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ProjectTrustDialog {...trustAdmission.dialog} />
    </>
  );
}
