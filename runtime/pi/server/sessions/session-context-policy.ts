import type { SessionContextPolicy } from "@/runtime/pi/contracts/rpc";

export const SESSION_CONTEXT_POLICY_CUSTOM_TYPE = "workbench.session-context-policy.v1";

export interface SessionContextPolicyMarker {
  version: 1;
  policy: SessionContextPolicy | null;
}

interface SessionContextPolicyEntry {
  type?: string;
  customType?: string;
  data?: unknown;
  details?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

export function normalizeSessionContextPolicy(value: unknown): SessionContextPolicy | undefined {
  if (!isRecord(value)) return undefined;
  const mode = value.mode;
  if (mode !== "inherit" && mode !== "auto" && mode !== "maximum" && mode !== "custom") {
    return undefined;
  }
  const desiredContextTokens = positiveInteger(value.desiredContextTokens);
  if (mode === "custom" && desiredContextTokens === undefined) return undefined;
  const rawCompaction = isRecord(value.compaction) ? value.compaction : undefined;
  const enabled = typeof rawCompaction?.enabled === "boolean" ? rawCompaction.enabled : undefined;
  const reserveTokens = positiveInteger(rawCompaction?.reserveTokens);
  const keepRecentTokens = positiveInteger(rawCompaction?.keepRecentTokens);
  const compaction = rawCompaction
    ? {
        ...(enabled === undefined ? {} : { enabled }),
        ...(reserveTokens === undefined ? {} : { reserveTokens }),
        ...(keepRecentTokens === undefined ? {} : { keepRecentTokens }),
      }
    : undefined;
  return {
    mode,
    ...(mode === "custom" ? { desiredContextTokens } : {}),
    ...(compaction && Object.keys(compaction).length > 0 ? { compaction } : {}),
  } as SessionContextPolicy;
}

export function sessionContextPolicyMarker(
  policy: SessionContextPolicy,
): SessionContextPolicyMarker {
  const normalized = normalizeSessionContextPolicy(policy);
  if (!normalized) throw new TypeError("Invalid session context policy.");
  return {
    version: 1,
    policy: normalized.mode === "inherit" ? null : normalized,
  };
}

export function latestSessionContextPolicyMarker(
  entries: readonly SessionContextPolicyEntry[],
): SessionContextPolicyMarker | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || entry.customType !== SESSION_CONTEXT_POLICY_CUSTOM_TYPE) continue;
    const raw = entry.type === "custom_message" ? entry.details : entry.data;
    if (!isRecord(raw) || raw.version !== 1) continue;
    if (raw.policy === null) return { version: 1, policy: null };
    const policy = normalizeSessionContextPolicy(raw.policy);
    if (policy?.mode && policy.mode !== "inherit") {
      return { version: 1, policy };
    }
  }
  return undefined;
}

export function policyFromSessionEntries(
  entries: readonly SessionContextPolicyEntry[],
): SessionContextPolicy {
  return latestSessionContextPolicyMarker(entries)?.policy ?? { mode: "inherit" };
}

export function effectiveSessionContextBudget(
  policy: SessionContextPolicy,
  modelCapacity: number,
): number {
  if (policy.mode !== "custom" || policy.desiredContextTokens === undefined) return modelCapacity;
  return Math.min(modelCapacity, policy.desiredContextTokens);
}
