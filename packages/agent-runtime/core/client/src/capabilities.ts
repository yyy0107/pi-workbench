import type {
  WorkbenchContextPolicy,
  WorkbenchContextPolicyValue,
  WorkbenchInteractionResponse,
  WorkbenchModelCatalog,
  WorkbenchPendingInteraction,
  WorkbenchScratchSession,
  WorkbenchScratchSessionCreateRequest,
  WorkbenchScratchSessionPromoteRequest,
  WorkbenchScratchSessionPromotion,
  WorkbenchSessionModelCatalog,
  WorkbenchWorkspaceCreation,
  WorkbenchWorkspaceFileDescriptor,
  WorkbenchWorkspaceFileRequest,
  WorkbenchWorkspaceFileSnapshot,
  WorkbenchWorkspaceFilesListRequest,
  WorkbenchWorkspaceFilesListResult,
  WorkbenchWorkspaceFilesSearchRequest,
  WorkbenchWorkspaceFilesSearchResult,
  WorkbenchWorkspaceFileTextChunk,
  WorkbenchWorkspaceFileTextResult,
  WorkbenchWorkspaceFileWriteRequest,
  WorkbenchWorkspaceGitLog,
  WorkbenchWorkspaceGitStatus,
} from "@workbench/agent-runtime-contracts/runtime-capabilities";
import type {
  AttachmentUnderstandingDescribeValue,
  AttachmentUnderstandingUpdatePayload,
} from "@workbench/attachment-understanding-contracts/settings";
import type { AutomationProtocol } from "@workbench/automation-contracts";
import type { ModelSelection } from "@workbench/contracts/model-selection";
import type {
  WorkbenchHostDirectoryListing,
  WorkbenchLocalApp,
  WorkbenchLocalAppOpenRequest,
  WorkbenchProjectTrust,
} from "@workbench/host-contracts/runtime-capabilities";

export type WorkbenchAgentCapabilityErrorCode =
  | "busy"
  | "cancelled"
  | "conflict"
  | "failed"
  | "invalid-request"
  | "not-found"
  | "permission-denied"
  | "request-ended"
  | "unavailable";

/** Runtime-neutral failure surfaced by a Workbench Agent capability. */
export class WorkbenchAgentCapabilityError extends Error {
  readonly code: WorkbenchAgentCapabilityErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: WorkbenchAgentCapabilityErrorCode,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(code);
    this.name = "WorkbenchAgentCapabilityError";
    this.code = code;
    this.details = details;
  }
}

export interface WorkbenchRuntimeHostCapability {
  pickDirectory(): Promise<string | undefined>;
  listDirectory(path?: string): Promise<WorkbenchHostDirectoryListing>;
  createDirectory(path: string, name: string): Promise<string>;
  openPath(path: string): Promise<void>;
  listLocalApps(): Promise<readonly WorkbenchLocalApp[]>;
  openLocalApp(request: WorkbenchLocalAppOpenRequest): Promise<void>;
  describeProjectTrust(path: string): Promise<WorkbenchProjectTrust>;
  updateProjectTrust(path: string, trusted: boolean): Promise<WorkbenchProjectTrust>;
}

export interface WorkbenchCapabilityRequestOptions {
  readonly signal?: AbortSignal;
}

export interface WorkbenchWorkspaceFileStreamOptions extends WorkbenchCapabilityRequestOptions {
  onChunk(chunk: WorkbenchWorkspaceFileTextChunk): void;
}

export interface WorkbenchWorkspaceCapability {
  createWorkspace(rootPath: string): Promise<WorkbenchWorkspaceCreation>;
  listFiles(
    request: WorkbenchWorkspaceFilesListRequest,
  ): Promise<WorkbenchWorkspaceFilesListResult>;
  searchFiles(
    request: WorkbenchWorkspaceFilesSearchRequest,
    options?: WorkbenchCapabilityRequestOptions,
  ): Promise<WorkbenchWorkspaceFilesSearchResult>;
  describeFile(request: WorkbenchWorkspaceFileRequest): Promise<WorkbenchWorkspaceFileDescriptor>;
  fileContentUrl(request: WorkbenchWorkspaceFileRequest): string;
  fetchFileContent(
    request: WorkbenchWorkspaceFileRequest,
    options?: WorkbenchCapabilityRequestOptions,
  ): Promise<Blob>;
  readFile(request: WorkbenchWorkspaceFileRequest): Promise<WorkbenchWorkspaceFileSnapshot>;
  writeFile(request: WorkbenchWorkspaceFileWriteRequest): Promise<WorkbenchWorkspaceFileSnapshot>;
  streamFileText(
    request: WorkbenchWorkspaceFileRequest,
    options: WorkbenchWorkspaceFileStreamOptions,
  ): Promise<WorkbenchWorkspaceFileTextResult>;
  describeGit(
    workspaceId: string,
    options?: WorkbenchCapabilityRequestOptions,
  ): Promise<WorkbenchWorkspaceGitStatus>;
  readGitLog(
    workspaceId: string,
    options?: WorkbenchCapabilityRequestOptions,
  ): Promise<WorkbenchWorkspaceGitLog>;
  switchGitBranch(workspaceId: string, branch: string): Promise<WorkbenchWorkspaceGitStatus>;
  createGitBranch(workspaceId: string, branch: string): Promise<WorkbenchWorkspaceGitStatus>;
}

export interface WorkbenchModelSelectionCapability {
  getCatalogRevision(): number;
  subscribeCatalog(listener: () => void): () => void;
  getSessionSelectionRevision(sessionId: string): number;
  subscribeSessionSelection(sessionId: string, listener: () => void): () => void;
  listCatalog(): Promise<WorkbenchModelCatalog>;
  listSessionModels(sessionId: string): Promise<WorkbenchSessionModelCatalog>;
  selectSessionModel(sessionId: string, selection: ModelSelection): Promise<ModelSelection>;
  setDraftSelection(sessionId: string, selection: ModelSelection | undefined): void;
  reloadSession(sessionId: string): Promise<void>;
}

export interface WorkbenchInteractionCapability {
  getRevision(): number;
  subscribe(listener: () => void): () => void;
  getPendingInteractions(sessionId?: string): readonly WorkbenchPendingInteraction[];
  respondInteraction(requestId: string, response: WorkbenchInteractionResponse): Promise<void>;
}

export interface WorkbenchScratchSessionCapability {
  createScratchSession(
    request: WorkbenchScratchSessionCreateRequest,
  ): Promise<WorkbenchScratchSession>;
  restoreScratchSession(session: WorkbenchScratchSession): boolean;
  releaseScratchSession(sessionId: string): Promise<void>;
  promoteScratchSession(
    request: WorkbenchScratchSessionPromoteRequest,
  ): Promise<WorkbenchScratchSessionPromotion>;
}

export interface WorkbenchContextCapabilitySnapshot {
  status: "idle" | "loading" | "ready" | "saving" | "failed";
  value?: WorkbenchContextPolicyValue;
  error?: WorkbenchAgentCapabilityError;
}

export interface WorkbenchContextCapability {
  getSnapshot(sessionId?: string): WorkbenchContextCapabilitySnapshot;
  subscribe(sessionId: string | undefined, listener: () => void): () => void;
  load(sessionId: string, force?: boolean): Promise<WorkbenchContextPolicyValue>;
  update(sessionId: string, policy: WorkbenchContextPolicy): Promise<WorkbenchContextPolicyValue>;
  compact(sessionId: string): Promise<WorkbenchContextPolicyValue>;
}

export interface WorkbenchAttachmentUnderstandingCapability {
  describe(): Promise<AttachmentUnderstandingDescribeValue>;
  update(
    request: AttachmentUnderstandingUpdatePayload,
  ): Promise<AttachmentUnderstandingDescribeValue>;
}

/** Direct fields keep capability discovery typed without introducing a runtime registry. */
export interface WorkbenchAgentRuntimeCapabilities {
  readonly host?: WorkbenchRuntimeHostCapability;
  readonly workspace?: WorkbenchWorkspaceCapability;
  readonly models?: WorkbenchModelSelectionCapability;
  readonly interactions?: WorkbenchInteractionCapability;
  readonly scratchSessions?: WorkbenchScratchSessionCapability;
  readonly context?: WorkbenchContextCapability;
  readonly automation?: AutomationProtocol;
  readonly attachmentUnderstanding?: WorkbenchAttachmentUnderstandingCapability;
}
