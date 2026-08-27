import type {
  WorkspaceArchivedSessionsValue,
  WorkspaceListValue,
  WorkspacePinValue,
  WorkspaceSessionArchiveValue,
  WorkspaceSessionPinValue,
  WorkspaceView,
} from "@/runtime/pi/contracts/rpc";
import { RpcDomainError } from "../core/rpc-domain-error";
import { getScopedResourceContextService } from "../resources/scoped-resource-context";
import { listSessions as listPiSessions } from "../sessions/session-registry";
import { getProjectTrustService } from "../trust/project-trust-service";
import { getWorkspaceStore } from "./workspace-registry";
import type {
  WorkspaceArchiveSessionInput,
  WorkspaceCreateInput,
  WorkspaceCreateResult,
  WorkspaceDeleteInput,
  WorkspaceInsertBeforeInput,
  WorkspaceInsertSessionBeforeInput,
  WorkspaceListResult,
  WorkspaceRenameInput,
  WorkspaceSessionSnapshot,
  WorkspaceSetPinnedInput,
  WorkspaceSetSessionPinnedInput,
} from "./workspace-store";

export interface WorkspaceProtocolStore {
  list(): Promise<WorkspaceListResult>;
  reconcileSessions(sessions: readonly WorkspaceSessionSnapshot[]): Promise<WorkspaceListResult>;
  migrateExistingProjectTrust(
    migrate: (workspacePaths: readonly string[]) => void | Promise<void>,
  ): Promise<WorkspaceListResult>;
  create(input: WorkspaceCreateInput): Promise<WorkspaceCreateResult>;
  rename(input: WorkspaceRenameInput): Promise<{ workspace: WorkspaceView }>;
  delete(input: WorkspaceDeleteInput): Promise<{ deleted: true }>;
  insertBefore(input: WorkspaceInsertBeforeInput): Promise<{ workspaceIds: string[] }>;
  insertSessionBefore(
    input: WorkspaceInsertSessionBeforeInput,
  ): Promise<{ workspace: WorkspaceView }>;
  setPinned(input: WorkspaceSetPinnedInput): Promise<WorkspacePinValue>;
  setSessionPinned(input: WorkspaceSetSessionPinnedInput): Promise<WorkspaceSessionPinValue>;
  archiveSession(input: WorkspaceArchiveSessionInput): Promise<WorkspaceSessionArchiveValue>;
  unarchiveSession(session: WorkspaceSessionSnapshot): Promise<WorkspaceSessionArchiveValue>;
}

export interface WorkspaceSessionCatalogPort {
  list(): Promise<readonly WorkspaceSessionSnapshot[]>;
}

export interface ExistingWorkspaceTrustMigrationPort {
  trustExistingProjects(workspacePaths: readonly string[]): void | Promise<void>;
}

export interface WorkspaceResourceContextPort {
  invalidateProject(workspaceId: string): void;
}

export interface WorkspaceProtocolServiceDependencies {
  readonly resolveWorkspaceStore: () => WorkspaceProtocolStore;
  readonly sessions: WorkspaceSessionCatalogPort;
  readonly projectTrust: ExistingWorkspaceTrustMigrationPort;
  readonly resourceContexts: WorkspaceResourceContextPort;
}

export interface WorkspaceProtocolService {
  list(): Promise<WorkspaceListValue>;
  listArchivedSessions(): Promise<WorkspaceArchivedSessionsValue>;
  create(input: WorkspaceCreateInput): Promise<WorkspaceCreateResult>;
  rename(input: WorkspaceRenameInput): Promise<{ workspace: WorkspaceView }>;
  delete(input: WorkspaceDeleteInput): Promise<{ deleted: true }>;
  insertBefore(input: WorkspaceInsertBeforeInput): Promise<{ workspaceIds: string[] }>;
  insertSessionBefore(
    input: WorkspaceInsertSessionBeforeInput,
  ): Promise<{ workspace: WorkspaceView }>;
  setPinned(input: WorkspaceSetPinnedInput): Promise<WorkspacePinValue>;
  setSessionPinned(input: WorkspaceSetSessionPinnedInput): Promise<WorkspaceSessionPinValue>;
  archiveSession(input: WorkspaceArchiveSessionInput): Promise<WorkspaceSessionArchiveValue>;
  unarchiveSession(input: WorkspaceArchiveSessionInput): Promise<WorkspaceSessionArchiveValue>;
}

export interface WorkspaceProtocolServiceErrorDetails {
  "session-not-found": { sessionId: string };
}

export type WorkspaceProtocolServiceErrorCode = keyof WorkspaceProtocolServiceErrorDetails;

export class WorkspaceProtocolServiceError<
  Code extends WorkspaceProtocolServiceErrorCode = WorkspaceProtocolServiceErrorCode,
> extends RpcDomainError<Code, WorkspaceProtocolServiceErrorDetails[Code]> {
  readonly code: Code;
  readonly details: WorkspaceProtocolServiceErrorDetails[Code];

  constructor(code: Code, message: string, details: WorkspaceProtocolServiceErrorDetails[Code]) {
    super(message);
    this.name = "WorkspaceProtocolServiceError";
    this.code = code;
    this.details = details;
  }
}

function defaultDependencies(): WorkspaceProtocolServiceDependencies {
  return {
    resolveWorkspaceStore: getWorkspaceStore,
    sessions: {
      async list() {
        const { sessions } = await listPiSessions();
        return sessions.map(({ id, cwd }) => ({ id, cwd }));
      },
    },
    projectTrust: {
      async trustExistingProjects(workspacePaths) {
        await getProjectTrustService().trustExistingProjects(workspacePaths);
      },
    },
    resourceContexts: {
      invalidateProject(workspaceId) {
        getScopedResourceContextService().invalidate({ scope: "project", workspaceId });
      },
    },
  };
}

class DefaultWorkspaceProtocolService implements WorkspaceProtocolService {
  private readonly dependencies: WorkspaceProtocolServiceDependencies;

  constructor(dependencies: WorkspaceProtocolServiceDependencies) {
    this.dependencies = dependencies;
  }

  async list(): Promise<WorkspaceListValue> {
    const sessions = await this.dependencies.sessions.list();
    const workspaceStore = this.dependencies.resolveWorkspaceStore();
    await workspaceStore.reconcileSessions(sessions);
    const { items, pinnedWorkspaceIds, pinnedSessionIds } =
      await this.migrateExistingProjectTrust(workspaceStore);
    return { items, pinnedWorkspaceIds, pinnedSessionIds };
  }

  async listArchivedSessions(): Promise<WorkspaceArchivedSessionsValue> {
    const { archivedSessionIds } = await this.dependencies.resolveWorkspaceStore().list();
    return { sessionIds: archivedSessionIds };
  }

  async create(input: WorkspaceCreateInput): Promise<WorkspaceCreateResult> {
    const workspaceStore = this.dependencies.resolveWorkspaceStore();
    await this.migrateExistingProjectTrust(workspaceStore);
    return workspaceStore.create(input);
  }

  rename(input: WorkspaceRenameInput): Promise<{ workspace: WorkspaceView }> {
    return this.dependencies.resolveWorkspaceStore().rename(input);
  }

  async delete(input: WorkspaceDeleteInput): Promise<{ deleted: true }> {
    const result = await this.dependencies.resolveWorkspaceStore().delete(input);
    this.dependencies.resourceContexts.invalidateProject(input.workspaceId);
    return result;
  }

  insertBefore(input: WorkspaceInsertBeforeInput): Promise<{ workspaceIds: string[] }> {
    return this.dependencies.resolveWorkspaceStore().insertBefore(input);
  }

  insertSessionBefore(
    input: WorkspaceInsertSessionBeforeInput,
  ): Promise<{ workspace: WorkspaceView }> {
    return this.dependencies.resolveWorkspaceStore().insertSessionBefore(input);
  }

  setPinned(input: WorkspaceSetPinnedInput): Promise<WorkspacePinValue> {
    return this.dependencies.resolveWorkspaceStore().setPinned(input);
  }

  async setSessionPinned(input: WorkspaceSetSessionPinnedInput): Promise<WorkspaceSessionPinValue> {
    await this.requireSession(input.sessionId);
    return this.dependencies.resolveWorkspaceStore().setSessionPinned(input);
  }

  async archiveSession(input: WorkspaceArchiveSessionInput): Promise<WorkspaceSessionArchiveValue> {
    await this.requireSession(input.sessionId);
    return this.dependencies.resolveWorkspaceStore().archiveSession(input);
  }

  async unarchiveSession(
    input: WorkspaceArchiveSessionInput,
  ): Promise<WorkspaceSessionArchiveValue> {
    const session = await this.requireSession(input.sessionId);
    const workspaceStore = this.dependencies.resolveWorkspaceStore();
    await this.migrateExistingProjectTrust(workspaceStore);
    return workspaceStore.unarchiveSession(session);
  }

  private async migrateExistingProjectTrust(
    workspaceStore: WorkspaceProtocolStore,
  ): Promise<WorkspaceListResult> {
    return workspaceStore.migrateExistingProjectTrust((workspacePaths) =>
      this.dependencies.projectTrust.trustExistingProjects(workspacePaths),
    );
  }

  private async requireSession(sessionId: string): Promise<WorkspaceSessionSnapshot> {
    const sessions = await this.dependencies.sessions.list();
    const session = sessions.find((candidate) => candidate.id === sessionId);
    if (!session) {
      throw new WorkspaceProtocolServiceError("session-not-found", "The session does not exist.", {
        sessionId,
      });
    }
    return session;
  }
}

export function createWorkspaceProtocolService(
  overrides: Partial<WorkspaceProtocolServiceDependencies> = {},
): WorkspaceProtocolService {
  return new DefaultWorkspaceProtocolService({ ...defaultDependencies(), ...overrides });
}
