import type {
  RemoteAttentionStateV1,
  RemoteRunStateV1,
  RemoteSessionSummaryV1,
} from "@workbench/remote-control-contracts/protocol";

const RUN_STATES = new Set<RemoteRunStateV1>([
  "idle",
  "queued",
  "running",
  "waiting-for-input",
  "stopping",
  "completed",
  "stopped",
  "failed",
]);
const ATTENTION_STATES = new Set<RemoteAttentionStateV1>([
  "none",
  "unread",
  "input-needed",
  "failed",
]);
const ASCII_IDENTIFIER = /^[\x21-\x7e]{1,128}$/u;

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function boundedText(value: unknown, maximumBytes: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    new TextEncoder().encode(value).byteLength <= maximumBytes
  );
}

export interface SanitizedWorkspace {
  readonly workspaceId: string;
  readonly displayName: string;
}

export function sanitizeWorkspaceCatalog(
  values: readonly unknown[],
): ReadonlyMap<string, SanitizedWorkspace> {
  const workspaces = new Map<string, SanitizedWorkspace>();
  for (const value of values) {
    const source = record(value);
    if (
      !source ||
      typeof source.workspaceId !== "string" ||
      !ASCII_IDENTIFIER.test(source.workspaceId) ||
      !boundedText(source.displayName, 512)
    ) {
      continue;
    }
    workspaces.set(source.workspaceId, {
      workspaceId: source.workspaceId,
      displayName: source.displayName,
    });
  }
  return workspaces;
}

export function sanitizeSessionCatalogEntry(
  value: unknown,
  workspaces: ReadonlyMap<string, SanitizedWorkspace>,
): RemoteSessionSummaryV1 | undefined {
  const source = record(value);
  if (
    !source ||
    typeof source.sessionId !== "string" ||
    !ASCII_IDENTIFIER.test(source.sessionId) ||
    (source.title !== undefined && !boundedText(source.title, 512)) ||
    typeof source.updatedAt !== "string" ||
    !source.updatedAt.endsWith("Z") ||
    !Number.isFinite(Date.parse(source.updatedAt)) ||
    typeof source.pinned !== "boolean" ||
    typeof source.archived !== "boolean" ||
    typeof source.attention !== "string" ||
    !ATTENTION_STATES.has(source.attention as RemoteAttentionStateV1) ||
    typeof source.runState !== "string" ||
    !RUN_STATES.has(source.runState as RemoteRunStateV1) ||
    typeof source.entityRevision !== "string" ||
    !ASCII_IDENTIFIER.test(source.entityRevision)
  ) {
    return undefined;
  }
  const workspace =
    typeof source.workspaceId === "string" ? workspaces.get(source.workspaceId) : undefined;
  return {
    sessionId: source.sessionId,
    ...(workspace ? { workspace } : {}),
    ...(source.title === undefined ? {} : { title: source.title as string }),
    updatedAt: source.updatedAt,
    pinned: source.pinned,
    archived: source.archived,
    attention: source.attention as RemoteAttentionStateV1,
    runState: source.runState as RemoteRunStateV1,
    entityRevision: source.entityRevision,
  };
}
