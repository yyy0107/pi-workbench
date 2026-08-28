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
import { ModelSelector as ModelSelectorControl } from "@/components/ui/model-selector";
import type { ModelSelectorOption } from "@/components/ui/model-selector-models";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";
import { TimePicker } from "@/components/ui/time-picker";
import { WorkspaceSelector } from "@/components/ui/workspace-selector";
import { useI18n } from "@/i18n";
import { formatCompactDuration } from "@/lib/format-duration";
import { cn } from "@/lib/utils";
import { useMainViewService, useNavigationService } from "@/platform/extensions";
import { usePiHostDescription, usePiWorkspaces } from "@/runtime/pi/client/runtime/context";
import { listPiModelCatalog } from "@/runtime/pi/client/transport/api";
import { workflowClient } from "@/runtime/pi/client/workflows/workflow-client";
import { PI_THINKING_LEVELS, type PiThinkingLevel } from "@/runtime/pi/contracts/pi";
import type { ModelCatalogValue } from "@/runtime/pi/contracts/rpc";
import type {
  AgentNode,
  ScheduleTriggerSpec,
  WorkflowDocument,
  WorkflowRunSource,
  WorkflowRunStatus,
  WorkflowRunSummary,
  WorkflowTriggerState,
} from "@/runtime/shared/execution";
import {
  MAX_SCHEDULE_RUN_DURATION_SECONDS,
  MIN_SCHEDULE_RUN_DURATION_SECONDS,
} from "@/runtime/shared/execution";

import { workflowMainViewRequest, type WorkflowMainViewParams } from "./workflow-main-view";
import { useWorkflowRunHistory } from "./use-workflow-run-history";
import { useWorkflowCatalogStore } from "./workflow-state";
import { createLinearWorkflowGraph } from "./workflow-template-utils";

type AutomationTaskParams = Extract<
  WorkflowMainViewParams,
  { page: "automation-create" | "automation-edit" }
>;
const SCHEDULE_FREQUENCIES = [
  "hourly",
  "daily",
  "weekdays",
  "weekly",
  "monthly",
  "custom",
] as const;
type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];
type AutomationTaskTab = "settings" | "history";
type PendingTaskAction = "save" | "run" | "toggle" | "archive";
type RunDeleteState = "idle" | "deleting" | "error";

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

const RUN_SOURCE_KEYS = {
  manual: "manual",
  schedule: "schedule",
  event: "event",
  replay: "replay",
} as const satisfies Record<WorkflowRunSource, string>;

const MIN_SCHEDULE_RUN_DURATION_MINUTES = MIN_SCHEDULE_RUN_DURATION_SECONDS / 60;
const MAX_SCHEDULE_RUN_DURATION_MINUTES = MAX_SCHEDULE_RUN_DURATION_SECONDS / 60;

function runSessionId(run: WorkflowRunSummary): string | undefined {
  return run.attempts.findLast(({ sessionId }) => sessionId !== undefined)?.sessionId;
}

function modelKey(provider: string, modelId: string): string {
  return JSON.stringify([provider, modelId]);
}

function isThinkingLevel(value: string): value is PiThinkingLevel {
  return PI_THINKING_LEVELS.includes(value as PiThinkingLevel);
}

function modelOptions(catalog: ModelCatalogValue): ModelSelectorOption[] {
  return catalog.groups.flatMap((group) =>
    group.models.map((model) => {
      const efforts = (model.reasoning?.efforts ?? [])
        .filter((effort) => isThinkingLevel(effort.id))
        .map((effort) => ({ id: effort.id as PiThinkingLevel, name: effort.name }));
      const defaultEffort = model.reasoning?.defaultEffort;
      return {
        id: modelKey(group.id, model.id),
        provider: group.id,
        providerName: group.name,
        model: model.id,
        name: model.name,
        efforts,
        ...(defaultEffort && isThinkingLevel(defaultEffort) ? { defaultEffort } : {}),
      };
    }),
  );
}

function scheduleCron(frequency: ScheduleFrequency, time: string, customCron: string): string {
  const [hour = "9", minute = "0"] = time.split(":");
  switch (frequency) {
    case "hourly":
      return "0 * * * *";
    case "daily":
      return `${Number(minute)} ${Number(hour)} * * *`;
    case "weekdays":
      return `${Number(minute)} ${Number(hour)} * * 1-5`;
    case "weekly":
      return `${Number(minute)} ${Number(hour)} * * 1`;
    case "monthly":
      return `${Number(minute)} ${Number(hour)} 1 * *`;
    case "custom":
      return customCron.trim();
  }
}

function parseScheduleCron(cron: string): {
  frequency: ScheduleFrequency;
  time: string;
  customCron: string;
} {
  const normalized = cron.trim().replace(/\s+/g, " ");
  if (normalized === "0 * * * *") {
    return { frequency: "hourly", time: "09:00", customCron: "" };
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek, ...extra] = normalized.split(" ");
  const minuteValue = Number(minute);
  const hourValue = Number(hour);
  const fixedTime =
    extra.length === 0 &&
    Number.isInteger(minuteValue) &&
    minuteValue >= 0 &&
    minuteValue <= 59 &&
    Number.isInteger(hourValue) &&
    hourValue >= 0 &&
    hourValue <= 23;
  if (!fixedTime || month !== "*") {
    return { frequency: "custom", time: "09:00", customCron: cron };
  }
  const time = `${String(hourValue).padStart(2, "0")}:${String(minuteValue).padStart(2, "0")}`;
  if (dayOfMonth === "*" && dayOfWeek === "*") {
    return { frequency: "daily", time, customCron: "" };
  }
  if (dayOfMonth === "*" && dayOfWeek === "1-5") {
    return { frequency: "weekdays", time, customCron: "" };
  }
  if (dayOfMonth === "*" && dayOfWeek === "1") {
    return { frequency: "weekly", time, customCron: "" };
  }
  if (dayOfMonth === "1" && dayOfWeek === "*") {
    return { frequency: "monthly", time, customCron: "" };
  }
  return { frequency: "custom", time: "09:00", customCron: cron };
}

function timezoneOffset(timezone: string, locale: string): string {
  try {
    const part = new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      timeZoneName: "shortOffset",
    })
      .formatToParts(new Date())
      .find(({ type }) => type === "timeZoneName");
    return part?.value ?? timezone;
  } catch {
    return timezone;
  }
}

export function AutomationTaskForm({ params }: { params: AutomationTaskParams }) {
  const { locale, t } = useI18n();
  const mainViews = useMainViewService();
  const navigation = useNavigationService();
  const workspaces = usePiWorkspaces();
  const host = usePiHostDescription();
  const editingWorkflowId = params.page === "automation-edit" ? params.workflowId : undefined;
  const {
    runs: taskRuns,
    loadState: taskRunsLoadState,
    refresh: refreshTaskRuns,
  } = useWorkflowRunHistory(editingWorkflowId);
  const presetName = params.page === "automation-create" ? params.preset : undefined;
  const preset = useMemo(() => {
    if (presetName === "morning-briefing") {
      return {
        title: t("extensions.workflows.automationHome.templates.morningBriefing.name"),
        prompt: t("extensions.workflows.automationHome.templates.morningBriefing.prompt"),
        time: "09:00",
        frequency: "weekdays" as const,
      };
    }
    if (presetName === "risk-scan") {
      return {
        title: t("extensions.workflows.automationHome.templates.riskScan.name"),
        prompt: t("extensions.workflows.automationHome.templates.riskScan.prompt"),
        time: "10:00",
        frequency: "daily" as const,
      };
    }
    return undefined;
  }, [presetName, t]);
  const localTimezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const [title, setTitle] = useState(
    preset?.title ?? t("extensions.workflows.automationTask.untitledTask"),
  );
  const [prompt, setPrompt] = useState(preset?.prompt ?? "");
  const [frequency, setFrequency] = useState<ScheduleFrequency>(preset?.frequency ?? "weekdays");
  const [time, setTime] = useState(preset?.time ?? "09:00");
  const [customCron, setCustomCron] = useState("");
  const [hasSchedule, setHasSchedule] = useState(Boolean(preset));
  const [timezone, setTimezone] = useState(localTimezone);
  const [maxRunDurationMinutes, setMaxRunDurationMinutes] = useState("");
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [models, setModels] = useState<ModelSelectorOption[]>([]);
  const [fallbackModel, setFallbackModel] = useState<ModelSelectorOption>();
  const [modelState, setModelState] = useState<"loading" | "ready" | "error">("loading");
  const [selectedModelKey, setSelectedModelKey] = useState("");
  const [thinkingLevel, setThinkingLevel] = useState<PiThinkingLevel>();
  const [sourceDocument, setSourceDocument] = useState<WorkflowDocument>();
  const [triggerStates, setTriggerStates] = useState<WorkflowTriggerState[]>([]);
  const [activeTab, setActiveTab] = useState<AutomationTaskTab>("settings");
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    editingWorkflowId ? "loading" : "ready",
  );
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [validationRequested, setValidationRequested] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingTaskAction>();
  const [runToDelete, setRunToDelete] = useState<WorkflowRunSummary>();
  const [runDeleteState, setRunDeleteState] = useState<RunDeleteState>("idle");
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const titleInputRef = useRef<HTMLInputElement>(null);
  const timePickerRef = useRef<HTMLButtonElement>(null);
  const customCronInputRef = useRef<HTMLInputElement>(null);
  const promptInputRef = useRef<HTMLTextAreaElement>(null);

  const selectableModels = useMemo(() => {
    if (!fallbackModel) return models;
    const catalogModel = models.find(({ id }) => id === fallbackModel.id);
    if (!catalogModel) return [fallbackModel, ...models];
    const missingEfforts = (fallbackModel.efforts ?? []).filter(
      (effort) => !catalogModel.efforts?.some(({ id }) => id === effort.id),
    );
    if (missingEfforts.length === 0) return models;
    return models.map((model) =>
      model.id === catalogModel.id
        ? { ...model, efforts: [...(model.efforts ?? []), ...missingEfforts] }
        : model,
    );
  }, [fallbackModel, models]);

  useEffect(() => {
    if (!workspaceId && workspaces[0]) setWorkspaceId(workspaces[0].id);
  }, [workspaceId, workspaces]);

  useEffect(() => {
    if (!editingWorkflowId) return;
    let disposed = false;
    setLoadState("loading");
    setError(undefined);
    void workflowClient
      .read({ workflowId: editingWorkflowId })
      .then(({ document, triggerStates: loadedTriggerStates }) => {
        if (disposed) return;
        if (document.kind !== "automation") throw new Error("workflow-kind-mismatch");
        const agent = document.graph.nodes.find((node): node is AgentNode => node.type === "agent");
        const schedule = document.triggers.find(
          (trigger): trigger is ScheduleTriggerSpec => trigger.type === "schedule",
        );
        const parsedSchedule = parseScheduleCron(schedule?.cron ?? "0 9 * * 1-5");
        setTitle(document.name);
        setPrompt(agent?.config.prompt ?? document.description ?? "");
        setFrequency(parsedSchedule.frequency);
        setTime(parsedSchedule.time);
        setCustomCron(parsedSchedule.customCron);
        setHasSchedule(Boolean(schedule));
        setTimezone(schedule?.timezone ?? localTimezone);
        setMaxRunDurationMinutes(
          schedule?.maxRunDurationSeconds === undefined
            ? ""
            : String(schedule.maxRunDurationSeconds / 60),
        );
        setWorkspaceId(
          schedule?.targetWorkspaceId ??
            (document.scope.type === "project" ? document.scope.workspaceId : ""),
        );
        if (agent?.config.model) {
          const key = modelKey(agent.config.model.provider, agent.config.model.modelId);
          setFallbackModel({
            id: key,
            provider: agent.config.model.provider,
            providerName: agent.config.model.provider,
            model: agent.config.model.modelId,
            name: agent.config.model.modelId,
            efforts: agent.config.model.thinkingLevel
              ? [
                  {
                    id: agent.config.model.thinkingLevel,
                    name: agent.config.model.thinkingLevel,
                  },
                ]
              : [],
            ...(agent.config.model.thinkingLevel
              ? { defaultEffort: agent.config.model.thinkingLevel }
              : {}),
            unavailable: true,
          });
          setSelectedModelKey(key);
          setThinkingLevel(agent.config.model.thinkingLevel);
        }
        setSourceDocument(document);
        setTriggerStates(loadedTriggerStates);
        setLoadState("ready");
      })
      .catch(() => {
        if (!disposed) setLoadState("error");
      });
    return () => {
      disposed = true;
    };
  }, [editingWorkflowId, loadAttempt, localTimezone]);

  useEffect(() => {
    let disposed = false;
    setModelState("loading");
    void listPiModelCatalog()
      .then((catalog) => {
        if (disposed) return;
        setModels(modelOptions(catalog));
        setModelState("ready");
      })
      .catch(() => {
        if (!disposed) setModelState("error");
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (selectableModels.length === 0) return;
    if (selectedModelKey && selectableModels.some(({ id }) => id === selectedModelKey)) return;
    const hostDefault =
      host?.provider && host.model
        ? models.find(({ provider, model }) => provider === host.provider && model === host.model)
        : undefined;
    setSelectedModelKey((hostDefault ?? selectableModels[0])?.id ?? "");
  }, [host?.model, host?.provider, models, selectableModels, selectedModelKey]);

  const selectedModel = selectableModels.find(({ id }) => id === selectedModelKey);
  useEffect(() => {
    if (selectableModels.length === 0) return;
    setThinkingLevel((current) => {
      if (selectedModel?.efforts?.some(({ id }) => id === current)) return current;
      const fallback = selectedModel?.defaultEffort ?? selectedModel?.efforts?.[0]?.id;
      return fallback && isThinkingLevel(fallback) ? fallback : undefined;
    });
  }, [selectableModels.length, selectedModel]);

  useEffect(() => {
    if (activeTab === "history") void refreshTaskRuns();
  }, [activeTab, refreshTaskRuns]);
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
  const scheduleEnabled = triggerStates.some(({ enabled }) => enabled);
  const statusKey = scheduleEnabled ? "statusRunning" : "statusPaused";

  const titleInvalid = validationRequested && !title.trim();
  const promptInvalid = validationRequested && !prompt.trim();
  const workspace = workspaces.find(({ id }) => id === workspaceId);
  const timeValid = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
  const customCronValid = Boolean(customCron.trim());
  const parsedMaxRunDurationMinutes = Number(maxRunDurationMinutes);
  const maxRunDurationValid =
    maxRunDurationMinutes.trim() === "" ||
    (Number.isInteger(parsedMaxRunDurationMinutes) &&
      parsedMaxRunDurationMinutes >= MIN_SCHEDULE_RUN_DURATION_MINUTES &&
      parsedMaxRunDurationMinutes <= MAX_SCHEDULE_RUN_DURATION_MINUTES);
  const scheduleUsesTime = frequency !== "hourly" && frequency !== "custom";
  const scheduleValid =
    hasSchedule &&
    maxRunDurationValid &&
    (frequency === "custom" ? customCronValid : !scheduleUsesTime || timeValid);
  const frequencyLabel = t(`extensions.workflows.automationTask.frequency.${frequency}`);
  const recurrence = t(`extensions.workflows.automationTask.frequencySummary.${frequency}`);
  const timezoneLabel = timezoneOffset(timezone, locale);
  const scheduleSummary =
    frequency === "custom"
      ? customCronValid
        ? t("extensions.workflows.automationTask.customScheduleSummary", {
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
    if (
      !title.trim() ||
      !prompt.trim() ||
      !workspaceId ||
      !scheduleValid ||
      (editingWorkflowId && !sourceDocument)
    ) {
      setActiveTab("settings");
      requestAnimationFrame(() => {
        if (!title.trim()) titleInputRef.current?.focus();
        else if (!hasSchedule) document.getElementById("automation-task-add-schedule")?.focus();
        else if (frequency === "custom" && !customCronValid) customCronInputRef.current?.focus();
        else if (scheduleUsesTime && !timeValid) timePickerRef.current?.focus();
        else if (!maxRunDurationValid)
          document.getElementById("automation-task-max-run-duration")?.focus();
        else if (!prompt.trim()) promptInputRef.current?.focus();
        else if (!workspaceId)
          document.getElementById("automation-task-workspace-trigger")?.focus();
      });
      return;
    }
    setPendingAction(runAfterSave ? "run" : "save");
    setError(undefined);
    setNotice(undefined);
    try {
      const baseDocument =
        sourceDocument ??
        (
          await workflowClient.create({
            kind: "automation",
            scope: { type: "personal" },
            name: title.trim(),
          })
        ).document;
      const existingAgent = baseDocument.graph.nodes.find(
        (node): node is AgentNode => node.type === "agent",
      );
      const agentConfig: AgentNode["config"] = {
        ...existingAgent?.config,
        prompt: prompt.trim(),
        ...(selectedModel
          ? {
              model: {
                provider: selectedModel.provider,
                modelId: selectedModel.model,
                ...(thinkingLevel ? { thinkingLevel } : {}),
              },
            }
          : {}),
      };
      const agentNode: AgentNode = {
        id: existingAgent?.id ?? globalThis.crypto.randomUUID(),
        type: "agent",
        name: title.trim(),
        position: existingAgent?.position ?? { x: 0, y: 0 },
        config: agentConfig,
      };
      const graph = existingAgent
        ? {
            ...baseDocument.graph,
            nodes: baseDocument.graph.nodes.map((node) =>
              node.id === existingAgent.id ? agentNode : node,
            ),
          }
        : createLinearWorkflowGraph(baseDocument, [agentNode]).graph;
      const existingSchedule = baseDocument.triggers.find(
        (trigger): trigger is ScheduleTriggerSpec => trigger.type === "schedule",
      );
      const nextSchedule: ScheduleTriggerSpec = {
        id: existingSchedule?.id ?? globalThis.crypto.randomUUID(),
        type: "schedule",
        name: t("extensions.workflows.automationTask.triggerName", {
          title: title.trim(),
        }),
        cron: scheduleCron(frequency, time, customCron),
        timezone,
        ...(maxRunDurationMinutes.trim() === ""
          ? {}
          : { maxRunDurationSeconds: parsedMaxRunDurationMinutes * 60 }),
        targetWorkspaceId: workspaceId,
      };
      const previousTriggerStates = new Map(
        triggerStates.map((state) => [state.triggerId, state] as const),
      );
      const savedDraft = await workflowClient.saveDraft({
        workflowId: baseDocument.id,
        baseDraftRevision: baseDocument.draftRevision,
        draft: {
          ...baseDocument,
          name: title.trim(),
          description: prompt.trim().slice(0, 240),
          graph,
          triggers: existingSchedule
            ? baseDocument.triggers.map((trigger) =>
                trigger.id === existingSchedule.id ? nextSchedule : trigger,
              )
            : [...baseDocument.triggers, nextSchedule],
        },
      });
      const published = await workflowClient.publish({
        workflowId: savedDraft.document.id,
        baseDraftRevision: savedDraft.document.draftRevision,
      });
      setSourceDocument(published.document);
      setTriggerStates(published.triggerStates);
      let nextTriggerStates: WorkflowTriggerState[];
      try {
        nextTriggerStates = await Promise.all(
          published.document.triggers.map((trigger) =>
            workflowClient.setTriggerEnabled({
              workflowId: published.document.id,
              triggerId: trigger.id,
              enabled: previousTriggerStates.get(trigger.id)?.enabled ?? true,
            }),
          ),
        );
      } catch (triggerError) {
        const snapshot = await workflowClient.listTriggers({
          workflowId: published.document.id,
        });
        setTriggerStates(snapshot.states);
        await useWorkflowCatalogStore.getState().refresh();
        throw triggerError;
      }
      setTriggerStates(nextTriggerStates);
      nextTriggerStates.forEach((state) =>
        useWorkflowCatalogStore.getState().applyHostPayload({
          type: "host/workflow-trigger-changed",
          state,
        }),
      );
      await useWorkflowCatalogStore.getState().refresh();
      if (runAfterSave) {
        const admission = await workflowClient.startRun({
          workflowId: published.document.id,
          revisionSource: "published",
          source: "manual",
          targetWorkspaceId: workspaceId,
        });
        if (admission.kind === "skipped") {
          setNotice(
            t("extensions.workflows.automationHome.alreadyRunning", {
              name: published.document.name,
            }),
          );
        } else {
          useWorkflowCatalogStore.getState().applyHostPayload({
            type: "host/workflow-run-changed",
            run: admission.run,
          });
          setNotice(
            t("extensions.workflows.automationHome.runStarted", {
              name: published.document.name,
            }),
          );
        }
      } else if (editingWorkflowId) {
        setNotice(t("extensions.workflows.automationTask.saved"));
      } else {
        mainViews.open(workflowMainViewRequest({ page: "automations" }));
      }
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : t(
              editingWorkflowId
                ? "extensions.workflows.automationTask.saveFailed"
                : "extensions.workflows.automationTask.createFailed",
            ),
      );
    } finally {
      setPendingAction(undefined);
    }
  };

  const setTaskEnabled = async (enabled: boolean) => {
    if (!editingWorkflowId || !sourceDocument) return;
    setPendingAction("toggle");
    setError(undefined);
    setNotice(undefined);
    try {
      const snapshot = await workflowClient.listTriggers({ workflowId: editingWorkflowId });
      if (snapshot.states.length === 0) {
        setError(
          t("extensions.workflows.automationHome.noTriggerToEnable", {
            name: sourceDocument.name,
          }),
        );
        return;
      }
      const nextStates = await Promise.all(
        snapshot.states.map(({ triggerId }) =>
          workflowClient.setTriggerEnabled({
            workflowId: editingWorkflowId,
            triggerId,
            enabled,
          }),
        ),
      );
      setTriggerStates(nextStates);
      nextStates.forEach((state) =>
        useWorkflowCatalogStore.getState().applyHostPayload({
          type: "host/workflow-trigger-changed",
          state,
        }),
      );
      setNotice(
        t(
          enabled
            ? "extensions.workflows.automationHome.enabledFeedback"
            : "extensions.workflows.automationHome.disabledFeedback",
          { name: title.trim() || sourceDocument.name },
        ),
      );
    } catch {
      setError(
        t("extensions.workflows.automationHome.toggleFailed", {
          name: title.trim() || sourceDocument.name,
        }),
      );
    } finally {
      setPendingAction(undefined);
    }
  };

  const archiveTask = async () => {
    if (!editingWorkflowId || !sourceDocument) return;
    setPendingAction("archive");
    setError(undefined);
    setNotice(undefined);
    try {
      await workflowClient.archive({ workflowId: editingWorkflowId, archived: true });
      useWorkflowCatalogStore.getState().applyHostPayload({
        type: "host/workflow-removed",
        workflowId: editingWorkflowId,
      });
      mainViews.open(workflowMainViewRequest({ page: "automations" }));
    } catch {
      setError(
        t("extensions.workflows.automationHome.deleteFailed", {
          name: title.trim() || sourceDocument.name,
        }),
      );
    } finally {
      setPendingAction(undefined);
    }
  };

  const deleteRun = async () => {
    if (!runToDelete || ACTIVE_RUN_STATUSES.includes(runToDelete.status)) return;
    setRunDeleteState("deleting");
    try {
      const deleted = await workflowClient.deleteRun({ runId: runToDelete.id });
      useWorkflowCatalogStore.getState().applyHostPayload({
        type: "host/workflow-run-removed",
        runId: deleted.runId,
        workflowId: deleted.workflowId,
      });
      setRunToDelete(undefined);
      setRunDeleteState("idle");
    } catch {
      setRunDeleteState("error");
    }
  };

  if (editingWorkflowId && loadState !== "ready") {
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
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLoadAttempt((n) => n + 1)}
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
    <section
      aria-labelledby="workflow-automation-task-title"
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
            id="workflow-automation-task-title"
            className="text-foreground text-2xl font-semibold tracking-tight"
          >
            {t(
              editingWorkflowId
                ? "extensions.workflows.automationTask.editTitle"
                : "extensions.workflows.automationTask.title",
            )}
          </h1>
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            {t(
              editingWorkflowId
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
            {(["settings", "history"] as const).map((tab) => {
              const selected = activeTab === tab;
              return (
                <Button
                  key={tab}
                  type="button"
                  role="tab"
                  variant="ghost"
                  size="sm"
                  aria-selected={selected}
                  aria-controls={`automation-task-${tab}-panel`}
                  id={`automation-task-${tab}-tab`}
                  className={cn("px-4", !selected && "text-muted-foreground")}
                  onClick={() => setActiveTab(tab)}
                >
                  {t(`extensions.workflows.automationTask.${tab}`)}
                </Button>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="submit"
              disabled={Boolean(pendingAction)}
              aria-describedby={error ? "automation-task-submit-error" : undefined}
            >
              {pendingAction === "save" ? (
                <RefreshCwIcon aria-hidden="true" className="animate-spin" />
              ) : null}
              {t(
                pendingAction === "save"
                  ? editingWorkflowId
                    ? "extensions.workflows.automationTask.saving"
                    : "extensions.workflows.automationTask.creating"
                  : editingWorkflowId
                    ? "extensions.workflows.automationTask.save"
                    : "extensions.workflows.automationTask.create",
              )}
            </Button>

            {editingWorkflowId ? (
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
                      className="min-h-9 gap-2 px-2.5"
                      disabled={
                        !sourceDocument?.publishedRevisionId ||
                        triggerStates.length === 0 ||
                        Boolean(pendingAction)
                      }
                      onClick={() => void setTaskEnabled(!scheduleEnabled)}
                    >
                      {pendingAction === "toggle" ? (
                        <RefreshCwIcon aria-hidden="true" className="animate-spin" />
                      ) : scheduleEnabled ? (
                        <CirclePauseIcon aria-hidden="true" />
                      ) : (
                        <CirclePlayIcon aria-hidden="true" />
                      )}
                      {t(
                        scheduleEnabled
                          ? "extensions.workflows.automationHome.pause"
                          : "extensions.workflows.automationHome.enable",
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      className="min-h-9 gap-2 px-2.5"
                      disabled={Boolean(pendingAction)}
                      onClick={() => void archiveTask()}
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
              </>
            ) : null}
          </div>
        </div>

        {activeTab === "settings" ? (
          <section
            id="automation-task-settings-panel"
            role="tabpanel"
            aria-labelledby="automation-task-settings-tab"
            className="mt-8 space-y-6"
          >
            {editingWorkflowId ? (
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
                        statusKey === "statusRunning" ? "bg-emerald-500" : "bg-muted-foreground",
                      )}
                    />
                    {t(`extensions.workflows.automationTask.${statusKey}`)}
                  </span>
                </div>
              </div>
            ) : null}
            <div className="space-y-2">
              <label htmlFor="automation-task-title" className="text-muted-foreground text-sm">
                {t("extensions.workflows.automationTask.taskTitle")}
              </label>
              <Input
                id="automation-task-title"
                ref={titleInputRef}
                autoFocus
                value={title}
                aria-required="true"
                aria-invalid={titleInvalid}
                aria-describedby={titleInvalid ? "automation-task-title-error" : undefined}
                placeholder={t("extensions.workflows.automationTask.taskTitlePlaceholder")}
                onChange={(event) => {
                  setNotice(undefined);
                  setTitle(event.currentTarget.value);
                }}
              />
              {titleInvalid ? (
                <p
                  id="automation-task-title-error"
                  className="text-destructive text-xs"
                  role="alert"
                >
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
                          <Button type="button" size="sm" variant="secondary">
                            {frequencyLabel}
                            <ChevronDownIcon aria-hidden="true" data-icon="inline-end" />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="start">
                        {SCHEDULE_FREQUENCIES.map((candidate) => (
                          <DropdownMenuItem
                            key={candidate}
                            onClick={() => {
                              setNotice(undefined);
                              setFrequency(candidate);
                            }}
                          >
                            {frequency === candidate ? <CheckIcon aria-hidden="true" /> : null}
                            {t(`extensions.workflows.automationTask.frequency.${candidate}`)}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {frequency === "custom" ? (
                      <>
                        <label
                          htmlFor="automation-task-custom-cron"
                          className="text-muted-foreground text-sm"
                        >
                          {t("extensions.workflows.automationTask.customCron")}
                        </label>
                        <Input
                          id="automation-task-custom-cron"
                          ref={customCronInputRef}
                          value={customCron}
                          aria-required="true"
                          aria-invalid={validationRequested && !customCronValid}
                          aria-describedby={
                            validationRequested && !customCronValid
                              ? "automation-task-custom-cron-error"
                              : undefined
                          }
                          placeholder={t(
                            "extensions.workflows.automationTask.customCronPlaceholder",
                          )}
                          className="min-w-56 flex-1 font-mono"
                          onChange={(event) => {
                            setNotice(undefined);
                            setCustomCron(event.currentTarget.value);
                          }}
                        />
                      </>
                    ) : scheduleUsesTime ? (
                      <>
                        <span className="text-muted-foreground text-sm">
                          {t("extensions.workflows.automationTask.at")}
                        </span>
                        <TimePicker
                          ref={timePickerRef}
                          value={time}
                          required
                          invalid={validationRequested && !timeValid}
                          describedBy={
                            validationRequested && !timeValid
                              ? "automation-task-time-error"
                              : undefined
                          }
                          labels={{
                            time: t("extensions.workflows.automationTask.timeLabel", { time }),
                            hour: t("extensions.workflows.automationTask.hour"),
                            minute: t("extensions.workflows.automationTask.minute"),
                          }}
                          onValueChange={(value) => {
                            setNotice(undefined);
                            setTime(value);
                          }}
                        />
                      </>
                    ) : null}
                    {scheduleSummary ? (
                      <span className="text-muted-foreground min-w-48 flex-1 text-sm">
                        {scheduleSummary}
                      </span>
                    ) : null}
                    <div className="flex h-[var(--dropdown-control-height)] shrink-0 items-center gap-2">
                      <label
                        htmlFor="automation-task-max-run-duration"
                        className="text-muted-foreground leading-none whitespace-nowrap text-sm"
                      >
                        {t("extensions.workflows.automationTask.maxRunDuration")}
                      </label>
                      <InputGroup className="w-40 shrink-0">
                        <InputGroupInput
                          id="automation-task-max-run-duration"
                          type="number"
                          inputMode="numeric"
                          min={MIN_SCHEDULE_RUN_DURATION_MINUTES}
                          max={MAX_SCHEDULE_RUN_DURATION_MINUTES}
                          step={1}
                          value={maxRunDurationMinutes}
                          aria-invalid={validationRequested && !maxRunDurationValid}
                          aria-describedby={
                            validationRequested && !maxRunDurationValid
                              ? "automation-task-max-run-duration-hint automation-task-max-run-duration-error"
                              : "automation-task-max-run-duration-hint"
                          }
                          placeholder={t(
                            "extensions.workflows.automationTask.maxRunDurationPlaceholder",
                          )}
                          className="tabular-nums"
                          onChange={(event) => {
                            setNotice(undefined);
                            setMaxRunDurationMinutes(event.currentTarget.value);
                          }}
                        />
                        <InputGroupAddon
                          align="inline-end"
                          className="font-normal whitespace-nowrap"
                        >
                          {t("extensions.workflows.automationTask.minutes")}
                        </InputGroupAddon>
                      </InputGroup>
                      <span id="automation-task-max-run-duration-hint" className="sr-only">
                        {t("extensions.workflows.automationTask.maxRunDurationHint")}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      aria-label={t("extensions.workflows.automationTask.removeSchedule")}
                      onClick={() => {
                        setNotice(undefined);
                        setHasSchedule(false);
                      }}
                    >
                      <Trash2Icon aria-hidden="true" />
                    </Button>
                  </>
                ) : (
                  <Button
                    id="automation-task-add-schedule"
                    type="button"
                    variant="ghost"
                    className="text-muted-foreground w-fit"
                    onClick={() => {
                      setNotice(undefined);
                      setHasSchedule(true);
                    }}
                  >
                    <PlusIcon aria-hidden="true" />
                    {t("extensions.workflows.automationTask.addSchedule")}
                  </Button>
                )}
              </div>
              {validationRequested && !hasSchedule ? (
                <p className="text-destructive text-xs" role="alert">
                  {t("extensions.workflows.automationTask.scheduleRequired")}
                </p>
              ) : null}
              {validationRequested && hasSchedule && scheduleUsesTime && !timeValid ? (
                <p
                  id="automation-task-time-error"
                  className="text-destructive text-xs"
                  role="alert"
                >
                  {t("extensions.workflows.automationTask.timeRequired")}
                </p>
              ) : null}
              {validationRequested && hasSchedule && frequency === "custom" && !customCronValid ? (
                <p
                  id="automation-task-custom-cron-error"
                  className="text-destructive text-xs"
                  role="alert"
                >
                  {t("extensions.workflows.automationTask.customCronRequired")}
                </p>
              ) : null}
              {validationRequested && hasSchedule && !maxRunDurationValid ? (
                <p
                  id="automation-task-max-run-duration-error"
                  className="text-destructive text-xs"
                  role="alert"
                >
                  {t("extensions.workflows.automationTask.maxRunDurationInvalid", {
                    max: MAX_SCHEDULE_RUN_DURATION_MINUTES,
                  })}
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
                  aria-required="true"
                  aria-invalid={promptInvalid}
                  aria-describedby={promptInvalid ? "automation-task-prompt-error" : undefined}
                  placeholder={t("extensions.workflows.automationTask.instructionsPlaceholder")}
                  className="min-h-40 resize-y rounded-none border-0 bg-transparent px-4 py-3 shadow-none focus-visible:ring-0"
                  onChange={(event) => {
                    setNotice(undefined);
                    setPrompt(event.currentTarget.value);
                  }}
                />
                <InputGroupAddon
                  align="block-end"
                  className="border-border flex-wrap justify-between gap-2 border-t px-2.5 py-1.5"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-1">
                    <WorkspaceSelector
                      triggerId="automation-task-workspace-trigger"
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
                      onValueChange={(value) => {
                        setNotice(undefined);
                        setWorkspaceId(value);
                      }}
                    />
                  </div>

                  <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
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
                      selectedEffort={thinkingLevel}
                      selectedModelId={selectedModel?.id}
                      getEffortLabel={(effort) => effort.name}
                      onEffortChange={(effort) => {
                        if (isThinkingLevel(effort)) {
                          setNotice(undefined);
                          setThinkingLevel(effort);
                        }
                      }}
                      onModelChange={(value) => {
                        setNotice(undefined);
                        setSelectedModelKey(value);
                      }}
                    />
                  </div>
                </InputGroupAddon>
              </InputGroup>
              {promptInvalid ? (
                <p
                  id="automation-task-prompt-error"
                  className="text-destructive text-xs"
                  role="alert"
                >
                  {t("extensions.workflows.automationTask.instructionsRequired")}
                </p>
              ) : null}
            </div>

            {validationRequested && !workspaceId ? (
              <p className="text-destructive text-sm" role="alert">
                {t("extensions.workflows.automationTask.workspaceRequired")}
              </p>
            ) : null}
          </section>
        ) : (
          <section
            id="automation-task-history-panel"
            role="tabpanel"
            aria-labelledby="automation-task-history-tab"
            className="mt-8"
          >
            {taskRuns.length === 0 && taskRunsLoadState === "loading" ? (
              <div
                className="border-border text-muted-foreground flex min-h-48 items-center justify-center rounded-[var(--radius-lg)] border p-6 text-center text-sm"
                role="status"
              >
                {t("extensions.workflows.runs.loading")}
              </div>
            ) : taskRuns.length === 0 && taskRunsLoadState === "error" ? (
              <div className="border-border flex min-h-48 flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] border p-6 text-center">
                <p className="text-muted-foreground text-sm">
                  {t("extensions.workflows.automationTask.historyLoadFailed")}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void refreshTaskRuns()}
                >
                  <RefreshCwIcon aria-hidden="true" />
                  {t("extensions.workflows.sidebar.retry")}
                </Button>
              </div>
            ) : taskRuns.length === 0 ? (
              <div className="border-border text-muted-foreground flex min-h-48 items-center justify-center rounded-[var(--radius-lg)] border p-6 text-center text-sm">
                {t("extensions.workflows.automationTask.historyEmpty")}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-[var(--radius-lg)]">
                <table className="w-full min-w-[40rem] table-fixed text-sm">
                  <colgroup>
                    <col className="w-2/5" />
                    <col className="w-1/6" />
                    <col className="w-1/5" />
                    <col className="w-1/6" />
                    <col className="w-[var(--icon-frame-size-default)]" />
                  </colgroup>
                  <thead className="bg-muted/60 text-muted-foreground">
                    <tr className="border-border h-10 border-b">
                      <th scope="col" className="px-4 text-start font-normal">
                        {t("extensions.workflows.automationTask.historyColumns.triggeredAt")}
                      </th>
                      <th scope="col" className="px-4 text-start font-normal">
                        {t("extensions.workflows.automationTask.historyColumns.source")}
                      </th>
                      <th scope="col" className="px-4 text-start font-normal">
                        {t("extensions.workflows.automationTask.historyColumns.status")}
                      </th>
                      <th scope="col" className="px-4 text-start font-normal">
                        {t("extensions.workflows.automationTask.historyColumns.duration")}
                      </th>
                      <th scope="col">
                        <span className="sr-only">
                          {t("extensions.workflows.automationTask.historyColumns.actions")}
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {taskRuns.map((run) => {
                      const status = RUN_STATUS_KEYS[run.status];
                      const source = RUN_SOURCE_KEYS[run.source];
                      const triggeredAt = dateTimeFormatter.format(new Date(run.createdAt));
                      const sessionId = runSessionId(run);
                      const active = ACTIVE_RUN_STATUSES.includes(run.status);
                      const duration =
                        run.startedAt !== undefined && run.completedAt !== undefined
                          ? Math.max(0, run.completedAt - run.startedAt)
                          : undefined;
                      const failed =
                        run.status === "failed" ||
                        run.status === "cancelled" ||
                        run.status === "interrupted";

                      return (
                        <tr key={run.id} className="text-muted-foreground h-16">
                          <td className="px-4 tabular-nums">{triggeredAt}</td>
                          <td className="px-4">
                            {t(`extensions.workflows.automationTask.runSource.${source}`)}
                          </td>
                          <td className="px-4">
                            <span
                              className={cn(
                                "inline-flex items-center gap-2",
                                run.status === "succeeded"
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : failed
                                    ? "text-destructive"
                                    : run.status === "queued"
                                      ? "text-muted-foreground"
                                      : "text-primary",
                              )}
                            >
                              <span
                                aria-hidden="true"
                                className={cn(
                                  "size-2 shrink-0 rounded-full",
                                  run.status === "succeeded"
                                    ? "bg-emerald-500"
                                    : failed
                                      ? "bg-destructive"
                                      : run.status === "queued"
                                        ? "bg-muted-foreground"
                                        : "bg-primary",
                                )}
                              />
                              {t(`extensions.workflows.automationHome.runStatus.${status}`)}
                            </span>
                          </td>
                          <td className="px-4 tabular-nums">
                            {duration === undefined
                              ? "—"
                              : formatCompactDuration(duration, locale, { includeZero: true })}
                          </td>
                          <td className="pe-1 text-end">
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                render={
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="text-muted-foreground"
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
                                  className="min-h-9 gap-2 px-2.5"
                                  disabled={!sessionId}
                                  onClick={() => {
                                    if (sessionId) navigation.openThread(sessionId);
                                  }}
                                >
                                  <MessageSquareIcon aria-hidden="true" />
                                  {t("extensions.workflows.automationTask.goToConversation")}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  className="min-h-9 gap-2 px-2.5"
                                  disabled={active}
                                  title={
                                    active
                                      ? t(
                                          "extensions.workflows.automationTask.deleteActiveRunUnavailable",
                                        )
                                      : undefined
                                  }
                                  onClick={() => {
                                    setRunDeleteState("idle");
                                    setRunToDelete(run);
                                  }}
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

        <Dialog
          open={runToDelete !== undefined}
          onOpenChange={(open) => {
            if (runDeleteState === "deleting") return;
            if (!open) setRunToDelete(undefined);
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
            {runDeleteState === "error" ? (
              <p className="text-destructive text-xs leading-5" role="alert">
                {t("extensions.workflows.automationTask.deleteRunFailed")}
              </p>
            ) : null}
            <DialogFooter
              closeLabel={t("extensions.workflows.automationTask.cancelDeleteRun")}
              className="m-0"
            >
              <Button
                type="button"
                variant="outline"
                disabled={runDeleteState === "deleting"}
                onClick={() => setRunToDelete(undefined)}
              >
                {t("extensions.workflows.automationTask.cancelDeleteRun")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={!runToDelete || runDeleteState === "deleting"}
                onClick={() => void deleteRun()}
              >
                {runDeleteState === "deleting" ? (
                  <RefreshCwIcon aria-hidden="true" className="animate-spin" />
                ) : (
                  <Trash2Icon aria-hidden="true" />
                )}
                {t(
                  runDeleteState === "deleting"
                    ? "extensions.workflows.automationTask.deletingRun"
                    : "extensions.workflows.automationTask.confirmDeleteRun",
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {error ? (
          <p
            id="automation-task-submit-error"
            className="text-destructive mt-4 text-sm"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="text-muted-foreground mt-4 text-sm" role="status">
            {notice}
          </p>
        ) : null}
      </form>
    </section>
  );
}
