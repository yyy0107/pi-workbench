import { CronExpressionParser } from "cron-parser";

import type {
  AutomationArchivePayload,
  AutomationDefinition,
  AutomationLaunchSource,
  AutomationLaunchValue,
  AutomationListPayload,
  AutomationListValue,
  AutomationProtocol,
  AutomationReadPayload,
  AutomationReadValue,
  AutomationRemoveSessionPayload,
  AutomationRemoveSessionValue,
  AutomationRunNowPayload,
  AutomationSavePayload,
  AutomationSessionsPayload,
  AutomationSessionsValue,
  AutomationSetEnabledPayload,
  AutomationSummary,
} from "@workbench/automation-contracts";
import {
  MAX_AUTOMATION_DURATION_SECONDS,
  MIN_AUTOMATION_DURATION_SECONDS,
} from "@workbench/automation-contracts";
import { AutomationError } from "./errors";
import { AutomationRepository } from "./repository";

const MAX_TIMER_DELAY_MS = 2_147_000_000;

export interface AutomationWorkspace {
  workspaceId: string;
  path: string;
}

export interface AutomationServiceOptions {
  repository: AutomationRepository;
  resolveWorkspace(workspaceId: string): Promise<AutomationWorkspace | undefined>;
  isWorkspaceTrusted(workspacePath: string): boolean;
  launch(
    automation: AutomationDefinition,
    workspace: AutomationWorkspace,
    source: AutomationLaunchSource,
    triggeredAt: number,
  ): Promise<string>;
  cancel?(sessionId: string): Promise<void>;
  isSessionRunning?(sessionId: string): boolean | Promise<boolean>;
  now?: () => number;
  onChanged?: (automation: AutomationSummary) => void;
}

function summary(automation: AutomationDefinition): AutomationSummary {
  return {
    id: automation.id,
    revision: automation.revision,
    name: automation.name,
    prompt: automation.prompt,
    workspaceId: automation.workspaceId,
    ...(automation.model === undefined ? {} : { model: automation.model }),
    schedule: automation.schedule,
    enabled: automation.enabled,
    createdAt: automation.createdAt,
    updatedAt: automation.updatedAt,
    ...(automation.archivedAt === undefined ? {} : { archivedAt: automation.archivedAt }),
    ...(automation.nextRunAt === undefined ? {} : { nextRunAt: automation.nextRunAt }),
    ...(automation.lastTriggeredAt === undefined
      ? {}
      : { lastTriggeredAt: automation.lastTriggeredAt }),
    ...(automation.lastSessionId === undefined ? {} : { lastSessionId: automation.lastSessionId }),
    ...(automation.lastError === undefined ? {} : { lastError: automation.lastError }),
    sessionCount: automation.sessions.length,
  };
}

function validateSave(payload: AutomationSavePayload, now: number): number {
  if (!payload.name.trim()) {
    throw new AutomationError("automation-invalid", "Automation name cannot be empty.", {
      field: "name",
      reason: "required",
    });
  }
  if (!payload.prompt.trim()) {
    throw new AutomationError("automation-invalid", "Automation prompt cannot be empty.", {
      field: "prompt",
      reason: "required",
    });
  }
  if (!payload.workspaceId) {
    throw new AutomationError("automation-invalid", "Automation workspace is required.", {
      field: "workspaceId",
      reason: "required",
    });
  }
  const duration = payload.schedule.maxDurationSeconds;
  if (
    duration !== undefined &&
    (!Number.isInteger(duration) ||
      duration < MIN_AUTOMATION_DURATION_SECONDS ||
      duration > MAX_AUTOMATION_DURATION_SECONDS)
  ) {
    throw new AutomationError("automation-invalid", "Automation duration is invalid.", {
      field: "schedule.maxDurationSeconds",
      reason: "out-of-range",
    });
  }
  try {
    return CronExpressionParser.parse(payload.schedule.cron, {
      currentDate: now,
      tz: payload.schedule.timezone,
    })
      .next()
      .getTime();
  } catch (error) {
    throw new AutomationError(
      "automation-invalid",
      "Automation schedule is invalid.",
      { field: "schedule", reason: "invalid-cron-or-timezone" },
      { cause: error },
    );
  }
}

export class AutomationService implements AutomationProtocol {
  readonly repository: AutomationRepository;
  private resolveWorkspace: AutomationServiceOptions["resolveWorkspace"];
  private isWorkspaceTrusted: AutomationServiceOptions["isWorkspaceTrusted"];
  private launchSession: AutomationServiceOptions["launch"];
  private cancelSession: NonNullable<AutomationServiceOptions["cancel"]>;
  private isSessionRunning: NonNullable<AutomationServiceOptions["isSessionRunning"]>;
  private readonly now: () => number;
  private readonly onChanged: NonNullable<AutomationServiceOptions["onChanged"]>;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly sessionDeadlineTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private initialization: Promise<void> | undefined;
  // Optional for compatibility with a process-global instance retained across development HMR.
  private closed?: boolean = false;
  private generation?: number = 0;
  private activeLaunches?: Set<Promise<void>> = new Set();
  private shutdownOperation?: Promise<void>;

  constructor(options: AutomationServiceOptions) {
    this.repository = options.repository;
    this.resolveWorkspace = options.resolveWorkspace;
    this.isWorkspaceTrusted = options.isWorkspaceTrusted;
    this.launchSession = options.launch;
    this.cancelSession = options.cancel ?? (async () => undefined);
    this.isSessionRunning = options.isSessionRunning ?? (() => false);
    this.now = options.now ?? Date.now;
    this.onChanged = options.onChanged ?? (() => undefined);
  }

  rebindRuntime(
    options: Pick<
      AutomationServiceOptions,
      "cancel" | "isSessionRunning" | "isWorkspaceTrusted" | "launch" | "resolveWorkspace"
    >,
  ): void {
    this.resolveWorkspace = options.resolveWorkspace;
    this.isWorkspaceTrusted = options.isWorkspaceTrusted;
    this.launchSession = options.launch;
    this.cancelSession = options.cancel ?? (async () => undefined);
    this.isSessionRunning = options.isSessionRunning ?? (() => false);
  }

  private currentGeneration(): number {
    return (this.generation ??= 0);
  }

  private isCurrentGeneration(generation: number): boolean {
    return this.closed !== true && this.currentGeneration() === generation;
  }

  private assertCurrentGeneration(generation: number): void {
    if (!this.isCurrentGeneration(generation)) {
      throw new Error("Automation service is shutting down.");
    }
  }

  private activeLaunchSettlements(): Set<Promise<void>> {
    return (this.activeLaunches ??= new Set());
  }

  async initialize(): Promise<void> {
    const generation = this.currentGeneration();
    this.assertCurrentGeneration(generation);
    if (!this.initialization) {
      const initialization = (async () => {
        const automations = await this.repository.list();
        this.assertCurrentGeneration(generation);
        for (const automation of automations) await this.schedule(automation, generation);
      })();
      this.initialization = initialization;
      void initialization.catch(() => {
        if (this.initialization === initialization) this.initialization = undefined;
      });
    }
    await this.initialization;
    this.assertCurrentGeneration(generation);
  }

  dispose(): void {
    if (this.closed === true) return;
    this.closed = true;
    this.generation = this.currentGeneration() + 1;
    for (const timer of this.timers.values()) clearTimeout(timer);
    for (const timer of this.sessionDeadlineTimers.values()) clearTimeout(timer);
    this.timers.clear();
    this.sessionDeadlineTimers.clear();
    this.initialization = undefined;
  }

  /** Closes admission synchronously and waits for every launch already handed to Pi to settle. */
  shutdown(): Promise<void> {
    if (this.shutdownOperation) return this.shutdownOperation;
    let resolveShutdown!: () => void;
    const operation = new Promise<void>((resolve) => (resolveShutdown = resolve));
    this.shutdownOperation = operation;
    this.dispose();
    const activeLaunches = [...this.activeLaunchSettlements()];
    void Promise.allSettled(activeLaunches).then(() => resolveShutdown());
    return operation;
  }

  private async ready(): Promise<void> {
    await this.initialize();
  }

  private async workspace(automation: AutomationDefinition): Promise<AutomationWorkspace> {
    return this.workspaceById(automation.workspaceId, true);
  }

  private async workspaceById(
    workspaceId: string,
    requireTrusted: boolean,
  ): Promise<AutomationWorkspace> {
    const workspace = await this.resolveWorkspace(workspaceId);
    if (!workspace) {
      throw new AutomationError(
        "automation-workspace-not-found",
        "The automation workspace does not exist.",
        { workspaceId },
      );
    }
    if (requireTrusted && !this.isWorkspaceTrusted(workspace.path)) {
      throw new AutomationError(
        "automation-workspace-not-trusted",
        "Trust the project before running its automation.",
        { workspaceId },
      );
    }
    return workspace;
  }

  private nextRunAt(automation: AutomationDefinition): number {
    return CronExpressionParser.parse(automation.schedule.cron, {
      currentDate: this.now(),
      tz: automation.schedule.timezone,
    })
      .next()
      .getTime();
  }

  private async schedule(
    automation: AutomationDefinition,
    generation = this.currentGeneration(),
  ): Promise<void> {
    this.assertCurrentGeneration(generation);
    const current = this.timers.get(automation.id);
    if (current) clearTimeout(current);
    this.timers.delete(automation.id);
    if (!automation.enabled || automation.archivedAt !== undefined) {
      if (automation.nextRunAt !== undefined) {
        const updated = await this.repository.updateRuntime(automation.id, (value) => {
          const { nextRunAt: _nextRunAt, ...rest } = value;
          return rest;
        });
        this.assertCurrentGeneration(generation);
        this.onChanged(summary(updated));
      }
      return;
    }
    const nextRunAt = this.nextRunAt(automation);
    const updated = await this.repository.updateRuntime(automation.id, (value) => ({
      ...value,
      nextRunAt,
    }));
    this.assertCurrentGeneration(generation);
    this.onChanged(summary(updated));
    const arm = (): void => {
      if (!this.isCurrentGeneration(generation)) return;
      const remaining = nextRunAt - this.now();
      if (remaining > MAX_TIMER_DELAY_MS) {
        this.timers.set(automation.id, setTimeout(arm, MAX_TIMER_DELAY_MS));
        return;
      }
      this.timers.set(
        automation.id,
        setTimeout(
          () => {
            if (!this.isCurrentGeneration(generation)) return;
            this.timers.delete(automation.id);
            void this.launch(automation.id, "schedule", generation)
              .catch(() => undefined)
              .finally(async () => {
                if (!this.isCurrentGeneration(generation)) return;
                try {
                  const currentAutomation = await this.repository.read(automation.id);
                  await this.schedule(currentAutomation, generation);
                } catch {
                  // The task may have been archived while its scheduled launch was settling.
                }
              });
          },
          Math.max(0, remaining),
        ),
      );
    };
    arm();
  }

  async list(payload: AutomationListPayload): Promise<AutomationListValue> {
    await this.ready();
    return {
      items: (await this.repository.list())
        .filter((automation) => payload.includeArchived || automation.archivedAt === undefined)
        .map(summary),
    };
  }

  async read(payload: AutomationReadPayload): Promise<AutomationReadValue> {
    await this.ready();
    return { automation: await this.repository.read(payload.automationId) };
  }

  async save(payload: AutomationSavePayload): Promise<AutomationReadValue> {
    await this.ready();
    const time = this.now();
    const nextRunAt = validateSave(payload, time);
    await this.workspaceById(payload.workspaceId, payload.enabled);
    let saved: AutomationDefinition;
    if (!payload.automationId) {
      const id = this.repository.createId();
      saved = await this.repository.create({
        schemaVersion: 1,
        id,
        revision: 0,
        name: payload.name.trim(),
        prompt: payload.prompt.trim(),
        workspaceId: payload.workspaceId,
        ...(payload.model === undefined ? {} : { model: payload.model }),
        schedule: payload.schedule,
        enabled: payload.enabled,
        createdAt: time,
        updatedAt: time,
        ...(payload.enabled ? { nextRunAt } : {}),
        sessions: [],
      });
    } else {
      if (payload.baseRevision === undefined) {
        throw new AutomationError("automation-invalid", "Automation revision is required.", {
          field: "baseRevision",
          reason: "required",
        });
      }
      saved = await this.repository.replace(
        payload.automationId,
        payload.baseRevision,
        (current) => {
          const { model: _model, nextRunAt: _nextRunAt, ...rest } = current;
          return {
            ...rest,
            revision: current.revision + 1,
            name: payload.name.trim(),
            prompt: payload.prompt.trim(),
            workspaceId: payload.workspaceId,
            ...(payload.model === undefined ? {} : { model: payload.model }),
            schedule: payload.schedule,
            enabled: payload.enabled,
            updatedAt: time,
            ...(payload.enabled ? { nextRunAt } : {}),
          };
        },
      );
    }
    await this.schedule(saved);
    const automation = await this.repository.read(saved.id);
    this.onChanged(summary(automation));
    return { automation };
  }

  async archive(payload: AutomationArchivePayload): Promise<AutomationReadValue> {
    await this.ready();
    const current = await this.repository.read(payload.automationId);
    const saved = await this.repository.replace(payload.automationId, current.revision, (value) => {
      const { archivedAt: _archivedAt, ...rest } = value;
      return {
        ...rest,
        revision: value.revision + 1,
        enabled: payload.archived ? false : value.enabled,
        ...(payload.archived ? { archivedAt: this.now() } : {}),
        updatedAt: this.now(),
      };
    });
    await this.schedule(saved);
    this.onChanged(summary(saved));
    return { automation: await this.repository.read(saved.id) };
  }

  async setEnabled(payload: AutomationSetEnabledPayload): Promise<AutomationReadValue> {
    await this.ready();
    const current = await this.repository.read(payload.automationId);
    if (payload.enabled) await this.workspace(current);
    const saved = await this.repository.replace(
      payload.automationId,
      current.revision,
      (value) => ({
        ...value,
        revision: value.revision + 1,
        enabled: payload.enabled,
        updatedAt: this.now(),
      }),
    );
    await this.schedule(saved);
    this.onChanged(summary(saved));
    return { automation: await this.repository.read(saved.id) };
  }

  private async launch(
    automationId: string,
    source: AutomationLaunchSource,
    generation = this.currentGeneration(),
  ): Promise<AutomationLaunchValue> {
    this.assertCurrentGeneration(generation);
    const automation = await this.repository.read(automationId);
    this.assertCurrentGeneration(generation);
    const workspace = await this.workspace(automation);
    this.assertCurrentGeneration(generation);
    const triggeredAt = this.now();
    try {
      this.assertCurrentGeneration(generation);
      let settleLaunch!: () => void;
      const launchSettled = new Promise<void>((resolve) => (settleLaunch = resolve));
      this.activeLaunchSettlements().add(launchSettled);
      let sessionId: string;
      try {
        sessionId = await this.launchSession(automation, workspace, source, triggeredAt);
      } finally {
        this.activeLaunchSettlements().delete(launchSettled);
        settleLaunch();
      }
      this.assertCurrentGeneration(generation);
      const saved = await this.repository.recordSession(automationId, {
        sessionId,
        source,
        triggeredAt,
      });
      this.assertCurrentGeneration(generation);
      if (source === "schedule" && automation.schedule.maxDurationSeconds !== undefined) {
        const deadline = setTimeout(() => {
          this.sessionDeadlineTimers.delete(sessionId);
          void this.cancelSession(sessionId).catch(() => undefined);
        }, automation.schedule.maxDurationSeconds * 1_000);
        deadline.unref?.();
        this.sessionDeadlineTimers.set(sessionId, deadline);
      }
      this.onChanged(summary(saved));
      return { automationId, sessionId, source, triggeredAt };
    } catch (error) {
      if (!this.isCurrentGeneration(generation)) throw error;
      const reason = error instanceof Error ? error.message : "automation-launch-failed";
      const saved = await this.repository.recordError(automationId, reason);
      this.onChanged(summary(saved));
      if (error instanceof AutomationError) throw error;
      throw new AutomationError(
        "automation-launch-failed",
        "The automation could not create and send its session.",
        { automationId, reason },
        { cause: error },
      );
    }
  }

  async runNow(payload: AutomationRunNowPayload): Promise<AutomationLaunchValue> {
    await this.ready();
    return this.launch(payload.automationId, "manual");
  }

  async sessions(payload: AutomationSessionsPayload): Promise<AutomationSessionsValue> {
    await this.ready();
    const automation = await this.repository.read(payload.automationId);
    return { items: automation.sessions.slice(0, payload.limit ?? 100) };
  }

  async removeSession(
    payload: AutomationRemoveSessionPayload,
  ): Promise<AutomationRemoveSessionValue> {
    await this.ready();
    const automation = await this.repository.read(payload.automationId);
    if (!automation.sessions.some(({ sessionId }) => sessionId === payload.sessionId)) {
      return { ...payload, removed: false };
    }
    if (await this.isSessionRunning(payload.sessionId)) {
      throw new AutomationError(
        "automation-session-active",
        "An active automation session cannot be removed from its history.",
        payload,
      );
    }
    const result = await this.repository.removeSession(payload.automationId, payload.sessionId);
    if (result.removed) {
      const deadline = this.sessionDeadlineTimers.get(payload.sessionId);
      if (deadline) clearTimeout(deadline);
      this.sessionDeadlineTimers.delete(payload.sessionId);
      this.onChanged(summary(result.automation));
    }
    return { ...payload, removed: result.removed };
  }
}
