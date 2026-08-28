import { CronExpressionParser } from "cron-parser";

import type {
  TriggerSpec,
  WorkflowDocument,
  WorkflowInternalEventName,
  WorkflowJsonValue,
  WorkflowRunAdmission,
  WorkflowTriggerState,
} from "@/runtime/shared/execution";
import { ExecutionError } from "./execution-errors";
import { ExecutionRepository } from "./execution-repository";

const MAX_TIMER_DELAY_MS = 2_147_000_000;

export interface ExecutionTriggerServiceOptions {
  repository: ExecutionRepository;
  readWorkflow(workflowId: string): Promise<WorkflowDocument>;
  startRun(input: {
    workflowId: string;
    triggerId: string;
    dedupeKey: string;
    source: "schedule" | "event";
    targetWorkspaceId?: string;
    input?: WorkflowJsonValue;
  }): Promise<WorkflowRunAdmission>;
  isWorkspaceTrusted(workspaceId: string): Promise<boolean>;
  now?: () => number;
  onStateChanged?: (state: WorkflowTriggerState) => void;
}

function timerKey(workflowId: string, triggerId: string): string {
  return `${workflowId}\u0000${triggerId}`;
}

export function nextScheduledAt(
  trigger: Extract<TriggerSpec, { type: "schedule" }>,
  currentDate: number,
): number {
  return CronExpressionParser.parse(trigger.cron, {
    currentDate,
    tz: trigger.timezone,
  })
    .next()
    .getTime();
}

export class ExecutionTriggerService {
  private readonly repository: ExecutionRepository;
  private readonly readWorkflow: ExecutionTriggerServiceOptions["readWorkflow"];
  private readonly startRun: ExecutionTriggerServiceOptions["startRun"];
  private readonly isWorkspaceTrusted: ExecutionTriggerServiceOptions["isWorkspaceTrusted"];
  private readonly now: () => number;
  private readonly onStateChanged: (state: WorkflowTriggerState) => void;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: ExecutionTriggerServiceOptions) {
    this.repository = options.repository;
    this.readWorkflow = options.readWorkflow;
    this.startRun = options.startRun;
    this.isWorkspaceTrusted = options.isWorkspaceTrusted;
    this.now = options.now ?? Date.now;
    this.onStateChanged = options.onStateChanged ?? (() => undefined);
  }

  async initialize(): Promise<void> {
    for (const state of await this.repository.listTriggerStates()) {
      if (!state.enabled) continue;
      try {
        const document = await this.readWorkflow(state.workflowId);
        const trigger = document.triggers.find(({ id }) => id === state.triggerId);
        if (!trigger || document.kind !== "automation" || !document.publishedRevisionId) {
          await this.persist({ ...state, enabled: false, disabledReason: "definition-changed" });
          continue;
        }
        if (trigger.type === "schedule") await this.schedule(document, trigger, state);
      } catch {
        await this.persist({ ...state, enabled: false, disabledReason: "definition-unavailable" });
      }
    }
    await this.handleInternalEvent(
      "workbench.application.started",
      `application-started:${this.now()}`,
      {},
    );
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private async persist(state: WorkflowTriggerState): Promise<WorkflowTriggerState> {
    const saved = await this.repository.saveTriggerState(state);
    this.onStateChanged(saved);
    return saved;
  }

  private workspaceId(document: WorkflowDocument, trigger: TriggerSpec): string | undefined {
    return document.scope.type === "project"
      ? document.scope.workspaceId
      : trigger.targetWorkspaceId;
  }

  private async assertCanEnable(document: WorkflowDocument, trigger: TriggerSpec): Promise<void> {
    if (document.kind !== "automation" || !document.publishedRevisionId) {
      throw new ExecutionError(
        "workflow-not-published",
        "Publish the automation before enabling a trigger.",
        { workflowId: document.id },
      );
    }
    if (trigger.type === "schedule") {
      try {
        CronExpressionParser.parse(trigger.cron, {
          currentDate: this.now(),
          tz: trigger.timezone,
        });
      } catch (error) {
        throw new ExecutionError(
          "trigger-invalid",
          "The schedule expression or timezone is invalid.",
          {
            workflowId: document.id,
            triggerId: trigger.id,
            reason: error instanceof Error ? error.message : "invalid-cron",
          },
        );
      }
    }
    const workspaceId = this.workspaceId(document, trigger);
    if (!workspaceId) {
      throw new ExecutionError(
        "workspace-required",
        "Personal automation triggers need a target workspace.",
        { workflowId: document.id },
      );
    }
    if (!(await this.isWorkspaceTrusted(workspaceId))) {
      throw new ExecutionError(
        "workspace-not-trusted",
        "The automation target workspace is not trusted.",
        { workspaceId },
      );
    }
  }

  async setEnabled(
    workflowId: string,
    triggerId: string,
    enabled: boolean,
  ): Promise<WorkflowTriggerState> {
    const document = await this.readWorkflow(workflowId);
    const trigger = document.triggers.find(({ id }) => id === triggerId);
    if (!trigger) {
      throw new ExecutionError("trigger-not-found", "The workflow trigger does not exist.", {
        workflowId,
        triggerId,
      });
    }
    const key = timerKey(workflowId, triggerId);
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
    const existing = (await this.repository.listTriggerStates(workflowId)).find(
      (state) => state.triggerId === triggerId,
    );
    if (!enabled) {
      return this.persist({
        workflowId,
        triggerId,
        enabled: false,
        ...(existing?.lastTriggeredAt === undefined
          ? {}
          : { lastTriggeredAt: existing.lastTriggeredAt }),
        ...(existing?.lastDedupeKey === undefined ? {} : { lastDedupeKey: existing.lastDedupeKey }),
      });
    }
    await this.assertCanEnable(document, trigger);
    const state = await this.persist({
      workflowId,
      triggerId,
      enabled: true,
      ...(existing?.lastTriggeredAt === undefined
        ? {}
        : { lastTriggeredAt: existing.lastTriggeredAt }),
      ...(existing?.lastDedupeKey === undefined ? {} : { lastDedupeKey: existing.lastDedupeKey }),
    });
    if (trigger.type === "schedule") return this.schedule(document, trigger, state);
    return state;
  }

  async remove(workflowId: string, triggerId: string): Promise<void> {
    const key = timerKey(workflowId, triggerId);
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
    await this.repository.removeTriggerState(workflowId, triggerId);
  }

  private nextSchedule(trigger: Extract<TriggerSpec, { type: "schedule" }>): number {
    return nextScheduledAt(trigger, this.now());
  }

  private async schedule(
    document: WorkflowDocument,
    trigger: Extract<TriggerSpec, { type: "schedule" }>,
    current: WorkflowTriggerState,
  ): Promise<WorkflowTriggerState> {
    const nextRunAt = this.nextSchedule(trigger);
    const state = await this.persist({ ...current, enabled: true, nextRunAt });
    const key = timerKey(document.id, trigger.id);
    const delay = Math.max(0, Math.min(nextRunAt - this.now(), MAX_TIMER_DELAY_MS));
    const previous = this.timers.get(key);
    if (previous) clearTimeout(previous);
    this.timers.set(
      key,
      setTimeout(() => {
        void this.fireSchedule(document.id, trigger.id, nextRunAt);
      }, delay),
    );
    return state;
  }

  private async fireSchedule(
    workflowId: string,
    triggerId: string,
    scheduledAt: number,
  ): Promise<void> {
    const document = await this.readWorkflow(workflowId);
    const trigger = document.triggers.find(
      (candidate): candidate is Extract<TriggerSpec, { type: "schedule" }> =>
        candidate.id === triggerId && candidate.type === "schedule",
    );
    const state = (await this.repository.listTriggerStates(workflowId)).find(
      (candidate) => candidate.triggerId === triggerId,
    );
    if (!trigger || !state?.enabled) return;
    if (scheduledAt > this.now() + 1_000) {
      await this.schedule(document, trigger, state);
      return;
    }
    const dedupeKey = `${trigger.id}:${scheduledAt}`;
    if (state.lastDedupeKey !== dedupeKey) {
      await this.startRun({
        workflowId,
        triggerId,
        dedupeKey,
        source: "schedule",
        targetWorkspaceId: this.workspaceId(document, trigger),
        input: { scheduledAt, triggerId },
      });
    }
    await this.schedule(document, trigger, {
      ...state,
      lastDedupeKey: dedupeKey,
      lastTriggeredAt: this.now(),
    });
  }

  async handleInternalEvent(
    event: WorkflowInternalEventName,
    sourceEventId: string,
    payload: WorkflowJsonValue,
  ): Promise<void> {
    const enabled = (await this.repository.listTriggerStates()).filter(({ enabled }) => enabled);
    for (const state of enabled) {
      const document = await this.readWorkflow(state.workflowId).catch(() => undefined);
      if (!document) continue;
      const trigger = document.triggers.find(
        (candidate): candidate is Extract<TriggerSpec, { type: "event" }> =>
          candidate.id === state.triggerId &&
          candidate.type === "event" &&
          candidate.event === event,
      );
      if (!trigger) continue;
      const dedupeKey = `${trigger.id}:${sourceEventId}`;
      if (state.lastDedupeKey === dedupeKey) continue;
      await this.startRun({
        workflowId: document.id,
        triggerId: trigger.id,
        dedupeKey,
        source: "event",
        targetWorkspaceId: this.workspaceId(document, trigger),
        input: { event, sourceEventId, payload },
      });
      await this.persist({
        ...state,
        lastDedupeKey: dedupeKey,
        lastTriggeredAt: this.now(),
      });
    }
  }
}
