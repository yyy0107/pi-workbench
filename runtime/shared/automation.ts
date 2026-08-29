import type { ModelSelection } from "./model-selection";

export const MIN_AUTOMATION_DURATION_SECONDS = 60;
export const MAX_AUTOMATION_DURATION_SECONDS = 31_536_000;
export const AUTOMATION_SESSION_ORIGIN_CUSTOM_TYPE = "workbench.automation.origin";

export interface AutomationSchedule {
  cron: string;
  timezone: string;
  maxDurationSeconds?: number;
}

export interface AutomationSessionOrigin {
  version: 1;
  origin: "automation";
  automationId: string;
  automationName: string;
  source: AutomationLaunchSource;
  triggeredAt: number;
}

export type AutomationLaunchSource = "manual" | "schedule";

export interface AutomationSessionReference {
  sessionId: string;
  source: AutomationLaunchSource;
  triggeredAt: number;
}

/** A scheduled Composer prompt submission. It is not a workflow, graph, or execution run. */
export interface AutomationDefinition {
  schemaVersion: 1;
  id: string;
  revision: number;
  name: string;
  prompt: string;
  workspaceId: string;
  model?: ModelSelection;
  schedule: AutomationSchedule;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
  nextRunAt?: number;
  lastTriggeredAt?: number;
  lastSessionId?: string;
  lastError?: string;
  sessions: AutomationSessionReference[];
}

export interface AutomationSummary {
  id: string;
  revision: number;
  name: string;
  prompt: string;
  workspaceId: string;
  model?: ModelSelection;
  schedule: AutomationSchedule;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
  nextRunAt?: number;
  lastTriggeredAt?: number;
  lastSessionId?: string;
  lastError?: string;
  sessionCount: number;
}

export interface AutomationListPayload {
  includeArchived?: boolean;
}

export interface AutomationListValue {
  items: AutomationSummary[];
}

export interface AutomationReadPayload {
  automationId: string;
}

export interface AutomationReadValue {
  automation: AutomationDefinition;
}

export interface AutomationSavePayload {
  automationId?: string;
  baseRevision?: number;
  name: string;
  prompt: string;
  workspaceId: string;
  model?: ModelSelection;
  schedule: AutomationSchedule;
  enabled: boolean;
}

export interface AutomationArchivePayload {
  automationId: string;
  archived: boolean;
}

export interface AutomationSetEnabledPayload {
  automationId: string;
  enabled: boolean;
}

export interface AutomationRunNowPayload {
  automationId: string;
}

export interface AutomationLaunchValue {
  automationId: string;
  sessionId: string;
  source: AutomationLaunchSource;
  triggeredAt: number;
}

export interface AutomationSessionsPayload {
  automationId: string;
  limit?: number;
}

export interface AutomationSessionsValue {
  items: AutomationSessionReference[];
}

export interface AutomationProtocol {
  list(payload: AutomationListPayload): Promise<AutomationListValue>;
  read(payload: AutomationReadPayload): Promise<AutomationReadValue>;
  save(payload: AutomationSavePayload): Promise<AutomationReadValue>;
  archive(payload: AutomationArchivePayload): Promise<AutomationReadValue>;
  setEnabled(payload: AutomationSetEnabledPayload): Promise<AutomationReadValue>;
  runNow(payload: AutomationRunNowPayload): Promise<AutomationLaunchValue>;
  sessions(payload: AutomationSessionsPayload): Promise<AutomationSessionsValue>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseAutomationSessionOrigin(value: unknown): AutomationSessionOrigin | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value.version !== 1 ||
    value.origin !== "automation" ||
    typeof value.automationId !== "string" ||
    !value.automationId ||
    typeof value.automationName !== "string" ||
    !value.automationName ||
    (value.source !== "manual" && value.source !== "schedule") ||
    typeof value.triggeredAt !== "number" ||
    !Number.isFinite(value.triggeredAt)
  ) {
    return undefined;
  }
  return value as unknown as AutomationSessionOrigin;
}
