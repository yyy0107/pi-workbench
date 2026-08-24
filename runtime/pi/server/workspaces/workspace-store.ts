import { randomUUID } from "node:crypto";
import { readFile, realpath, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type {
  WorkspacePinValue,
  WorkspaceSessionArchiveValue,
  WorkspaceSessionPinValue,
  WorkspaceView,
} from "../../rpc-contracts";
import { atomicReplaceFile, withCrossProcessFileLock } from "../core/file-persistence";
import {
  nextWorkbenchSettingsDocument,
  readWorkbenchSettingsDocument,
  writeWorkbenchSettingsDocument,
} from "../settings/workbench-settings-file";
import { getStreamHub } from "../streams/stream-hub";

export type { WorkspaceView } from "../../rpc-contracts";

export interface WorkspaceState {
  schemaVersion: 1;
  legacyReconciled: boolean;
  projectTrustMigrationCompleted: boolean;
  workspaces: WorkspaceView[];
  archivedSessionIds: string[];
  pinnedWorkspaceIds: string[];
  pinnedSessionIds: string[];
  ignoredWorkspacePaths: string[];
}

export type WorkspaceStoreEvent =
  | { type: "host/workspace-changed"; workspace: WorkspaceView }
  | { type: "host/workspace-removed"; workspaceId: string }
  | { type: "host/workspace-order-changed"; workspaceIds: string[] }
  | { type: "host/workspace-pinned-changed"; workspaceId: string; pinned: boolean }
  | {
      type: "host/session-archive-changed";
      sessionId: string;
      archived: boolean;
      workspace?: WorkspaceView;
    }
  | { type: "host/session-pinned-changed"; sessionId: string; pinned: boolean };

export interface WorkspaceStoreErrorDetails {
  "workspace-invalid-path": { path: string };
  "workspace-name-conflict": { name: string };
  "workspace-not-found": { workspaceId: string };
  "workspace-move-invalid": {
    workspaceId: string;
    sessionId: string;
    beforeSessionId?: string;
  };
}

export type WorkspaceStoreErrorCode = keyof WorkspaceStoreErrorDetails;

export class WorkspaceStoreError<
  Code extends WorkspaceStoreErrorCode = WorkspaceStoreErrorCode,
> extends Error {
  readonly code: Code;
  readonly details: WorkspaceStoreErrorDetails[Code];

  constructor(code: Code, message: string, details: WorkspaceStoreErrorDetails[Code]) {
    super(message);
    this.name = "WorkspaceStoreError";
    this.code = code;
    this.details = details;
  }
}

export interface WorkspaceStoreOptions {
  stateFile: string;
  /** Embed the state under this key in workbench-settings.json. Omit for legacy standalone files. */
  documentSection?: "workspaces";
  /** Standalone state imported and removed after the embedded document is committed. */
  legacyStateFile?: string;
  now?: () => Date | string | number;
  canonicalize?: (workspacePath: string) => string | Promise<string>;
}

export interface WorkspaceSessionSnapshot {
  id: string;
  cwd: string;
}

export interface WorkspaceReconcileOptions {
  importUnknownWorkspaces?: boolean;
}

export interface WorkspaceListResult {
  items: WorkspaceView[];
  archivedSessionIds: string[];
  pinnedWorkspaceIds: string[];
  pinnedSessionIds: string[];
}

export interface WorkspaceCreateResult {
  workspace: WorkspaceView;
  created: boolean;
}

export interface WorkspaceCreateInput {
  path: string;
}

export interface WorkspaceRenameInput {
  workspaceId: string;
  title: string;
}

export interface WorkspaceDeleteInput {
  workspaceId: string;
}

export interface WorkspaceSetPinnedInput {
  workspaceId: string;
  pinned: boolean;
}

export interface WorkspaceSetSessionPinnedInput {
  sessionId: string;
  pinned: boolean;
}

export interface WorkspaceInsertBeforeInput {
  workspaceId: string;
  beforeWorkspaceId?: string;
}

export interface WorkspaceInsertSessionBeforeInput {
  workspaceId: string;
  sessionId: string;
  beforeSessionId?: string;
}

export interface WorkspaceArchiveSessionInput {
  sessionId: string;
}

type WorkspaceStoreListener = (event: WorkspaceStoreEvent) => void;

const EMPTY_STATE = (): WorkspaceState => ({
  schemaVersion: 1,
  legacyReconciled: false,
  projectTrustMigrationCompleted: false,
  workspaces: [],
  archivedSessionIds: [],
  pinnedWorkspaceIds: [],
  pinnedSessionIds: [],
  ignoredWorkspacePaths: [],
});
const LOCK_HEARTBEAT_MS = 5 * 1000;
const LOCK_STALE_AFTER_MS = 30 * 1000;
const LOCK_WAIT_TIMEOUT_MS = 35 * 1000;

function cloneWorkspace(workspace: WorkspaceView): WorkspaceView {
  return { ...workspace, sessionIds: [...workspace.sessionIds] };
}

function cloneState(state: WorkspaceState): WorkspaceState {
  return {
    schemaVersion: 1,
    legacyReconciled: state.legacyReconciled,
    projectTrustMigrationCompleted: state.projectTrustMigrationCompleted,
    workspaces: state.workspaces.map(cloneWorkspace),
    archivedSessionIds: [...state.archivedSessionIds],
    pinnedWorkspaceIds: [...state.pinnedWorkspaceIds],
    pinnedSessionIds: [...state.pinnedSessionIds],
    ignoredWorkspacePaths: [...state.ignoredWorkspacePaths],
  };
}

function visibleWorkspace(
  workspace: WorkspaceView,
  archivedSessionIds: readonly string[],
): WorkspaceView {
  const archived = new Set(archivedSessionIds);
  return {
    ...workspace,
    sessionIds: workspace.sessionIds.filter((sessionId) => !archived.has(sessionId)),
  };
}

function listResult(state: WorkspaceState): WorkspaceListResult {
  return {
    items: state.workspaces.map((workspace) =>
      visibleWorkspace(workspace, state.archivedSessionIds),
    ),
    archivedSessionIds: [...state.archivedSessionIds],
    pinnedWorkspaceIds: [...state.pinnedWorkspaceIds],
    pinnedSessionIds: [...state.pinnedSessionIds],
  };
}

function archiveResult(sessionId: string, archived: boolean): WorkspaceSessionArchiveValue {
  return { sessionId, archived };
}

function isRecord(value: unknown): value is Record<string, unknown> {
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

function parseState(value: unknown): WorkspaceState {
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
    projectTrustMigrationCompleted: value.projectTrustMigrationCompleted === true,
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

async function defaultCanonicalize(workspacePath: string): Promise<string> {
  const resolved = path.resolve(expandHome(workspacePath));
  const canonical = await realpath(resolved);
  if (!(await stat(canonical)).isDirectory()) throw new Error("Workspace path is not a directory");
  return canonical;
}

function uniqueMigrationTitle(state: WorkspaceState, canonicalPath: string): string {
  const base = path.basename(canonicalPath) || canonicalPath;
  if (!state.workspaces.some((workspace) => workspace.title === base)) return base;
  let suffix = 2;
  while (state.workspaces.some((workspace) => workspace.title === `${base} (${suffix})`)) {
    suffix += 1;
  }
  return `${base} (${suffix})`;
}

function moveInvalid(
  workspaceId: string,
  sessionId: string,
  beforeSessionId?: string,
): WorkspaceStoreError<"workspace-move-invalid"> {
  return new WorkspaceStoreError("workspace-move-invalid", "The session move is invalid.", {
    workspaceId,
    sessionId,
    ...(beforeSessionId === undefined ? {} : { beforeSessionId }),
  });
}

export class WorkspaceStore {
  private readonly stateFile: string;
  private readonly documentSection?: "workspaces";
  private readonly legacyStateFile?: string;
  private readonly now: () => Date | string | number;
  private readonly canonicalizePath: (workspacePath: string) => string | Promise<string>;
  private readonly listeners = new Set<WorkspaceStoreListener>();
  private state = EMPTY_STATE();
  private tail: Promise<void> = Promise.resolve();

  constructor(options: WorkspaceStoreOptions | string) {
    const resolvedOptions = typeof options === "string" ? { stateFile: options } : options;
    if (!resolvedOptions.stateFile.trim()) throw new TypeError("stateFile must not be empty");
    this.stateFile = path.resolve(resolvedOptions.stateFile);
    this.documentSection = resolvedOptions.documentSection;
    this.legacyStateFile = resolvedOptions.legacyStateFile
      ? path.resolve(resolvedOptions.legacyStateFile)
      : undefined;
    this.now = resolvedOptions.now ?? (() => new Date());
    this.canonicalizePath = resolvedOptions.canonicalize ?? defaultCanonicalize;
  }

  subscribe(listener: WorkspaceStoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(): Promise<WorkspaceListResult> {
    return this.exclusive(async () => listResult(this.state));
  }

  getState(): Promise<WorkspaceState> {
    return this.exclusive(async () => cloneState(this.state));
  }

  migrateExistingProjectTrust(
    migrate: (workspacePaths: readonly string[]) => void | Promise<void>,
  ): Promise<WorkspaceListResult> {
    return this.exclusive(async () => {
      if (this.state.projectTrustMigrationCompleted) return listResult(this.state);

      await migrate(this.state.workspaces.map((workspace) => workspace.path));
      const next = cloneState(this.state);
      next.projectTrustMigrationCompleted = true;
      await this.commit(next, []);
      return listResult(next);
    });
  }

  create(workspacePath: string): Promise<WorkspaceCreateResult>;
  create(input: WorkspaceCreateInput): Promise<WorkspaceCreateResult>;
  create(input: string | WorkspaceCreateInput): Promise<WorkspaceCreateResult> {
    const requestedPath = typeof input === "string" ? input : input.path;
    return this.exclusive(async () => {
      const canonicalPath = await this.canonicalPath(requestedPath);
      const existing = this.state.workspaces.find((workspace) => workspace.path === canonicalPath);
      if (existing) {
        if (this.state.ignoredWorkspacePaths.includes(canonicalPath)) {
          const next = cloneState(this.state);
          next.ignoredWorkspacePaths = next.ignoredWorkspacePaths.filter(
            (workspacePath) => workspacePath !== canonicalPath,
          );
          await this.commit(next, []);
        }
        return {
          workspace: visibleWorkspace(existing, this.state.archivedSessionIds),
          created: false,
        };
      }

      const title = path.basename(canonicalPath) || canonicalPath;
      const next = cloneState(this.state);
      next.ignoredWorkspacePaths = next.ignoredWorkspacePaths.filter(
        (workspacePath) => workspacePath !== canonicalPath,
      );
      const timestamp = this.timestamp();
      const workspace: WorkspaceView = {
        workspaceId: randomUUID(),
        path: canonicalPath,
        title,
        sessionIds: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      next.workspaces.unshift(workspace);
      await this.commit(next, [
        { type: "host/workspace-changed", workspace },
        {
          type: "host/workspace-order-changed",
          workspaceIds: next.workspaces.map((item) => item.workspaceId),
        },
      ]);
      return {
        workspace: visibleWorkspace(workspace, next.archivedSessionIds),
        created: true,
      };
    });
  }

  rename(workspaceId: string, title: string): Promise<{ workspace: WorkspaceView }>;
  rename(input: WorkspaceRenameInput): Promise<{ workspace: WorkspaceView }>;
  rename(
    input: string | WorkspaceRenameInput,
    positionalTitle?: string,
  ): Promise<{ workspace: WorkspaceView }> {
    const workspaceId = typeof input === "string" ? input : input.workspaceId;
    const requestedTitle = typeof input === "string" ? positionalTitle : input.title;
    return this.exclusive(async () => {
      const index = this.workspaceIndex(workspaceId);
      const title = (requestedTitle ?? "").trim();
      if (!title) {
        throw new WorkspaceStoreError(
          "workspace-name-conflict",
          "Workspace title must not be empty.",
          { name: title },
        );
      }
      if (
        this.state.workspaces.some(
          (workspace, candidate) => candidate !== index && workspace.title === title,
        )
      ) {
        throw new WorkspaceStoreError(
          "workspace-name-conflict",
          `A workspace named "${title}" already exists.`,
          { name: title },
        );
      }
      const current = this.state.workspaces[index];
      if (current.title === title) {
        return { workspace: visibleWorkspace(current, this.state.archivedSessionIds) };
      }

      const next = cloneState(this.state);
      const workspace = { ...next.workspaces[index], title, updatedAt: this.timestamp() };
      next.workspaces[index] = workspace;
      await this.commit(next, [{ type: "host/workspace-changed", workspace }]);
      return { workspace: visibleWorkspace(workspace, next.archivedSessionIds) };
    });
  }

  setPinned(workspaceId: string, pinned: boolean): Promise<WorkspacePinValue>;
  setPinned(input: WorkspaceSetPinnedInput): Promise<WorkspacePinValue>;
  setPinned(
    input: string | WorkspaceSetPinnedInput,
    positionalPinned?: boolean,
  ): Promise<WorkspacePinValue> {
    const workspaceId = typeof input === "string" ? input : input.workspaceId;
    const pinned = typeof input === "string" ? positionalPinned === true : input.pinned;
    return this.exclusive(async () => {
      this.workspaceIndex(workspaceId);
      const isPinned = this.state.pinnedWorkspaceIds.includes(workspaceId);
      const event: WorkspaceStoreEvent = {
        type: "host/workspace-pinned-changed",
        workspaceId,
        pinned,
      };
      if (isPinned === pinned) {
        this.emit(event);
        return { workspaceId, pinned };
      }

      const next = cloneState(this.state);
      next.pinnedWorkspaceIds = pinned
        ? [...next.pinnedWorkspaceIds, workspaceId]
        : next.pinnedWorkspaceIds.filter((id) => id !== workspaceId);
      await this.commit(next, [event]);
      return { workspaceId, pinned };
    });
  }

  delete(workspaceId: string): Promise<{ deleted: true }>;
  delete(input: WorkspaceDeleteInput): Promise<{ deleted: true }>;
  delete(input: string | WorkspaceDeleteInput): Promise<{ deleted: true }> {
    const workspaceId = typeof input === "string" ? input : input.workspaceId;
    return this.exclusive(async () => {
      const index = this.workspaceIndex(workspaceId);
      const next = cloneState(this.state);
      const [workspace] = next.workspaces.splice(index, 1);
      next.pinnedWorkspaceIds = next.pinnedWorkspaceIds.filter((id) => id !== workspaceId);
      if (!next.ignoredWorkspacePaths.includes(workspace.path)) {
        next.ignoredWorkspacePaths.push(workspace.path);
      }
      await this.commit(next, [
        { type: "host/workspace-removed", workspaceId },
        {
          type: "host/workspace-order-changed",
          workspaceIds: next.workspaces.map((item) => item.workspaceId),
        },
      ]);
      return { deleted: true };
    });
  }

  insertBefore(
    workspaceId: string,
    beforeWorkspaceId?: string,
  ): Promise<{ workspaceIds: string[] }>;
  insertBefore(input: WorkspaceInsertBeforeInput): Promise<{ workspaceIds: string[] }>;
  insertBefore(
    input: string | WorkspaceInsertBeforeInput,
    positionalBeforeWorkspaceId?: string,
  ): Promise<{ workspaceIds: string[] }> {
    const workspaceId = typeof input === "string" ? input : input.workspaceId;
    const beforeWorkspaceId =
      typeof input === "string" ? positionalBeforeWorkspaceId : input.beforeWorkspaceId;
    return this.exclusive(async () => {
      const sourceIndex = this.workspaceIndex(workspaceId);
      if (beforeWorkspaceId === workspaceId) {
        return { workspaceIds: this.state.workspaces.map((workspace) => workspace.workspaceId) };
      }
      if (beforeWorkspaceId !== undefined) this.workspaceIndex(beforeWorkspaceId);

      const next = cloneState(this.state);
      const [workspace] = next.workspaces.splice(sourceIndex, 1);
      const destinationIndex =
        beforeWorkspaceId === undefined
          ? next.workspaces.length
          : next.workspaces.findIndex((item) => item.workspaceId === beforeWorkspaceId);
      next.workspaces.splice(destinationIndex, 0, workspace);
      const currentIds = this.state.workspaces.map((item) => item.workspaceId);
      const workspaceIds = next.workspaces.map((item) => item.workspaceId);
      if (currentIds.every((id, index) => id === workspaceIds[index])) return { workspaceIds };

      await this.commit(next, [{ type: "host/workspace-order-changed", workspaceIds }]);
      return { workspaceIds: [...workspaceIds] };
    });
  }

  insertSessionBefore(
    workspaceId: string,
    sessionId: string,
    beforeSessionId?: string,
  ): Promise<{ workspace: WorkspaceView }>;
  insertSessionBefore(
    input: WorkspaceInsertSessionBeforeInput,
  ): Promise<{ workspace: WorkspaceView }>;
  insertSessionBefore(
    input: string | WorkspaceInsertSessionBeforeInput,
    positionalSessionId?: string,
    positionalBeforeSessionId?: string,
  ): Promise<{ workspace: WorkspaceView }> {
    const workspaceId = typeof input === "string" ? input : input.workspaceId;
    const sessionId = typeof input === "string" ? (positionalSessionId ?? "") : input.sessionId;
    const beforeSessionId =
      typeof input === "string" ? positionalBeforeSessionId : input.beforeSessionId;
    return this.exclusive(async () => {
      const destinationIndex = this.workspaceIndex(workspaceId);
      const current = this.state.workspaces[destinationIndex];
      if (!current.sessionIds.includes(sessionId)) {
        throw moveInvalid(workspaceId, sessionId, beforeSessionId);
      }
      if (beforeSessionId !== undefined && !current.sessionIds.includes(beforeSessionId)) {
        throw moveInvalid(workspaceId, sessionId, beforeSessionId);
      }
      if (beforeSessionId === sessionId) {
        return { workspace: visibleWorkspace(current, this.state.archivedSessionIds) };
      }

      const next = cloneState(this.state);
      const destination = next.workspaces[destinationIndex];
      destination.sessionIds = destination.sessionIds.filter((id) => id !== sessionId);
      const insertionIndex =
        beforeSessionId === undefined
          ? destination.sessionIds.length
          : destination.sessionIds.indexOf(beforeSessionId);
      destination.sessionIds.splice(insertionIndex, 0, sessionId);

      if (current.sessionIds.every((id, index) => id === destination.sessionIds[index])) {
        return { workspace: visibleWorkspace(current, this.state.archivedSessionIds) };
      }

      const timestamp = this.timestamp();
      destination.updatedAt = timestamp;
      await this.commit(next, [{ type: "host/workspace-changed", workspace: destination }]);
      return {
        workspace: visibleWorkspace(next.workspaces[destinationIndex], next.archivedSessionIds),
      };
    });
  }

  archiveSession(sessionId: string): Promise<WorkspaceSessionArchiveValue>;
  archiveSession(input: WorkspaceArchiveSessionInput): Promise<WorkspaceSessionArchiveValue>;
  archiveSession(
    input: string | WorkspaceArchiveSessionInput,
  ): Promise<WorkspaceSessionArchiveValue> {
    const sessionId = typeof input === "string" ? input : input.sessionId;
    return this.setSessionArchived(sessionId, true);
  }

  setSessionPinned(sessionId: string, pinned: boolean): Promise<WorkspaceSessionPinValue>;
  setSessionPinned(input: WorkspaceSetSessionPinnedInput): Promise<WorkspaceSessionPinValue>;
  setSessionPinned(
    input: string | WorkspaceSetSessionPinnedInput,
    positionalPinned?: boolean,
  ): Promise<WorkspaceSessionPinValue> {
    const sessionId = typeof input === "string" ? input : input.sessionId;
    const pinned = typeof input === "string" ? positionalPinned === true : input.pinned;
    return this.exclusive(async () => {
      if (!sessionId.trim()) throw new TypeError("sessionId must not be empty");
      const isPinned = this.state.pinnedSessionIds.includes(sessionId);
      const event: WorkspaceStoreEvent = {
        type: "host/session-pinned-changed",
        sessionId,
        pinned,
      };
      if (isPinned === pinned) {
        this.emit(event);
        return { sessionId, pinned };
      }

      const next = cloneState(this.state);
      next.pinnedSessionIds = pinned
        ? [...next.pinnedSessionIds, sessionId]
        : next.pinnedSessionIds.filter((id) => id !== sessionId);
      await this.commit(next, [event]);
      return { sessionId, pinned };
    });
  }

  attachSession(workspaceId: string, sessionId: string): Promise<{ workspace: WorkspaceView }> {
    return this.exclusive(async () => {
      if (!sessionId.trim()) throw new TypeError("sessionId must not be empty");
      const destinationIndex = this.workspaceIndex(workspaceId);
      const currentIndex = this.state.workspaces.findIndex((workspace) =>
        workspace.sessionIds.includes(sessionId),
      );
      if (currentIndex === destinationIndex) {
        return {
          workspace: visibleWorkspace(
            this.state.workspaces[destinationIndex],
            this.state.archivedSessionIds,
          ),
        };
      }

      const next = cloneState(this.state);
      const changedIndices = new Set<number>([destinationIndex]);
      if (currentIndex >= 0) {
        next.workspaces[currentIndex].sessionIds = next.workspaces[currentIndex].sessionIds.filter(
          (id) => id !== sessionId,
        );
        changedIndices.add(currentIndex);
      }
      next.workspaces[destinationIndex].sessionIds.unshift(sessionId);
      const timestamp = this.timestamp();
      for (const index of changedIndices) next.workspaces[index].updatedAt = timestamp;
      const events: WorkspaceStoreEvent[] = next.workspaces
        .filter((_, index) => changedIndices.has(index))
        .map((workspace) => ({ type: "host/workspace-changed", workspace }));
      await this.commit(next, events);
      return {
        workspace: visibleWorkspace(next.workspaces[destinationIndex], next.archivedSessionIds),
      };
    });
  }

  setSessionArchived(sessionId: string, archived: boolean): Promise<WorkspaceSessionArchiveValue> {
    return this.exclusive(async () => {
      if (!sessionId.trim()) throw new TypeError("sessionId must not be empty");
      const isArchived = this.state.archivedSessionIds.includes(sessionId);
      if (isArchived === archived) {
        const workspace = this.state.workspaces.find((candidate) =>
          candidate.sessionIds.includes(sessionId),
        );
        this.emit({
          type: "host/session-archive-changed",
          sessionId,
          archived,
          ...(workspace ? { workspace } : {}),
        });
        return archiveResult(sessionId, archived);
      }
      const next = cloneState(this.state);
      next.archivedSessionIds = archived
        ? [...next.archivedSessionIds, sessionId]
        : next.archivedSessionIds.filter((id) => id !== sessionId);
      const workspace = next.workspaces.find((candidate) =>
        candidate.sessionIds.includes(sessionId),
      );
      await this.commit(next, [
        {
          type: "host/session-archive-changed",
          sessionId,
          archived,
          ...(workspace ? { workspace } : {}),
        },
      ]);
      return archiveResult(sessionId, archived);
    });
  }

  unarchiveSession(session: WorkspaceSessionSnapshot): Promise<WorkspaceSessionArchiveValue> {
    return this.exclusive(async () => {
      const sessionId = session.id.trim();
      if (!sessionId) throw new TypeError("session.id must not be empty");

      const next = cloneState(this.state);
      let workspace = next.workspaces.find((candidate) => candidate.sessionIds.includes(sessionId));
      let workspaceChanged = false;

      if (!workspace) {
        const canonicalPath = await this.tryCanonicalPath(session.cwd);
        if (canonicalPath) {
          workspace = next.workspaces.find((candidate) => candidate.path === canonicalPath);
          const timestamp = this.timestamp();
          if (!workspace) {
            workspace = {
              workspaceId: randomUUID(),
              path: canonicalPath,
              title: uniqueMigrationTitle(next, canonicalPath),
              sessionIds: [],
              createdAt: timestamp,
              updatedAt: timestamp,
            };
            next.workspaces.push(workspace);
          }
          workspace.sessionIds.unshift(sessionId);
          workspace.updatedAt = timestamp;
          next.ignoredWorkspacePaths = next.ignoredWorkspacePaths.filter(
            (ignoredPath) => ignoredPath !== canonicalPath,
          );
          workspaceChanged = true;
        }
      }

      const wasArchived = next.archivedSessionIds.includes(sessionId);
      if (wasArchived) {
        next.archivedSessionIds = next.archivedSessionIds.filter((id) => id !== sessionId);
      }

      const event: WorkspaceStoreEvent = {
        type: "host/session-archive-changed",
        sessionId,
        archived: false,
        ...(workspace ? { workspace } : {}),
      };
      if (!wasArchived && !workspaceChanged) this.emit(event);
      else await this.commit(next, [event]);
      return archiveResult(sessionId, false);
    });
  }

  removeSession(sessionId: string): Promise<{ removed: boolean }> {
    return this.exclusive(async () => {
      if (!sessionId.trim()) throw new TypeError("sessionId must not be empty");
      const next = cloneState(this.state);
      const changedWorkspaceIds = new Set<string>();
      for (const workspace of next.workspaces) {
        if (!workspace.sessionIds.includes(sessionId)) continue;
        workspace.sessionIds = workspace.sessionIds.filter((id) => id !== sessionId);
        workspace.updatedAt = this.timestamp();
        changedWorkspaceIds.add(workspace.workspaceId);
      }
      const archivedChanged = next.archivedSessionIds.includes(sessionId);
      if (archivedChanged) {
        next.archivedSessionIds = next.archivedSessionIds.filter((id) => id !== sessionId);
      }
      const pinnedChanged = next.pinnedSessionIds.includes(sessionId);
      if (pinnedChanged) {
        next.pinnedSessionIds = next.pinnedSessionIds.filter((id) => id !== sessionId);
      }
      if (changedWorkspaceIds.size === 0 && !archivedChanged && !pinnedChanged) {
        return { removed: false };
      }

      const events: WorkspaceStoreEvent[] = next.workspaces
        .filter((workspace) => changedWorkspaceIds.has(workspace.workspaceId))
        .map((workspace) => ({ type: "host/workspace-changed", workspace }));
      if (archivedChanged) {
        events.push({
          type: "host/session-archive-changed",
          sessionId,
          archived: false,
        });
      }
      if (pinnedChanged) {
        events.push({
          type: "host/session-pinned-changed",
          sessionId,
          pinned: false,
        });
      }
      await this.commit(next, events);
      return { removed: true };
    });
  }

  reconcile(
    sessions: readonly WorkspaceSessionSnapshot[],
    options: WorkspaceReconcileOptions = {},
  ): Promise<WorkspaceListResult> {
    return this.exclusive(async () => {
      const next = cloneState(this.state);
      const shouldImportUnknown = options.importUnknownWorkspaces ?? !this.state.legacyReconciled;
      const seenSnapshots = new Set<string>();
      const snapshots = sessions.filter((session) => {
        if (!session.id.trim() || seenSnapshots.has(session.id)) return false;
        seenSnapshots.add(session.id);
        return true;
      });
      const stalePinnedSessionIds = next.pinnedSessionIds.filter(
        (sessionId) => !seenSnapshots.has(sessionId),
      );
      if (stalePinnedSessionIds.length > 0) {
        next.pinnedSessionIds = next.pinnedSessionIds.filter((sessionId) =>
          seenSnapshots.has(sessionId),
        );
      }
      const changedWorkspaceIds = new Set<string>();
      let orderChanged = false;
      let timestamp: string | undefined;
      const mutationTime = (): string => {
        timestamp ??= this.timestamp();
        return timestamp;
      };

      const assigned = new Set(next.workspaces.flatMap((workspace) => workspace.sessionIds));

      for (const session of snapshots) {
        if (assigned.has(session.id)) continue;
        if (!shouldImportUnknown) continue;

        const canonicalPath = await this.tryCanonicalPath(session.cwd);
        if (!canonicalPath) continue;
        let workspace = next.workspaces.find((item) => item.path === canonicalPath);
        if (
          !workspace &&
          shouldImportUnknown &&
          !next.ignoredWorkspacePaths.includes(canonicalPath)
        ) {
          const createdAt = mutationTime();
          workspace = {
            workspaceId: randomUUID(),
            path: canonicalPath,
            title: uniqueMigrationTitle(next, canonicalPath),
            sessionIds: [],
            createdAt,
            updatedAt: createdAt,
          };
          next.workspaces.push(workspace);
          orderChanged = true;
        }
        if (!workspace) continue;

        workspace.sessionIds.push(session.id);
        workspace.updatedAt = mutationTime();
        assigned.add(session.id);
        changedWorkspaceIds.add(workspace.workspaceId);
      }

      const markerChanged = !next.legacyReconciled;
      next.legacyReconciled = true;
      if (
        !markerChanged &&
        changedWorkspaceIds.size === 0 &&
        !orderChanged &&
        stalePinnedSessionIds.length === 0
      ) {
        return listResult(this.state);
      }

      const events: WorkspaceStoreEvent[] = next.workspaces
        .filter((workspace) => changedWorkspaceIds.has(workspace.workspaceId))
        .map((workspace) => ({ type: "host/workspace-changed", workspace }));
      if (orderChanged) {
        events.push({
          type: "host/workspace-order-changed",
          workspaceIds: next.workspaces.map((workspace) => workspace.workspaceId),
        });
      }
      for (const sessionId of stalePinnedSessionIds) {
        events.push({ type: "host/session-pinned-changed", sessionId, pinned: false });
      }
      await this.commit(next, events);
      return listResult(next);
    });
  }

  reconcileSessions(
    sessions: readonly WorkspaceSessionSnapshot[],
    options: WorkspaceReconcileOptions = {},
  ): Promise<WorkspaceListResult> {
    return this.reconcile(sessions, options);
  }

  private exclusive<Result>(operation: () => Promise<Result>): Promise<Result> {
    const run = this.tail.then(
      () => this.withFileLock(operation),
      () => this.withFileLock(operation),
    );
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private withFileLock<Result>(operation: () => Promise<Result>): Promise<Result> {
    return withCrossProcessFileLock(
      {
        lockDirectory: `${this.stateFile}.lock`,
        waitTimeoutMs: LOCK_WAIT_TIMEOUT_MS,
        staleAfterMs: LOCK_STALE_AFTER_MS,
        heartbeatIntervalMs: LOCK_HEARTBEAT_MS,
      },
      async () => {
        await this.load();
        return await operation();
      },
    );
  }

  private async load(): Promise<void> {
    if (this.documentSection) {
      const document = await readWorkbenchSettingsDocument(this.stateFile);
      if (document.workspaces !== undefined) {
        this.state = parseState(document.workspaces);
        return;
      }

      let migrated = false;
      if (this.legacyStateFile && this.legacyStateFile !== this.stateFile) {
        try {
          this.state = parseState(JSON.parse(await readFile(this.legacyStateFile, "utf8")));
          migrated = true;
        } catch (error) {
          if (!isRecord(error) || error.code !== "ENOENT") throw error;
          this.state = EMPTY_STATE();
        }
      } else {
        this.state = EMPTY_STATE();
      }

      await writeWorkbenchSettingsDocument(
        this.stateFile,
        nextWorkbenchSettingsDocument(document, { workspaces: this.state }),
      );
      if (migrated && this.legacyStateFile) {
        await rm(this.legacyStateFile, { force: true }).catch(() => undefined);
      }
      return;
    }

    try {
      this.state = parseState(JSON.parse(await readFile(this.stateFile, "utf8")));
    } catch (error) {
      if (isRecord(error) && error.code === "ENOENT") this.state = EMPTY_STATE();
      else throw error;
    }
  }

  private async canonicalPath(requestedPath: string): Promise<string> {
    const candidate = requestedPath.trim();
    if (!candidate) {
      throw new WorkspaceStoreError("workspace-invalid-path", "Workspace path must not be empty.", {
        path: requestedPath,
      });
    }
    try {
      const canonical = (await this.canonicalizePath(candidate)).trim();
      if (!canonical) throw new Error("Canonical workspace path is empty");
      return path.resolve(canonical);
    } catch {
      throw new WorkspaceStoreError(
        "workspace-invalid-path",
        `Workspace path is invalid: ${requestedPath}`,
        { path: requestedPath },
      );
    }
  }

  private async tryCanonicalPath(requestedPath: string): Promise<string | undefined> {
    try {
      return await this.canonicalPath(requestedPath);
    } catch (error) {
      if (error instanceof WorkspaceStoreError && error.code === "workspace-invalid-path") {
        return undefined;
      }
      throw error;
    }
  }

  private workspaceIndex(workspaceId: string): number {
    const index = this.state.workspaces.findIndex(
      (workspace) => workspace.workspaceId === workspaceId,
    );
    if (index < 0) {
      throw new WorkspaceStoreError("workspace-not-found", `Workspace not found: ${workspaceId}`, {
        workspaceId,
      });
    }
    return index;
  }

  private timestamp(): string {
    const value = this.now();
    const timestamp = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(timestamp.getTime())) throw new TypeError("now() returned an invalid date");
    return timestamp.toISOString();
  }

  private async commit(next: WorkspaceState, events: WorkspaceStoreEvent[]): Promise<void> {
    await this.persist(next);
    this.state = next;
    for (const event of events) this.emit(event);
  }

  private async persist(state: WorkspaceState): Promise<void> {
    if (this.documentSection) {
      const document = await readWorkbenchSettingsDocument(this.stateFile);
      await writeWorkbenchSettingsDocument(
        this.stateFile,
        nextWorkbenchSettingsDocument(document, { workspaces: state }),
      );
      return;
    }
    await atomicReplaceFile(this.stateFile, `${JSON.stringify(state, null, 2)}\n`, {
      fileMode: 0o600,
    });
  }

  private emit(event: WorkspaceStoreEvent): void {
    const snapshot: WorkspaceStoreEvent =
      event.type === "host/workspace-changed"
        ? {
            ...event,
            workspace: visibleWorkspace(event.workspace, this.state.archivedSessionIds),
          }
        : event.type === "host/workspace-order-changed"
          ? { ...event, workspaceIds: [...event.workspaceIds] }
          : event.type === "host/session-archive-changed" && event.workspace
            ? {
                ...event,
                workspace: visibleWorkspace(event.workspace, this.state.archivedSessionIds),
              }
            : { ...event };
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // A host-stream subscriber cannot roll back an already persisted mutation.
      }
    }
    try {
      getStreamHub().publishHost(snapshot);
    } catch {
      // A stream transport failure cannot roll back persisted workspace state.
    }
  }
}
