export interface WorkspaceView {
  workspaceId: string;
  path: string;
  title: string;
  sessionIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceSessionArchiveValue {
  sessionId: string;
  archived: boolean;
}

export interface WorkspacePinValue {
  workspaceId: string;
  pinned: boolean;
}

export interface WorkspaceSessionPinValue {
  sessionId: string;
  pinned: boolean;
}

export interface WorkspaceState {
  schemaVersion: 1;
  legacyReconciled: boolean;
  workspaces: WorkspaceView[];
  archivedSessionIds: string[];
  pinnedWorkspaceIds: string[];
  pinnedSessionIds: string[];
  ignoredWorkspacePaths: string[];
}

export type WorkspaceStoreEvent =
  | { type: "workspace-changed"; workspace: WorkspaceView }
  | { type: "workspace-removed"; workspaceId: string }
  | { type: "workspace-order-changed"; workspaceIds: string[] }
  | { type: "workspace-pinned-changed"; workspaceId: string; pinned: boolean }
  | {
      type: "session-archive-changed";
      sessionId: string;
      archived: boolean;
      workspace?: WorkspaceView;
    }
  | { type: "session-pinned-changed"; sessionId: string; pinned: boolean };

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

export interface WorkspaceSessionSnapshot {
  id: string;
  cwd: string;
}
export interface WorkspaceSessionCatalogPort {
  list(): Promise<readonly WorkspaceSessionSnapshot[]>;
}
export interface WorkspaceSessionRemovalPort {
  removeSession(sessionId: string): Promise<{ removed: boolean }>;
}
export interface WorkspaceSessionAttachmentPort {
  attachSession(workspaceId: string, sessionId: string): Promise<{ workspace: WorkspaceView }>;
}
export interface WorkspaceCreationPort {
  create(input: WorkspaceCreateInput): Promise<WorkspaceCreateResult>;
}
export interface WorkspaceCatalogListPort {
  list(): Promise<WorkspaceListResult>;
}
