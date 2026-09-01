import type {
  ComposerCommandArgsBinding as WorkbenchComposerCommandArgsBinding,
  ComposerCommandArgsSchema as WorkbenchComposerCommandArgsSchema,
  ComposerCommandEffect as WorkbenchComposerCommandEffect,
  ComposerSubmission as WorkbenchComposerSubmission,
} from "@workbench/contracts/composer";
import type { OcrAdapterPresetId } from "@workbench/attachment-understanding-contracts/ocr-adapter";
import type { ModelSelection } from "@workbench/contracts/model-selection";
import type {
  WorkbenchSettingsPreferences,
  WorkbenchSettingsPreferencesPatch,
} from "@workbench/agent-runtime-contracts/settings";

export type { ModelSelection } from "@workbench/contracts/model-selection";
export type {
  WorkbenchBackgroundImagePreference,
  WorkbenchModelSelectorPreference,
  WorkbenchSettingsJsonValue,
  WorkbenchSettingsPreferences,
  WorkbenchSettingsPreferencesPatch,
  WorkbenchSidebarThreadSortMode,
  WorkbenchToolboxScopePreference,
} from "@workbench/agent-runtime-contracts/settings";

import type { InlineDocumentMediaType, InlineImageMediaType } from "./attachments";
import type { PiRunTiming } from "./messages";

export type RpcIssuePathSegment = string | number;

/**
 * A validation issue returned in `bad-request` error details.
 *
 * Validators may attach additional structured metadata (for example
 * `expected` or `minimum`) without changing the common wire contract.
 */
export interface RpcIssue {
  code: string;
  path: RpcIssuePathSegment[];
  message: string;
  [key: string]: unknown;
}

export interface RpcError<Details extends Record<string, unknown> = Record<string, unknown>> {
  code: string;
  message: string;
  details: Details;
}

export interface ClientRequest<Method extends string = string, Payload = unknown> {
  type: "client-request";
  rpcId: string;
  method: Method;
  payload: Payload;
}

export interface RpcSuccess<Value> {
  ok: true;
  /** JSON serialization omits this property when the handler returns `undefined`. */
  value: Value;
}

export interface RpcFailure<Details extends Record<string, unknown> = Record<string, unknown>> {
  ok: false;
  error: RpcError<Details>;
}

export interface ServerResponse<
  Value = unknown,
  Details extends Record<string, unknown> = Record<string, unknown>,
> {
  type: "server-response";
  rpcId: string;
  result: RpcSuccess<Value> | RpcFailure<Details>;
}

export interface QuestionAnswerItem {
  id: string;
  selected: string[];
  custom?: string;
}

export interface QuestionResponseValue {
  sessionId: string;
  answer: { answers: QuestionAnswerItem[] };
}

export interface ApprovalResponseValue {
  sessionId: string;
  approvalId: string;
  outcome: "allowed-once" | "rejected";
}

export interface CancelledClientResponseError {
  code: "cancelled";
  message: string;
  details: Record<string, unknown>;
}

/** Response to an answerable `server-request`; carried by `POST /api/respond`. */
export interface ClientResponse {
  type: "client-response";
  rpcId: string;
  result:
    | RpcSuccess<ApprovalResponseValue | QuestionResponseValue>
    | { ok: false; error: CancelledClientResponseError };
}

/** Carrier receipt for `POST /api/respond`; this is intentionally not an RPC envelope. */
export type RpcReceipt =
  | { accepted: true }
  | { accepted: false; reason: "not-pending" | "bad-response" };

export interface WorkspaceView {
  workspaceId: string;
  path: string;
  title: string;
  sessionIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceListValue {
  items: WorkspaceView[];
  /** Server-owned presentation state. Missing fields are treated as empty for older hosts. */
  pinnedWorkspaceIds?: string[];
  pinnedSessionIds?: string[];
}

export interface WorkspaceArchivedSessionsValue {
  sessionIds: string[];
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

export const WORKSPACE_GIT_BRANCH_NAME_LENGTH_LIMIT = 255;
export const WORKSPACE_GIT_LOG_COMMIT_LIMIT = 500;

export interface WorkspaceGitDescribePayload {
  workspaceId: string;
}

export type WorkspaceGitChangeKind =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "conflicted";

export interface WorkspaceGitChangedFile {
  path: string;
  previousPath?: string;
  kind: WorkspaceGitChangeKind;
  additions?: number;
  deletions?: number;
}

export interface WorkspaceGitRepositoryStatus {
  repository: true;
  /** Present while HEAD points to a named local branch, including an unborn branch. */
  branch?: string;
  /** Short commit id used only when HEAD is detached. */
  detachedHead?: string;
  branches: string[];
  changedFileCount: number;
  changedFiles: WorkspaceGitChangedFile[];
  changedFilesTruncated: boolean;
}

export type WorkspaceGitStatus = { repository: false } | WorkspaceGitRepositoryStatus;

export interface WorkspaceGitSwitchBranchPayload extends WorkspaceGitDescribePayload {
  branch: string;
}

export interface WorkspaceGitCreateBranchPayload extends WorkspaceGitDescribePayload {
  branch: string;
}

export type WorkspaceGitRefKind = "head" | "local" | "remote" | "tag" | "other";

export interface WorkspaceGitCommitRef {
  name: string;
  kind: WorkspaceGitRefKind;
}

export interface WorkspaceGitCommit {
  hash: string;
  shortHash: string;
  parentHashes: string[];
  authorName: string;
  authoredAt: string;
  subject: string;
  refs: WorkspaceGitCommitRef[];
}

export interface WorkspaceGitLogValue {
  commits: WorkspaceGitCommit[];
  truncated: boolean;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  hidden: boolean;
}

export interface HostDirectoryListing {
  path: string;
  home: string;
  crumbs: DirectoryEntry[];
  entries: DirectoryEntry[];
  truncated: boolean;
}

export interface ProjectTrustDescribePayload {
  path: string;
}

export interface ProjectTrustDescribeValue {
  /** Canonical project directory used as the trust identity. */
  path: string;
  /** Whether the directory currently contains project-local resources gated by Pi trust. */
  requiresTrust: boolean;
  /** Effective decision. Null means the Workbench UI must ask before admitting the directory. */
  trusted: boolean | null;
  /** Whether admission needs a decision; independent of whether gated resources exist yet. */
  promptRequired: boolean;
  /** Canonical current or parent directory supplying a saved decision. */
  decisionPath?: string;
}

export interface ProjectTrustUpdatePayload {
  path: string;
  trusted: boolean;
}

export type LocalAppKind = "editor" | "media-player" | "terminal" | "file-manager";

export type LocalAppFileKind =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "pdf"
  | "document"
  | "archive"
  | "other";

export type LocalAppPlatform = "windows" | "macos" | "linux";

/** Renderer-safe local application metadata. Launcher details remain in the host process. */
export interface LocalAppView {
  id: string;
  name: string;
  kind: LocalAppKind;
  icon?: string;
  supportedFileKinds: readonly LocalAppFileKind[];
}

export interface LocalAppsListValue {
  apps: LocalAppView[];
}

export interface LocalAppOpenPayload {
  appId: string;
  target: string;
}

export interface LocalAppOpenValue {
  opened: true;
}

/** Maximum length of a normalized workspace-relative path accepted by the file protocol. */
export const WORKSPACE_FILE_RELATIVE_PATH_LENGTH_LIMIT = 16_384;

/** Maximum UTF-8 text content accepted by editable Workspace file snapshots. */
export const WORKSPACE_FILE_EDITABLE_SIZE_LIMIT = 5 * 1024 * 1024;

export interface WorkspaceFileEntry {
  name: string;
  relativePath: string;
  absolutePath: string;
  kind: "file" | "directory";
  hidden: boolean;
  symbolicLink?: boolean;
}

export interface WorkspaceFilesListPayload {
  workspaceId: string;
  relativePath?: string;
}

export interface WorkspaceFilesListValue {
  workspaceId: string;
  relativePath: string;
  absolutePath: string;
  entries: WorkspaceFileEntry[];
  truncated: boolean;
}

export const WORKSPACE_FILE_SEARCH_QUERY_LENGTH_LIMIT = 512;
export const WORKSPACE_FILE_SEARCH_RESULT_LIMIT = 100;

export interface WorkspaceFilesSearchPayload {
  workspaceId: string;
  query: string;
  limit?: number;
}

export interface WorkspaceFilesSearchValue {
  workspaceId: string;
  query: string;
  entries: WorkspaceFileEntry[];
  truncated: boolean;
}

export interface WorkspaceFileReadPayload {
  workspaceId: string;
  relativePath: string;
}

export type WorkspaceFileDescribePayload = WorkspaceFileReadPayload;

/** Maximum file size that browser previewers may buffer in full. */
export const WORKSPACE_FILE_BUFFERED_PREVIEW_SIZE_LIMIT = 100 * 1024 * 1024;

export interface WorkspaceFileDescriptorValue {
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

export interface WorkspaceFileSnapshotValue {
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

export interface WorkspaceFileWritePayload extends WorkspaceFileReadPayload {
  content: string;
  expectedVersion: string;
}

export interface HostDescription {
  /** Stable product identity for native shells and protocol clients. */
  product?: "pi-workbench";
  version: string;
  piVersion: string;
  cwd: string;
  /** Managed npm package directory for user-scoped Pi packages. */
  userPackageDir?: string;
  provider?: string;
  model?: string;
  attachedSessions: number;
  canOpenPath: boolean;
}

export interface ModelReasoningEffort {
  id: string;
  name: string;
  description?: string;
}

export type ModelCapabilityState = "supported" | "unsupported" | "unknown";
export type ModelCapabilitySource = "provider-api" | "runtime" | "test" | "user";
export type ModelContextWindowSource = "provider" | "override" | "custom";
export type ModelThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type ModelThinkingLevelMap = Partial<Record<ModelThinkingLevel, string | null>>;

export interface ModelCatalogModel {
  id: string;
  name: string;
  description?: string;
  input?: Array<"text" | "image">;
  /** Normalized server-side capability result; never inferred from the model ID. */
  imageInput: ModelCapabilityState;
  imageInputSource?: ModelCapabilitySource;
  contextWindow?: number;
  maxTokens?: number;
  contextWindowSource?: ModelContextWindowSource;
  reasoning?: {
    efforts: ModelReasoningEffort[];
    defaultEffort?: string;
  };
}

export interface ModelProviderGroup {
  id: string;
  name: string;
  models: ModelCatalogModel[];
}

export interface ModelCatalogFailure {
  id: string;
  name: string;
  message: string;
}

export interface ConfigurableProviderView {
  provider: string;
  displayName: string;
  kind: "built-in" | "custom";
  settingsNs: string;
  settingsPath: string[];
  active: boolean;
  declared?: boolean;
  configured: boolean;
  authSource?:
    | "stored"
    | "runtime"
    | "environment"
    | "fallback"
    | "models_json_key"
    | "models_json_command";
  authType?: "api_key" | "oauth";
  authMethods?: ModelProviderAuthMethod[];
  apiKeyConfigurable: boolean;
  removable: boolean;
  configurationDefined: boolean;
}

export interface ModelProviderAuthMethod {
  type: "api_key" | "oauth";
  label: string;
  isSubscription?: boolean;
}

export interface StartModelProviderLoginPayload {
  provider: string;
  authType: "oauth";
}

export interface ModelProviderLoginPayload {
  loginId: string;
}

export interface RespondModelProviderLoginPayload extends ModelProviderLoginPayload {
  promptId: string;
  value: string;
}

export interface ModelProviderLoginPrompt {
  id: string;
  type: "text" | "secret" | "select" | "manual_code";
  message: string;
  placeholder?: string;
  options?: Array<{
    id: string;
    label: string;
    description?: string;
  }>;
}

export type ModelProviderLoginEvent =
  | {
      type: "info";
      message: string;
      links?: Array<{ url: string; label?: string }>;
    }
  | { type: "auth_url"; url: string; instructions?: string }
  | {
      type: "device_code";
      userCode: string;
      verificationUri: string;
      intervalSeconds?: number;
      expiresInSeconds?: number;
    }
  | { type: "progress"; message: string };

export interface ModelProviderLoginValue {
  loginId: string;
  provider: string;
  authType: "oauth";
  status: "running" | "complete" | "failed" | "cancelled";
  revision: number;
  events: ModelProviderLoginEvent[];
  prompt?: ModelProviderLoginPrompt;
}

export interface ModelProvidersValue {
  providers: ConfigurableProviderView[];
}

export interface ConfigureModelProviderPayload {
  provider: string;
  apiKey?: string;
  configuration?: ModelProviderConfiguration;
}

export interface ModelProviderModelConfiguration {
  id: string;
  name?: string;
  contextWindow?: number;
  /** Workbench-owned provenance; never serialized into a custom provider model. */
  contextWindowSource?: ModelContextWindowSource;
  maxTokens?: number;
  reasoning?: boolean;
  thinkingLevelMap?: ModelThinkingLevelMap;
  input?: Array<"text" | "image">;
  /** Workbench-owned provenance; not part of Pi's provider request configuration. */
  imageInputSource?: ModelCapabilitySource;
}

export interface ModelProviderConfiguration {
  displayName?: string;
  baseURL: string;
  api: string;
  models?: ModelProviderModelConfiguration[];
}

export interface ModelProviderConfigPayload {
  provider: string;
}

export interface ModelProviderConfigValue {
  provider: string;
  displayName: string;
  defaultBaseURL?: string;
  baseURL?: string;
  api?: string;
  configurationDefined: boolean;
  modelsSource: "adapter" | "custom";
  /** Provider-owned baseline used when discarding model catalog customizations. */
  adapterModels: ModelProviderModelConfiguration[];
  models: ModelProviderModelConfiguration[];
}

export interface ModelContextWindowPayload {
  provider: string;
  model: string;
}

export interface ModelContextWindowValue extends ModelContextWindowPayload {
  name: string;
  contextWindow: number;
  source: ModelContextWindowSource;
}

export interface UpdateModelContextWindowPayload extends ModelContextWindowPayload {
  contextWindow: number;
}

export interface RemoveModelProviderPayload {
  provider: string;
}

export interface ModelCatalogValue {
  groups: ModelProviderGroup[];
  failures: ModelCatalogFailure[];
}

export interface DiscoverModelsPayload {
  settingsNs: string;
  provider?: string;
  baseURL?: string;
  api?: string;
  apiKey?: string;
  /**
   * `provider` refreshes through Pi's provider-owned auth/catalog path;
   * `endpoint` explicitly bypasses self-declared runtime metadata.
   */
  source?: "catalog" | "provider" | "endpoint";
}

export type ModelDiscoveryFailureReason =
  | "authentication"
  | "endpoint-not-found"
  | "http-error"
  | "invalid-api-key"
  | "invalid-response"
  | "missing-api-address"
  | "network"
  | "provider-unavailable"
  | "rate-limited"
  | "runtime"
  | "unsupported-protocol";

export interface ModelDiscoveryFailureDetails {
  settingsNs: string;
  baseURL?: string;
  reason: ModelDiscoveryFailureReason;
  httpStatus?: number;
}

export interface DiscoveredModel {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  thinkingLevelMap?: ModelThinkingLevelMap;
  input?: Array<"text" | "image">;
  /** Capability reported by the provider API or Pi's runtime model catalog. */
  imageInput: ModelCapabilityState;
  imageInputSource?: ModelCapabilitySource;
}

export interface DiscoverModelsValue {
  models: DiscoveredModel[];
}

export interface TestModelImageInputPayload {
  provider: string;
  model: string;
}

export type ModelImageInputTestOutcome = "supported" | "unsupported" | "inconclusive";

export type ModelImageInputTestReason =
  | "verified"
  | "provider-rejected-image"
  | "model-not-found"
  | "runtime-unavailable"
  | "unexpected-response"
  | "authentication"
  | "quota-exceeded"
  | "rate-limited"
  | "timeout"
  | "network"
  | "provider-unavailable"
  | "protocol-mismatch"
  | "model-unavailable"
  | "invalid-image"
  | "safety"
  | "provider-error"
  | "request-failed";

export interface TestModelImageInputValue {
  outcome: ModelImageInputTestOutcome;
  reason: ModelImageInputTestReason;
}

export const PI_AGENT_SETTINGS_NAMESPACE = "pi.agent" as const;

export interface PiCompactionSettingsValue {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
}

export interface PiAgentSettingsValue {
  /** Empty means Pi builds and uses its bundled default system prompt. */
  systemPrompt: string;
  compaction: PiCompactionSettingsValue;
}

export interface PiAgentSettingsUserValue {
  systemPrompt?: string;
  compaction?: Partial<PiCompactionSettingsValue>;
}

export interface SettingsSecretView {
  path: string[];
  set: boolean;
}

export interface SettingsNamespaceView<Value = unknown, UserValue = unknown, Schema = unknown> {
  ns: string;
  schema: Schema;
  value: Value;
  base?: Value;
  user?: UserValue;
  applies: "live" | "restart";
  secrets: SettingsSecretView[];
  revision: number;
}

export type PiAgentSettingsNamespaceView = SettingsNamespaceView<
  PiAgentSettingsValue,
  PiAgentSettingsUserValue,
  Record<string, unknown>
> & { ns: typeof PI_AGENT_SETTINGS_NAMESPACE };

export interface SettingsDescribeValue {
  writable: boolean;
  hasDocument: boolean;
  namespaces: PiAgentSettingsNamespaceView[];
}

export interface SettingsOpenDocumentValue {
  opened: true;
}

export interface WorkbenchSettingsDescribeValue {
  revision: number;
  preferences: WorkbenchSettingsPreferences;
}

export interface WorkbenchSettingsUpdatePayload {
  patch: WorkbenchSettingsPreferencesPatch;
}

export interface WorkbenchSettingsUpdateValue {
  revision: number;
}

export type ImageUnderstandingRouting = "auto" | "always-preprocess" | "native-only" | "disabled";
export type ImageUnderstandingEngine = "ocr" | "multimodal";
export type ImageUnderstandingOcrProvider = "glm-ocr" | "paddleocr";

export interface ImageUnderstandingOcrAdapterSettingsValue {
  /** A built-in template identifier, or `custom` after the source is edited. */
  preset: OcrAdapterPresetId;
  /** Declarative TypeScript. The server parses this as data and never evaluates JavaScript. */
  source: string;
  endpoint: string;
  model: string;
  credentialConfigured: boolean;
  pollIntervalMs: number;
  pollTimeoutMs: number;
}

export interface ImageUnderstandingSettingsValue {
  routing: ImageUnderstandingRouting;
  engine: ImageUnderstandingEngine;
  ocrProvider: ImageUnderstandingOcrProvider;
  glm: {
    endpoint: string;
    model: string;
    credentialConfigured: boolean;
  };
  paddle: {
    endpoint: string;
    model: string;
    credentialConfigured: boolean;
    pollIntervalMs: number;
    pollTimeoutMs: number;
  };
  ocrAdapter: ImageUnderstandingOcrAdapterSettingsValue;
  multimodal: {
    provider: string;
    model: string;
  };
}

export interface ImageUnderstandingDescribeValue {
  revision: number;
  value: ImageUnderstandingSettingsValue;
}

export interface ImageUnderstandingSettingsPatch {
  routing?: ImageUnderstandingRouting;
  engine?: ImageUnderstandingEngine;
  ocrProvider?: ImageUnderstandingOcrProvider;
  glm?: {
    endpoint?: string;
    model?: string;
    /** Omit or use an empty string to retain the current secret; null removes it. */
    apiKey?: string | null;
  };
  paddle?: {
    endpoint?: string;
    model?: string;
    /** Omit or use an empty string to retain the current secret; null removes it. */
    apiKey?: string | null;
    pollIntervalMs?: number;
    pollTimeoutMs?: number;
  };
  ocrAdapter?: {
    preset?: OcrAdapterPresetId;
    source?: string;
    endpoint?: string;
    model?: string;
    /** Omit or use an empty string to retain the active adapter credential; null removes it. */
    apiKey?: string | null;
    pollIntervalMs?: number;
    pollTimeoutMs?: number;
  };
  multimodal?: {
    provider?: string;
    model?: string;
  };
}

export interface ImageUnderstandingUpdatePayload {
  patch: ImageUnderstandingSettingsPatch;
  expectedRevision?: number;
}

/** Canonical attachment-neutral settings names; the wire endpoint remains stable. */
export type AttachmentUnderstandingRouting = ImageUnderstandingRouting;
export type AttachmentUnderstandingEngine = ImageUnderstandingEngine;
export type AttachmentUnderstandingOcrProvider = ImageUnderstandingOcrProvider;
export type AttachmentUnderstandingSettingsValue = ImageUnderstandingSettingsValue;
export type AttachmentUnderstandingDescribeValue = ImageUnderstandingDescribeValue;
export type AttachmentUnderstandingSettingsPatch = ImageUnderstandingSettingsPatch;
export type AttachmentUnderstandingUpdatePayload = ImageUnderstandingUpdatePayload;

export interface PiAgentSettingsPatch {
  systemPrompt?: string;
  compaction?: Partial<PiCompactionSettingsValue>;
}

export interface PiAgentSettingsUpdatePayload {
  ns: typeof PI_AGENT_SETTINGS_NAMESPACE;
  patch: PiAgentSettingsPatch;
  expectedRevision?: number;
}

export type PiResourceCatalogTarget = { scope: "user" } | { scope: "project"; workspaceId: string };

/**
 * Session-backed callers keep the legacy shape, while application-level resource catalogs use a
 * scope target and never need to know about a Pi conversation.
 */
export type PiResourceRequest =
  | { sessionId: string; target?: never }
  | { target: PiResourceCatalogTarget; sessionId?: never };

export type SkillListPayload = PiResourceRequest;

export interface SkillView {
  name: string;
  description: string;
  whenToUse?: string;
  enabled: boolean;
  modelInvocable: boolean;
  source: string;
  scope: ExtensionSourceScope;
  origin: ExtensionSourceOrigin;
}

export interface SkillListValue {
  skills: SkillView[];
}

export type SkillDescribePayload = PiResourceRequest & { name: string };

export interface SkillDescribeValue {
  name: string;
  content: string;
  filePath: string;
}

export type SkillSetEnabledPayload = SkillDescribePayload & { enabled: boolean };

export interface SkillSetEnabledValue {
  name: string;
  enabled: boolean;
}

export type SkillRemovePayload = SkillDescribePayload;

export interface SkillRemoveValue {
  name: string;
  removed: true;
}

export type SkillFilesListPayload = SkillDescribePayload & { relativePath?: string };

export interface SkillFileEntry {
  name: string;
  relativePath: string;
  kind: "file" | "directory";
  hidden: boolean;
  symbolicLink?: boolean;
}

export interface SkillFilesListValue {
  name: string;
  rootPath: string;
  relativePath: string;
  entries: SkillFileEntry[];
  truncated: boolean;
}

export type SkillFileReadPayload = SkillDescribePayload & { relativePath: string };

export interface SkillFileSnapshotValue {
  skillName: string;
  rootPath: string;
  relativePath: string;
  absolutePath: string;
  name: string;
  content: string;
  mediaType: string;
  encoding: "utf-8";
  version: string;
  size: number;
  modifiedAt: number;
}

export type ExtensionListPayload = PiResourceRequest;

export type ExtensionSourceScope = "user" | "project" | "temporary";

export type ExtensionSourceOrigin = "package" | "top-level";

export interface ExtensionRegisteredEventView {
  name: string;
  handlerCount: number;
}

export interface ExtensionRegisteredToolView {
  name: string;
  label: string;
  description?: string;
  parameterSchemaJson?: string;
}

export interface ExtensionRegisteredCommandView {
  name: string;
  description?: string;
  hasArgumentCompletions: boolean;
}

export interface ExtensionView {
  name: string;
  filePath: string;
  source: string;
  scope: ExtensionSourceScope;
  origin: ExtensionSourceOrigin;
  enabled: boolean;
  eventNames: string[];
  toolNames: string[];
  commandNames: string[];
  eventDetails: ExtensionRegisteredEventView[];
  toolDetails: ExtensionRegisteredToolView[];
  commandDetails: ExtensionRegisteredCommandView[];
}

export interface ExtensionListValue {
  extensions: ExtensionView[];
  loadErrorCount: number;
}

export type ExtensionIdentityPayload = PiResourceRequest & {
  name: string;
  filePath: string;
  source: string;
  scope: ExtensionSourceScope;
  origin: ExtensionSourceOrigin;
};

export type ExtensionSetEnabledPayload = ExtensionIdentityPayload & { enabled: boolean };

export interface ExtensionSetEnabledValue {
  name: string;
  filePath: string;
  enabled: boolean;
}

export type ExtensionRemovePayload = ExtensionIdentityPayload;

export interface ExtensionRemoveValue {
  name: string;
  filePath: string;
  removed: true;
}

export type ExtensionFilesListPayload = ExtensionIdentityPayload & { relativePath?: string };

export interface ExtensionFileEntry {
  name: string;
  relativePath: string;
  kind: "file" | "directory";
  hidden: boolean;
  symbolicLink?: boolean;
}

export interface ExtensionFilesListValue {
  extensionName: string;
  rootPath: string;
  relativePath: string;
  entries: ExtensionFileEntry[];
  truncated: boolean;
}

export type ExtensionFileReadPayload = ExtensionIdentityPayload & { relativePath?: string };

export interface ExtensionFileSnapshotValue {
  extensionName: string;
  rootPath: string;
  relativePath: string;
  absolutePath: string;
  name: string;
  content: string;
  mediaType: string;
  encoding: "utf-8";
  version: string;
  size: number;
  modifiedAt: number;
}

export type InstalledPackageListPayload = PiResourceRequest;

export interface InstalledPackageView {
  source: string;
  scope: "user" | "project";
  filtered: boolean;
}

export interface InstalledPackageListValue {
  packages: InstalledPackageView[];
}

export interface InstalledPackageDescribePayload {
  source: string;
  target: PiResourceCatalogTarget;
}

/**
 * Safe metadata read from the package.json in the package's actual installed directory.
 * Catalog-only values such as publish time, downloads, and registry package size are
 * intentionally absent so installed details cannot silently drift to the latest release.
 */
export interface InstalledPackageDetailsView {
  source: string;
  scope: "user" | "project";
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  license?: string;
  types: PiPackageResourceType[];
  dependencyCount: number;
  peerDependencyCount: number;
  manifestJson?: string;
}

export type PiPackageUpdatesPayload = InstalledPackageListPayload;

export interface PiPackageUpdateView extends InstalledPackageView {
  displayName: string;
  type: "npm" | "git";
  currentVersion?: string;
  targetVersion?: string;
  currentRevision?: string;
  targetRevision?: string;
}

export interface PiPackageUpdatesValue {
  updates: PiPackageUpdateView[];
}

export type PiPackageMutationTarget =
  | { scope: "user"; sessionId?: string }
  | { scope: "project"; workspaceId: string };

export type PiPackageInstallTarget = PiPackageMutationTarget;

export type PiPackageMutationValue =
  | {
      source: string;
      scope: "user";
      reloadRequired: false;
    }
  | {
      source: string;
      scope: "project";
      workspaceId: string;
      reloadRequired: false;
    };

export interface PiPackageInstallPayload {
  name: string;
  target: PiPackageInstallTarget;
}

export type PiPackageInstallValue = PiPackageMutationValue;

export interface PiPackageUpdatePayload {
  source: string;
  target: PiPackageMutationTarget;
}

export type PiPackageUpdateValue = PiPackageMutationValue;

export interface PiPackageRemovePayload {
  source: string;
  target: PiPackageMutationTarget;
}

export type PiPackageRemoveValue = PiPackageMutationValue;

export type PiPackageResourceType = "extension" | "skill" | "prompt" | "theme" | "package";

export type PiPackageCatalogFilterType = Exclude<PiPackageResourceType, "package">;

export type PiPackageCatalogSort = "downloads" | "recent" | "name";

export interface PiPackageCatalogSearchPayload {
  query?: string;
  type?: PiPackageCatalogFilterType;
  sort?: PiPackageCatalogSort;
  page?: number;
}

export interface PiPackageCatalogItemView {
  name: string;
  description: string;
  author: string;
  types: PiPackageResourceType[];
  monthlyDownloads: number;
  publishedAt: number;
  catalogUrl: string;
  npmUrl: string;
  repositoryUrl?: string;
  version?: string;
  installCommand: string;
}

export interface PiPackageCatalogDescribePayload {
  name: string;
}

export interface PiPackageCatalogDetailsView {
  name: string;
  version?: string;
  publishedAt?: number;
  monthlyDownloads?: number;
  weeklyDownloads?: number;
  author?: string;
  license?: string;
  types: PiPackageResourceType[];
  packageSizeBytes?: number;
  dependencyCount?: number;
  peerDependencyCount?: number;
  manifestJson?: string;
}

export interface PiPackageCatalogSearchValue {
  sourceUrl: string;
  page: number;
  pageSize: number;
  pageCount: number;
  filteredTotal: number;
  total: number;
  packages: PiPackageCatalogItemView[];
}

/**
 * Existing conversations expose their complete runtime command catalog through a session. Draft
 * conversations use a resource target so Composer can discover session-independent commands
 * without creating an empty chat record.
 */
export type CommandListPayload = PiResourceRequest;

interface CommandViewBase {
  name: string;
  /** Name accepted by the corresponding Pi command entry point. */
  invocationName: string;
  effect: WorkbenchComposerCommandEffect;
  exclusive: boolean;
  description?: string;
  argumentHint?: string;
  argsSchema?: WorkbenchComposerCommandArgsSchema;
  argsBinding?: WorkbenchComposerCommandArgsBinding;
}

export interface BuiltinCommandView extends CommandViewBase {
  kind: "builtin";
}

export interface ExtensionCommandView extends CommandViewBase {
  kind: "extension";
  /** Name originally registered by the extension; invocationName is collision-safe. */
  name: string;
  source: string;
  scope: ExtensionSourceScope;
  origin: ExtensionSourceOrigin;
}

export interface PromptCommandView extends CommandViewBase {
  kind: "prompt";
  source: string;
  scope: ExtensionSourceScope;
  origin: ExtensionSourceOrigin;
}

export interface SkillCommandView extends CommandViewBase {
  kind: "skill";
  modelInvocable: boolean;
  source: string;
  scope: ExtensionSourceScope;
  origin: ExtensionSourceOrigin;
}

export type CommandView =
  | BuiltinCommandView
  | ExtensionCommandView
  | PromptCommandView
  | SkillCommandView;

export interface CommandListValue {
  commands: CommandView[];
}

export interface PromptListPayload {
  target: PiResourceCatalogTarget;
}

export interface PromptListValue {
  prompts: PromptCommandView[];
}

export interface SessionProjections {
  asOfSeq: number;
  values: Record<string, unknown>;
}

export interface SessionListItem {
  sessionId: string;
  updatedAt: number;
  running: boolean;
  waitingForUserInput?: boolean;
  runTiming?: PiRunTiming;
  blank: boolean;
  cwd?: string;
  agentPreset?: string;
  projections?: SessionProjections;
  parentSessionId?: string;
  origin?: "subagent";
}

export interface SessionListPayload {
  cursor?: string;
}

export interface SessionListValue {
  items: SessionListItem[];
  /** Includes hidden scratch sessions so bound Runtimes can recover after a stream reconnect. */
  runningSessionIds?: string[];
}

export const EXTERNAL_SESSION_SOURCES = ["codex", "claude-code", "cursor"] as const;

export type ExternalSessionSource = (typeof EXTERNAL_SESSION_SOURCES)[number];

export type ExternalSessionImportIssue =
  | "source-unavailable"
  | "source-unreadable"
  | "workspace-missing"
  | "workspace-not-directory"
  | "conversation-empty"
  | "conversation-unsupported";

export interface ExternalSessionImportView {
  source: ExternalSessionSource;
  sourceSessionId: string;
  title: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  messageCount?: number;
  subagent?: boolean;
  importable: boolean;
  alreadyImported: boolean;
  issue?: ExternalSessionImportIssue;
}

export interface ExternalSessionImportScanValue {
  sources: Array<{
    source: ExternalSessionSource;
    status: "ready" | "not-found" | "error";
    sessions: ExternalSessionImportView[];
  }>;
}

export interface ExternalSessionImportPayload {
  sessions: Array<{
    source: ExternalSessionSource;
    sourceSessionId: string;
  }>;
}

export type ExternalSessionImportSkipReason =
  | ExternalSessionImportIssue
  | "already-imported"
  | "source-session-not-found"
  | "import-failed";

export interface ExternalSessionImportValue {
  imported: Array<{
    source: ExternalSessionSource;
    sourceSessionId: string;
    sessionId: string;
    workspaceId: string;
  }>;
  skipped: Array<{
    source: ExternalSessionSource;
    sourceSessionId: string;
    reason: ExternalSessionImportSkipReason;
  }>;
}

export interface SessionSearchPayload {
  query: string;
}

export interface SessionSearchValue {
  items: Array<{ sessionId: string; snippet: string }>;
  hasMore: boolean;
}

export interface SessionCreatePayload {
  workspaceId?: string;
  cwd?: string;
  sessionId?: string;
  agentPreset?: string;
}

export interface SessionCreateValue {
  sessionId: string;
  agentPreset?: string;
}

export interface SessionEvent {
  type: string;
  seq: number;
  time: number;
  data: unknown;
  /** Stable Pi journal entry id. Unlike `seq`, this remains unique across branches. */
  entryId?: string;
  sourceEventSeqs?: number[];
  surfaceOp?: unknown;
  ignorable?: true;
}

export interface ToolEventView {
  for: "call" | "result";
  view: { card: string; [key: string]: unknown };
}

export interface SessionHistoryPayload {
  sessionId: string;
  beforeSeq?: number;
  maxMessages?: number;
}

export interface SessionHistoryValue {
  events: Array<{ event: SessionEvent; view?: ToolEventView }>;
  hasMore: boolean;
  projections?: SessionProjections;
  branches?: SessionHistoryBranches;
  resume?: SessionResumeState;
}

/** JSON-safe value captured by the transient context observer. */
export type SessionContextTraceJsonValue =
  | null
  | boolean
  | number
  | string
  | SessionContextTraceJsonValue[]
  | { [key: string]: SessionContextTraceJsonValue };

export interface SessionContextTraceCaptureMetadata {
  originalBytes: number;
  capturedBytes: number;
  /** Legacy journals may be true; new trace captures preserve the complete serializable value. */
  truncated: boolean;
  /** Legacy journals may contain paths redacted by older Workbench versions. */
  redactedPaths: string[];
}

export interface SessionContextTraceJsonCapture {
  value: SessionContextTraceJsonValue;
  capture: SessionContextTraceCaptureMetadata;
}

export interface SessionContextTraceTextCapture extends SessionContextTraceCaptureMetadata {
  text: string;
  originalCharacters: number;
}

export interface SessionContextTraceModel {
  provider: string;
  model: string;
  api?: string;
  contextWindow?: number;
  maxTokens?: number;
}

/** Provider-normalized token usage from Pi's finalized assistant message. */
export interface SessionContextTraceTokenUsage {
  /** Non-cached prompt tokens. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Subset of cacheWrite retained for one hour, when reported by the provider. */
  cacheWrite1h?: number;
  /** Subset of output used for reasoning, when reported by the provider. */
  reasoning?: number;
  totalTokens: number;
}

/** Estimated model-context occupancy at the point Pi builds a model call. */
export interface SessionContextTraceContextUsage {
  tokens: number | null;
  contextWindow: number;
  /** Percentage in the 0-100 range, or null when Pi cannot estimate current tokens. */
  percent: number | null;
}

/** Per-message estimates aligned by source index with a captured context message array. */
export interface SessionContextTraceMessageTokenEstimates {
  method: "pi-estimate-tokens-v1";
  tokens: Array<number | null>;
}

export interface SessionContextTraceCompactionPreparation {
  firstKeptEntryId: string;
  tokensBefore: number;
  summarizedMessageCount: number;
  turnPrefixMessageCount: number;
  branchEntryCount: number;
  isSplitTurn: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
  previousSummary?: SessionContextTraceTextCapture;
  customInstructions?: SessionContextTraceTextCapture;
  messagesToSummarize: SessionContextTraceJsonCapture;
  turnPrefixMessages: SessionContextTraceJsonCapture;
  fileOperations: SessionContextTraceJsonCapture;
}

export interface SessionContextTraceCompactionResult {
  summary: SessionContextTraceTextCapture;
  firstKeptEntryId: string;
  tokensBefore: number;
  estimatedTokensAfter?: number;
  usage?: SessionContextTraceTokenUsage;
  details?: SessionContextTraceJsonCapture;
  compactionEntryId?: string;
  fromExtension?: boolean;
}

/** Bounded projection copied onto list summaries so the trace tree needs no detail N+1. */
export interface SessionContextTraceCompactionSummary {
  phase: "start" | "end";
  reason: "manual" | "threshold" | "overflow";
  tokensBefore?: number;
  estimatedTokensAfter?: number;
  summarizedMessageCount?: number;
  turnPrefixMessageCount?: number;
  firstKeptEntryId?: string;
  aborted?: boolean;
  willRetry?: boolean;
}

export interface SessionContextTraceResourceSource {
  path: string;
  source: string;
  scope: "user" | "project" | "temporary";
  origin: "package" | "top-level";
  baseDir?: string;
}

export interface SessionContextTraceTool {
  name: string;
  description: string;
  active: boolean;
  source: SessionContextTraceResourceSource;
  parameters: SessionContextTraceJsonCapture;
  promptGuidelines?: string[];
}

export interface SessionContextTraceSkill {
  name: string;
  description?: string;
  filePath?: string;
  disableModelInvocation?: boolean;
}

export interface SessionContextTraceExtension {
  /** Stable display name derived from Pi's loaded extension path. */
  name: string;
  path: string;
  resolvedPath: string;
  hidden: boolean;
  source: SessionContextTraceResourceSource;
}

/** Serializable identity of one System Prompt layer, without copying its content into a Part. */
export interface SessionContextTraceSystemPromptSourceSummary {
  kind: "builtin" | "replacement" | "append" | "extension";
  scope: "builtin" | "user" | "project" | "temporary";
  path?: string;
  /** Pi lifecycle hook that produced this prompt layer. Present for extension mutations. */
  hook?: "before_agent_start";
  /** Zero-based registration order when one extension registered the hook more than once. */
  handlerIndex?: number;
}

/** Bounded, non-payload projection copied onto prompt-composition summaries and message Parts. */
export interface SessionContextTracePromptResources {
  systemPromptCharacters: number;
  systemPromptSourceCount: number;
  systemPromptSources: SessionContextTraceSystemPromptSourceSummary[];
  contextFileCount: number;
  contextFiles: string[];
  skills: Array<{
    name: string;
    disableModelInvocation: boolean;
  }>;
  extensions: Array<{
    name: string;
    hidden: boolean;
  }>;
  tools: {
    active: string[];
    total: number;
  };
}

export interface SessionContextTraceContextFile {
  path: string;
  content: SessionContextTraceTextCapture;
}

/** One Pi system-prompt layer, kept separate from Skills and other injected context. */
export interface SessionContextTraceSystemPromptSource extends SessionContextTraceSystemPromptSourceSummary {
  content?: SessionContextTraceTextCapture;
}

export interface SessionContextTraceSystemPromptOptions {
  cwd: string;
  customPrompt?: SessionContextTraceTextCapture;
  appendSystemPrompt?: SessionContextTraceTextCapture;
  selectedTools?: string[];
  toolSnippets?: Record<string, string>;
  promptGuidelines?: string[];
  contextFiles: SessionContextTraceContextFile[];
  skills: SessionContextTraceSkill[];
}

export type SessionContextTraceKind =
  | "round-start"
  | "prompt-composition"
  | "run-start"
  | "turn-start"
  | "context-snapshot"
  | "provider-request"
  | "provider-response"
  | "model-output"
  | "tool-execution-start"
  | "tool-execution-end"
  | "turn-end"
  | "run-end"
  | "retry"
  | "compaction"
  | "round-settled";

/** Correlation coordinates for a context trace event. Missing levels have not started yet. */
export interface SessionContextTraceCoordinates {
  roundId?: string;
  runId?: string;
  runIndex?: number;
  turnId?: string;
  /** Pi's zero-based turn index, reset for every agent run. */
  turnIndex?: number;
  requestId?: string;
  requestIndex?: number;
  toolCallId?: string;
  toolName?: string;
  /** One-based automatic agent retry number when applicable. */
  agentAttempt?: number;
}

export interface SessionContextTraceEventSummary extends SessionContextTraceCoordinates {
  schemaVersion: 1;
  traceId: string;
  sessionId: string;
  activationId: string;
  /** Monotonic only within activationId. */
  seq: number;
  time: number;
  kind: SessionContextTraceKind;
  detailBytes: number;
  truncated: boolean;
  redacted: boolean;
  /** Present on completed model turns so list/live consumers need not load the full detail. */
  usage?: SessionContextTraceTokenUsage;
  /** Present on finalized model output summaries. */
  model?: SessionContextTraceModel;
  thinkingLevel?: string;
  /** Pi assistant-message timestamp used only to correlate durable trace summaries with history. */
  messageTimestamp?: number;
  /** Bounded user-prompt excerpt present only on prompt-composition summaries. */
  promptPreview?: string;
  /** Final resource inventory used to compose this prompt, without prompt/tool payload bodies. */
  promptResources?: SessionContextTracePromptResources;
  /** Present on prompt composition and per-call context snapshots when Pi can estimate it. */
  contextUsage?: SessionContextTraceContextUsage;
  /** This context snapshot contains call-scoped instructions and tool metadata. */
  callContextCaptured?: true;
  /** Present on compaction events so list consumers can render the before/after transition. */
  compaction?: SessionContextTraceCompactionSummary;
}

export type SessionContextTraceDetail =
  | {
      type: "round-start";
      trigger: "prompt" | "continuation" | "unknown";
    }
  | {
      type: "prompt-composition";
      prompt: SessionContextTraceTextCapture;
      /** The exact effective prompt observed after every extension mutation. */
      systemPrompt: SessionContextTraceTextCapture;
      /** UI projection of systemPrompt with Pi's formatted Skills block removed. */
      systemPromptWithoutSkills?: SessionContextTraceTextCapture;
      /** Pi ResourceLoader precedence and append layers used for this prompt. */
      systemPromptSources?: SessionContextTraceSystemPromptSource[];
      systemPromptOptions: SessionContextTraceSystemPromptOptions;
      images: SessionContextTraceJsonCapture;
      model?: SessionContextTraceModel;
      thinkingLevel?: string;
      contextUsage?: SessionContextTraceContextUsage;
      tools: SessionContextTraceTool[];
      /** Final Pi extension inventory at the same observation boundary. */
      extensions?: SessionContextTraceExtension[];
    }
  | { type: "run-start" }
  | { type: "turn-start"; timestamp?: number }
  | {
      type: "context-snapshot";
      messageCount: number;
      messages: SessionContextTraceJsonCapture;
      contextUsage?: SessionContextTraceContextUsage;
      messageTokenEstimates?: SessionContextTraceMessageTokenEstimates;
      /** Effective call-scoped prompt state observed immediately before this model request. */
      systemPrompt?: SessionContextTraceTextCapture;
      systemPromptWithoutSkills?: SessionContextTraceTextCapture;
      systemPromptSources?: SessionContextTraceSystemPromptSource[];
      systemPromptOptions?: SessionContextTraceSystemPromptOptions;
      tools?: SessionContextTraceTool[];
      extensions?: SessionContextTraceExtension[];
      model?: SessionContextTraceModel;
      thinkingLevel?: string;
    }
  | {
      type: "provider-request";
      payload: SessionContextTraceJsonCapture;
      /** Pi currently exposes one hook per logical request, not one hook per HTTP retry. */
      transportAttemptsObserved: false;
    }
  | {
      type: "provider-response";
      status: number;
      /** Complete response headers exposed by the Pi lifecycle event. */
      headers: Record<string, string>;
    }
  | {
      type: "model-output";
      message: SessionContextTraceJsonCapture;
      usage: SessionContextTraceTokenUsage;
      model?: SessionContextTraceModel;
      thinkingLevel?: string;
    }
  | {
      type: "tool-execution-start";
      toolCallId: string;
      toolName: string;
      args: SessionContextTraceJsonCapture;
    }
  | {
      type: "tool-execution-end";
      toolCallId: string;
      toolName: string;
      result: SessionContextTraceJsonCapture;
      isError: boolean;
    }
  | {
      type: "turn-end";
      message: SessionContextTraceJsonCapture;
      toolResultCount: number;
      toolResults: SessionContextTraceJsonCapture;
      usage?: SessionContextTraceTokenUsage;
    }
  | { type: "run-end"; messageCount: number; willRetry: boolean }
  | {
      type: "retry";
      phase:
        | "scheduled"
        | "finished"
        | "summarization-scheduled"
        | "summarization-attempt"
        | "summarization-finished";
      attempt?: number;
      maxAttempts?: number;
      delayMs?: number;
      success?: boolean;
      source?: "agent" | "compaction" | "branch-summary";
      error?: SessionContextTraceTextCapture;
    }
  | {
      type: "compaction";
      phase: "start" | "end";
      reason: "manual" | "threshold" | "overflow";
      aborted?: boolean;
      willRetry?: boolean;
      preparation?: SessionContextTraceCompactionPreparation;
      result?: SessionContextTraceCompactionResult;
      error?: SessionContextTraceTextCapture;
    }
  | { type: "round-settled" };

/** A detail record whose `kind` and `detail.type` discriminants always agree. */
export type SessionContextTraceEvent = {
  [Kind in SessionContextTraceKind]: Omit<SessionContextTraceEventSummary, "kind"> & {
    kind: Kind;
    detail: Extract<SessionContextTraceDetail, { type: Kind }>;
  };
}[SessionContextTraceKind];

export interface SessionContextTraceCapabilities {
  schemaVersion: 1;
  storage: "persistent-journal" | "bounded-memory";
  durable: boolean;
  scope: "agent-turn";
  captures: readonly [
    "system-prompt",
    "resource-sources",
    "tools",
    "messages",
    "provider-payload",
    "model-output",
    "tool-execution",
    "token-usage",
    "lifecycle",
  ];
  providerTransportAttempts: "logical-request-only";
  sensitiveValues: "captured";
  maxEvents: number;
  maxBytes: number;
  persistence?: {
    format: "hash-chained-jsonl";
    maxActivations: number;
    maxBytesPerSession: number;
  };
}

export interface SessionContextTraceActivationSummary {
  schemaVersion: 1;
  sessionId: string;
  activationId: string;
  startedAt: number;
  updatedAt: number;
  eventCount: number;
  persistedBytes: number;
  active: boolean;
  complete: boolean;
}

export interface SessionContextTraceActivationsPayload {
  sessionId: string;
}

export interface SessionContextTraceActivationsValue {
  activations: SessionContextTraceActivationSummary[];
  currentActivationId?: string;
  capabilities: SessionContextTraceCapabilities;
}

export interface SessionContextTraceListPayload {
  sessionId: string;
  /** Omit to read the current activation; durable traces may replay a page from journal. */
  activationId?: string;
  /** Exclusive sequence cursor within the current activation. */
  afterSeq?: number;
  limit?: number;
}

export interface SessionContextTraceListValue {
  activationId: string;
  events: SessionContextTraceEventSummary[];
  /** True when another page exists after the final returned event. */
  hasMore: boolean;
  /** Exclusive high watermark for the activation, not the cursor of a limited page. */
  nextSeq: number;
  /** Oldest retained sequence, or nextSeq when the trace is empty. */
  retainedFromSeq: number;
  capabilities: SessionContextTraceCapabilities;
  source: "memory" | "disk";
  integrity: "memory" | "verified";
}

export interface SessionContextTraceReadPayload {
  sessionId: string;
  traceId: string;
}

export interface SessionContextTraceReadValue {
  event: SessionContextTraceEvent;
}

/** Durable prompt-composition summary projected onto its owning Pi assistant message. */
export interface SessionContextTracePromptPart {
  event: SessionContextTraceEventSummary;
  assistantMessageTimestamp?: number;
}

export interface SessionContextTracePromptPartsPayload {
  sessionId: string;
}

export interface SessionContextTracePromptPartsValue {
  parts: SessionContextTracePromptPart[];
  capabilities: SessionContextTraceCapabilities;
  source: "memory" | "disk";
  integrity: "memory" | "verified";
}

export interface SessionHistoryBranch {
  /** Pi leaf that can be selected to make this branch active. */
  leafId: string;
  events: Array<{ event: SessionEvent; view?: ToolEventView }>;
}

export interface SessionHistoryBranches {
  headLeafId: string | null;
  items: SessionHistoryBranch[];
}

export interface SessionRegeneratePayload {
  sessionId: string;
  /** Stable journal entry id of the user message to regenerate from. */
  messageId: string;
  /** Fresh correlation id used when retrying attachment preprocessing from a Composer marker. */
  requestId?: string;
}

export interface SessionRegenerateValue {
  accepted: true;
}

export type SessionResumeReason =
  | "user-cancelled"
  | "process-interrupted"
  | "rate-limited"
  | "quota-exhausted"
  | "authentication-required"
  | "network-error"
  | "provider-error";

export type SessionResumeCapability = "ready" | "blocked" | "confirmation-required";

export interface SessionResumeCheckpoint {
  /** Durable Pi custom-entry id for this recovery point. */
  checkpointId: string;
  /** Canonical message event id used by assistant-ui as the stopped message id. */
  terminalMessageId: string;
  /** Current branch leaf. Clients echo it to prevent resuming a stale branch. */
  branchLeafId: string;
  sourceEventSeq: number;
  reason: SessionResumeReason;
  capability: SessionResumeCapability;
  blockedBy?: "model" | "ambiguous-tools";
  createdAt: number;
  model?: { provider: string; model: string };
  ambiguousTools?: Array<{ toolCallId: string; toolName?: string }>;
}

export interface SessionResumeState {
  checkpoint?: SessionResumeCheckpoint;
}

export interface SessionResumePayload {
  sessionId: string;
  checkpointId: string;
  expectedLeafId: string;
}

export interface SessionResumeValue {
  accepted: true;
}

export interface SessionSelectBranchPayload {
  sessionId: string;
  leafId: string;
}

export interface SessionSelectBranchValue {
  selected: true;
}

export interface SessionModelsPayload {
  sessionId: string;
}

export interface SessionModelsValue {
  current: ModelSelection;
  routable: boolean;
  groups: ModelProviderGroup[];
  failures: ModelCatalogFailure[];
}

export interface SessionContextPolicyCompaction {
  enabled?: boolean;
  reserveTokens?: number;
  keepRecentTokens?: number;
}

export interface SessionContextPolicy {
  mode: "inherit" | "auto" | "maximum" | "custom";
  desiredContextTokens?: number;
  compaction?: SessionContextPolicyCompaction;
}

export interface SessionContextPolicyPayload {
  sessionId: string;
}

export interface SessionContextPolicyUpdatePayload extends SessionContextPolicyPayload {
  policy: SessionContextPolicy;
}

export type SessionContextBreakdownCategory =
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

export interface SessionContextBreakdownItem {
  category: SessionContextBreakdownCategory;
  tokens: number;
  count: number;
}

export interface SessionContextBreakdown {
  /** All item token counts are estimates; provider-reconciled values sum to current usage. */
  basis: "provider-reconciled" | "heuristic";
  totalTokens: number;
  items: SessionContextBreakdownItem[];
}

export interface SessionContextPolicyValue {
  policy: SessionContextPolicy;
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
  breakdown?: SessionContextBreakdown;
  nearingCompaction: boolean;
}

export interface SessionCompactValue {
  compacted: true;
  context: SessionContextPolicyValue;
}

export interface SessionSelectModelPayload {
  sessionId: string;
  provider: string;
  model: string;
  reasoningEffort?: string;
}

export interface SessionSelectModelValue {
  selected: ModelSelection;
}

export interface SessionRenamePayload {
  sessionId: string;
  title: string;
}

export interface SessionRenameValue {
  title: string;
  seq: number;
}

export interface SessionDeletePayload {
  sessionId: string;
}

export interface SessionDeleteValue {
  deleted: true;
}

export interface SessionForkPayload {
  sessionId: string;
  atSeq?: number;
}

export interface SessionForkValue {
  sessionId: string;
}

export interface SessionScratchCreatePayload {
  sourceSessionId: string;
  atSeq?: number;
}

export interface SessionScratchCreateValue {
  sessionId: string;
  sourceSessionId: string;
  expiresAt: number;
}

export interface SessionScratchReleasePayload {
  sessionId: string;
}

export interface SessionScratchReleaseValue {
  released: true;
}

export interface SessionScratchPromotePayload {
  sessionId: string;
  title?: string;
}

export interface SessionScratchPromoteValue {
  sessionId: string;
  sourceSessionId: string;
}

export type SessionPromptContent =
  | { type: "text"; text: string }
  | {
      type: "image";
      mediaType: InlineImageMediaType;
      data: string;
      name?: string;
    }
  | {
      type: "file";
      mediaType: InlineDocumentMediaType;
      data: string;
      name?: string;
    };

export interface SessionPromptPayload {
  sessionId: string;
  mode: "queue" | "steer";
  content: SessionPromptContent[];
  clientTimeZone?: string;
  composer?: WorkbenchComposerSubmission;
}

export interface SessionPromptValue {
  accepted: true;
  queued: boolean;
  queueItemId?: string;
  command?: { kind: "success"; text?: string };
}

export interface SessionAttachmentPayload {
  sessionId: string;
  attachmentId: string;
}

export interface SessionAttachmentValue {
  attachment: {
    attachmentId: string;
    mediaType: InlineImageMediaType;
    bytes: number;
    width: number;
    height: number;
    name?: string;
  };
  data: string;
}

export type SessionQueueAction =
  | { kind: "edit"; content: Array<{ type: string; [key: string]: unknown }> }
  | { kind: "remove" }
  | { kind: "steer" };

export interface SessionUpdateQueuePayload {
  sessionId: string;
  itemId: string;
  action: SessionQueueAction;
}

export interface SessionUpdateQueueValue {
  accepted: true;
}

export interface SessionCancelPayload {
  sessionId: string;
}

export interface SessionCancelValue {
  accepted: true;
}
