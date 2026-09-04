import type { ModelSelection } from "@workbench/contracts/model-selection";

export interface WorkbenchRuntimeWorkspace {
  id: string;
  name: string;
  rootPath: string;
}

export interface WorkbenchWorkspaceCreation {
  workspace: WorkbenchRuntimeWorkspace;
  created: boolean;
}

export interface WorkbenchWorkspaceFileEntry {
  name: string;
  relativePath: string;
  absolutePath: string;
  kind: "file" | "directory";
  hidden: boolean;
  symbolicLink?: boolean;
}

export interface WorkbenchWorkspaceFilesListRequest {
  workspaceId: string;
  relativePath?: string;
}

export interface WorkbenchWorkspaceFilesListResult {
  workspaceId: string;
  relativePath: string;
  absolutePath: string;
  entries: WorkbenchWorkspaceFileEntry[];
  truncated: boolean;
}

export interface WorkbenchWorkspaceFilesSearchRequest {
  workspaceId: string;
  query: string;
  limit?: number;
}

export interface WorkbenchWorkspaceFilesSearchResult {
  workspaceId: string;
  query: string;
  entries: WorkbenchWorkspaceFileEntry[];
  truncated: boolean;
}

export interface WorkbenchWorkspaceFileRequest {
  workspaceId: string;
  relativePath: string;
}

export interface WorkbenchWorkspaceFileDescriptor {
  workspaceId: string;
  relativePath: string;
  absolutePath: string;
  name: string;
  mediaType: string;
  encoding: "utf-8" | null;
  version: string;
  size: number;
  modifiedAt: number;
}

export interface WorkbenchWorkspaceFileSnapshot {
  workspaceId: string;
  relativePath: string;
  absolutePath: string;
  name: string;
  content: string;
  encoding: "utf-8";
  version: string;
  size: number;
  modifiedAt: number;
}

export interface WorkbenchWorkspaceFileWriteRequest extends WorkbenchWorkspaceFileRequest {
  content: string;
  expectedVersion: string;
}

export interface WorkbenchWorkspaceFileTextChunk {
  text: string;
  loadedBytes: number;
  totalBytes?: number;
}

export interface WorkbenchWorkspaceFileTextResult {
  loadedBytes: number;
  totalBytes?: number;
}

export type WorkbenchWorkspaceGitChangeKind =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "conflicted";

export interface WorkbenchWorkspaceGitChangedFile {
  path: string;
  previousPath?: string;
  kind: WorkbenchWorkspaceGitChangeKind;
  additions?: number;
  deletions?: number;
}

export interface WorkbenchWorkspaceGitRepositoryStatus {
  repository: true;
  branch?: string;
  detachedHead?: string;
  branches: string[];
  changedFileCount: number;
  changedFiles: WorkbenchWorkspaceGitChangedFile[];
  changedFilesTruncated: boolean;
}

export type WorkbenchWorkspaceGitStatus =
  | { repository: false }
  | WorkbenchWorkspaceGitRepositoryStatus;

export type WorkbenchWorkspaceGitRefKind = "head" | "local" | "remote" | "tag" | "other";

export interface WorkbenchWorkspaceGitCommitRef {
  name: string;
  kind: WorkbenchWorkspaceGitRefKind;
}

export interface WorkbenchWorkspaceGitCommit {
  hash: string;
  shortHash: string;
  parentHashes: string[];
  authorName: string;
  authoredAt: string;
  subject: string;
  refs: WorkbenchWorkspaceGitCommitRef[];
}

export interface WorkbenchWorkspaceGitLog {
  commits: WorkbenchWorkspaceGitCommit[];
  truncated: boolean;
}

export interface WorkbenchModelReasoningEffort {
  id: string;
  name: string;
  description?: string;
}

export interface WorkbenchModelCatalogEntry {
  id: string;
  name: string;
  description?: string;
  input?: Array<"text" | "image">;
  imageInput: "supported" | "unsupported" | "unknown";
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: {
    efforts: WorkbenchModelReasoningEffort[];
    defaultEffort?: string;
  };
}

export interface WorkbenchModelProviderGroup {
  id: string;
  name: string;
  models: WorkbenchModelCatalogEntry[];
}

export interface WorkbenchModelCatalogFailure {
  id: string;
  name: string;
  message: string;
}

export interface WorkbenchModelCatalog {
  groups: WorkbenchModelProviderGroup[];
  failures: WorkbenchModelCatalogFailure[];
}

export interface WorkbenchSessionModelCatalog extends WorkbenchModelCatalog {
  current: ModelSelection;
  routable: boolean;
}

export interface WorkbenchInteractionQuestion {
  id: string;
  question: string;
  header?: string;
  detail?: string;
  options?: Array<{ label: string; description?: string; recommended?: boolean }>;
  allowCustom?: boolean;
  multiSelect?: boolean;
  required?: boolean;
  intent?: { kind: "plan-review"; approve: string };
}

export interface WorkbenchInteractionAnswer {
  id: string;
  selected: string[];
  custom?: string;
}

export type WorkbenchPendingInteraction =
  | {
      kind: "question";
      requestId: string;
      sessionId: string;
      questions: readonly WorkbenchInteractionQuestion[];
    }
  | {
      kind: "approval";
      requestId: string;
      sessionId: string;
      approvalId: string;
      toolName: string;
      callId?: string;
      reason?: string;
    };

export type WorkbenchInteractionResponse =
  | { kind: "question"; answers: readonly WorkbenchInteractionAnswer[] }
  | { kind: "approval"; outcome: "allowed-once" | "rejected" }
  | { kind: "cancel"; message?: string };

export interface WorkbenchScratchSession {
  sessionId: string;
  sourceSessionId: string;
  expiresAt: number;
}

export interface WorkbenchScratchSessionCreateRequest {
  sourceSessionId: string;
}

export interface WorkbenchScratchSessionPromoteRequest {
  sessionId: string;
  title?: string;
}

export interface WorkbenchScratchSessionPromotion {
  sessionId: string;
  sourceSessionId: string;
}

export interface WorkbenchContextPolicyCompaction {
  enabled?: boolean;
  reserveTokens?: number;
  keepRecentTokens?: number;
}

export interface WorkbenchContextPolicy {
  mode: "inherit" | "auto" | "maximum" | "custom";
  desiredContextTokens?: number;
  compaction?: WorkbenchContextPolicyCompaction;
}

export type WorkbenchContextBreakdownCategory =
  | "system-prompt"
  | "skills"
  | "context-files"
  | "builtin-tools"
  | "mcp-tools"
  | "extension-tools"
  | "user-input"
  | "assistant-history"
  | "tool-results"
  | "other";

export interface WorkbenchContextBreakdownItem {
  category: WorkbenchContextBreakdownCategory;
  tokens: number;
  count: number;
}

export interface WorkbenchContextBreakdown {
  basis: "provider-reconciled" | "heuristic";
  totalTokens: number;
  items: WorkbenchContextBreakdownItem[];
}

export interface WorkbenchContextPolicyValue {
  policy: WorkbenchContextPolicy;
  overridden: boolean;
  model?: {
    provider: string;
    model: string;
    name: string;
    capacity: number;
    effectiveBudget: number;
  };
  compaction: {
    enabled: boolean;
    reserveTokens: number;
    keepRecentTokens: number;
    thresholdTokens?: number;
  };
  usage: {
    tokens: number | null;
    percent: number | null;
  };
  breakdown?: WorkbenchContextBreakdown;
  nearingCompaction: boolean;
}
