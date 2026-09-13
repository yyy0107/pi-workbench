import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type {
  WorkspaceView,
  WorkspaceState,
  WorkspaceListResult,
  WorkspaceSessionArchiveValue,
} from "@workbench/agent-runtime-contracts/workspace-catalog";

export function cloneWorkspace(workspace: WorkspaceView): WorkspaceView {
  return { ...workspace, sessionIds: [...workspace.sessionIds] };
}

export function cloneState(state: WorkspaceState): WorkspaceState {
  return {
    schemaVersion: 1,
    legacyReconciled: state.legacyReconciled,
    workspaces: state.workspaces.map(cloneWorkspace),
    archivedSessionIds: [...state.archivedSessionIds],
    pinnedWorkspaceIds: [...state.pinnedWorkspaceIds],
    pinnedSessionIds: [...state.pinnedSessionIds],
    ignoredWorkspacePaths: [...state.ignoredWorkspacePaths],
  };
}

export function visibleWorkspace(
  workspace: WorkspaceView,
  archivedSessionIds: readonly string[],
): WorkspaceView {
  const archived = new Set(archivedSessionIds);
  return {
    ...workspace,
    sessionIds: workspace.sessionIds.filter((sessionId) => !archived.has(sessionId)),
  };
}

export function listResult(state: WorkspaceState): WorkspaceListResult {
  return {
    items: state.workspaces.map((workspace) =>
      visibleWorkspace(workspace, state.archivedSessionIds),
    ),
    archivedSessionIds: [...state.archivedSessionIds],
    pinnedWorkspaceIds: [...state.pinnedWorkspaceIds],
    pinnedSessionIds: [...state.pinnedSessionIds],
  };
}

export function archiveResult(sessionId: string, archived: boolean): WorkspaceSessionArchiveValue {
  return { sessionId, archived };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`Invalid workspace state field: ${field}`);
  }
  return value;
}

function isoString(value: unknown, field: string): string {
  const text = nonEmptyString(value, field);
  const time = new Date(text);
  if (Number.isNaN(time.getTime())) {
    throw new TypeError(`Invalid workspace state field: ${field}`);
  }
  return time.toISOString();
}

function stringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`Invalid workspace state field: ${field}`);
  const unique = new Set<string>();
  for (const item of value) unique.add(nonEmptyString(item, field));
  return [...unique];
}

export function parseState(value: unknown): WorkspaceState {
  if (!isRecord(value)) throw new TypeError("Invalid workspace state document");
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1) {
    throw new TypeError(`Unsupported workspace state schema: ${String(value.schemaVersion)}`);
  }

  const rawWorkspaces = value.workspaces ?? value.items ?? [];
  if (!Array.isArray(rawWorkspaces)) {
    throw new TypeError("Invalid workspace state field: workspaces");
  }

  const workspaceIds = new Set<string>();
  const workspacePaths = new Set<string>();
  const assignedSessionIds = new Set<string>();
  const workspaces = rawWorkspaces.map((raw, index): WorkspaceView => {
    if (!isRecord(raw)) throw new TypeError(`Invalid workspace state workspace: ${index}`);
    const workspaceId = nonEmptyString(raw.workspaceId, `workspaces[${index}].workspaceId`);
    const workspacePath = nonEmptyString(raw.path, `workspaces[${index}].path`);
    if (workspaceIds.has(workspaceId) || workspacePaths.has(workspacePath)) {
      throw new TypeError(`Duplicate workspace identity at index ${index}`);
    }
    workspaceIds.add(workspaceId);
    workspacePaths.add(workspacePath);

    const sessionIds = stringArray(raw.sessionIds, `workspaces[${index}].sessionIds`).filter(
      (sessionId) => {
        if (assignedSessionIds.has(sessionId)) return false;
        assignedSessionIds.add(sessionId);
        return true;
      },
    );
    return {
      workspaceId,
      path: workspacePath,
      title: nonEmptyString(raw.title, `workspaces[${index}].title`).trim(),
      sessionIds,
      createdAt: isoString(raw.createdAt, `workspaces[${index}].createdAt`),
      updatedAt: isoString(raw.updatedAt, `workspaces[${index}].updatedAt`),
    };
  });

  const activePaths = new Set(workspaces.map((workspace) => workspace.path));
  return {
    schemaVersion: 1,
    legacyReconciled: value.legacyReconciled === true,
    workspaces,
    archivedSessionIds: stringArray(value.archivedSessionIds, "archivedSessionIds"),
    pinnedWorkspaceIds: stringArray(value.pinnedWorkspaceIds, "pinnedWorkspaceIds").filter(
      (workspaceId) => workspaceIds.has(workspaceId),
    ),
    pinnedSessionIds: stringArray(value.pinnedSessionIds, "pinnedSessionIds"),
    ignoredWorkspacePaths: stringArray(value.ignoredWorkspacePaths, "ignoredWorkspacePaths").filter(
      (workspacePath) => !activePaths.has(workspacePath),
    ),
  };
}

function expandHome(workspacePath: string): string {
  if (workspacePath === "~") return homedir();
  if (workspacePath.startsWith("~/")) return path.join(homedir(), workspacePath.slice(2));
  return workspacePath;
}

export async function defaultCanonicalize(workspacePath: string): Promise<string> {
  const resolved = path.resolve(expandHome(workspacePath));
  const canonical = await realpath(resolved);
  if (!(await stat(canonical)).isDirectory()) throw new Error("Workspace path is not a directory");
  return canonical;
}

export function uniqueMigrationTitle(state: WorkspaceState, canonicalPath: string): string {
  const base = path.basename(canonicalPath) || canonicalPath;
  if (!state.workspaces.some((workspace) => workspace.title === base)) return base;
  let suffix = 2;
  while (state.workspaces.some((workspace) => workspace.title === `${base} (${suffix})`)) {
    suffix += 1;
  }
  return `${base} (${suffix})`;
}
