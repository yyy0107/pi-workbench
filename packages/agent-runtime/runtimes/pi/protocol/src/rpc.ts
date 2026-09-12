import type {
  ComposerCommandArgsBinding as WorkbenchComposerCommandArgsBinding,
  ComposerCommandArgsSchema as WorkbenchComposerCommandArgsSchema,
  ComposerCommandEffect as WorkbenchComposerCommandEffect,
  ComposerSubmission as WorkbenchComposerSubmission,
} from "@workbench/contracts/composer";
import type {
  AttachmentUnderstandingDescribeValue,
  AttachmentUnderstandingEngine,
  AttachmentUnderstandingOcrAdapterSettingsValue,
  AttachmentUnderstandingOcrProvider,
  AttachmentUnderstandingRouting,
  AttachmentUnderstandingSettingsPatch,
  AttachmentUnderstandingSettingsValue,
  AttachmentUnderstandingUpdatePayload,
} from "@workbench/attachment-understanding-contracts/settings";
import type { ModelSelection } from "@workbench/contracts/model-selection";

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

export interface UsageStatisticsPayload {
  timeZone: string;
  /** Return the last complete snapshot without waiting for file reconciliation. */
  preferCached?: boolean;
}

export interface UsageStatisticsDay {
  /** Gregorian calendar date in the requested time zone (YYYY-MM-DD). */
  date: string;
  tokens: number;
  messages: number;
  models: Array<{ provider: string; model: string; tokens: number }>;
}

export interface UsageStatisticsValue {
  generatedAt: string;
  today: string;
  timeZone: string;
  totalTokens: number;
  peakDailyTokens: number;
  longestChatMs: number;
  currentStreak: number;
  longestStreak: number;
  days: UsageStatisticsDay[];
}

import type { RpcSuccess } from "@workbench/host-contracts/rpc";
export type {
  RpcIssuePathSegment,
  RpcIssue,
  RpcError,
  ClientRequest,
  RpcSuccess,
  RpcFailure,
  ServerResponse,
} from "@workbench/host-contracts/rpc";

export interface QuestionAnswerItem {
  id: string;
  selected: string[];
  custom?: string;
  skipped?: true;
}

export interface QuestionResponseValue {
  sessionId: string;
  answer: { answers: QuestionAnswerItem[]; nextQuestionIndex?: number };
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

export { WORKSPACE_GIT_BRANCH_NAME_LENGTH_LIMIT } from "@workbench/agent-runtime-contracts/runtime-capabilities";
export { WORKSPACE_GIT_LOG_COMMIT_LIMIT } from "@workbench/agent-runtime-contracts/runtime-capabilities";

export type WorkspaceGitDescribePayload =
  import("@workbench/agent-runtime-contracts/runtime-capabilities").WorkbenchWorkspaceGitRequest;

export type WorkspaceGitChangeKind =
  import("@workbench/agent-runtime-contracts/runtime-capabilities").WorkbenchWorkspaceGitChangeKind;

export type WorkspaceGitChangedFile =
  import("@workbench/agent-runtime-contracts/runtime-capabilities").WorkbenchWorkspaceGitChangedFile;

export type WorkspaceGitRepositoryStatus =
  import("@workbench/agent-runtime-contracts/runtime-capabilities").WorkbenchWorkspaceGitRepositoryStatus;

export type WorkspaceGitStatus =
  import("@workbench/agent-runtime-contracts/runtime-capabilities").WorkbenchWorkspaceGitStatus;

export type WorkspaceGitSwitchBranchPayload =
  import("@workbench/agent-runtime-contracts/runtime-capabilities").WorkbenchWorkspaceGitBranchRequest;

export type WorkspaceGitCreateBranchPayload =
  import("@workbench/agent-runtime-contracts/runtime-capabilities").WorkbenchWorkspaceGitBranchRequest;

export type WorkspaceGitRefKind =
  import("@workbench/agent-runtime-contracts/runtime-capabilities").WorkbenchWorkspaceGitRefKind;

export type WorkspaceGitCommitRef =
  import("@workbench/agent-runtime-contracts/runtime-capabilities").WorkbenchWorkspaceGitCommitRef;

export type WorkspaceGitCommit =
  import("@workbench/agent-runtime-contracts/runtime-capabilities").WorkbenchWorkspaceGitCommit;

export type WorkspaceGitLogValue =
  import("@workbench/agent-runtime-contracts/runtime-capabilities").WorkbenchWorkspaceGitLog;

export type DirectoryEntry =
  import("@workbench/host-contracts/runtime-capabilities").WorkbenchHostDirectoryEntry;

export type HostDirectoryListing =
  import("@workbench/host-contracts/runtime-capabilities").WorkbenchHostDirectoryListing;

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

export type LocalAppKind =
  import("@workbench/host-contracts/runtime-capabilities").WorkbenchLocalAppKind;

export type LocalAppFileKind =
  import("@workbench/host-contracts/runtime-capabilities").WorkbenchLocalAppFileKind;

export type LocalAppPlatform =
  import("@workbench/host-contracts/runtime-capabilities").WorkbenchLocalAppPlatform;

/** Renderer-safe local application metadata. Launcher details remain in the host process. */
export type LocalAppView =
  import("@workbench/host-contracts/runtime-capabilities").WorkbenchLocalApp;

export type LocalAppsListValue =
  import("@workbench/host-contracts/runtime-capabilities").WorkbenchLocalAppsListResult;

export type LocalAppOpenPayload =
  import("@workbench/host-contracts/runtime-capabilities").WorkbenchLocalAppOpenRequest;

export type LocalAppOpenValue =
  import("@workbench/host-contracts/runtime-capabilities").WorkbenchLocalAppOpenResult;

/** Maximum length of a normalized workspace-relative path accepted by the file protocol. */
export { WORKSPACE_FILE_RELATIVE_PATH_LENGTH_LIMIT } from "@workbench/agent-runtime-contracts/runtime-capabilities";

/** Maximum UTF-8 text content accepted by editable Workspace file snapshots. */
export { WORKSPACE_FILE_EDITABLE_SIZE_LIMIT } from "@workbench/agent-runtime-contracts/runtime-capabilities";

export type WorkspaceFileEntry =
  import("@workbench/agent-runtime-contracts/runtime-capabilities").WorkbenchWorkspaceFileEntry;

export type WorkspaceFilesListPayload =
  import("@workbench/agent-runtime-contracts/runtime-capabilities").WorkbenchWorkspaceFilesListRequest;

export type WorkspaceFilesListValue =
  import("@workbench/agent-runtime-contracts/runtime-capabilities").WorkbenchWorkspaceFilesListResult;

export { WORKSPACE_FILE_SEARCH_QUERY_LENGTH_LIMIT } from "@workbench/agent-runtime-contracts/runtime-capabilities";
export { WORKSPACE_FILE_SEARCH_RESULT_LIMIT } from "@workbench/agent-runtime-contracts/runtime-capabilities";

export type WorkspaceFilesSearchPayload =
  import("@workbench/agent-runtime-contracts/runtime-capabilities").WorkbenchWorkspaceFilesSearchRequest;

export type WorkspaceFilesSearchValue =
  import("@workbench/agent-runtime-contracts/runtime-capabilities").WorkbenchWorkspaceFilesSearchResult;

export type WorkspaceFileReadPayload =
  import("@workbench/agent-runtime-contracts/runtime-capabilities").WorkbenchWorkspaceFileRequest;

export type WorkspaceFileDescribePayload =
  import("@workbench/agent-runtime-contracts/runtime-capabilities").WorkbenchWorkspaceFileRequest;

export { WORKSPACE_FILE_BUFFERED_PREVIEW_SIZE_LIMIT } from "@workbench/agent-runtime-contracts/runtime-capabilities";

export type WorkspaceFileDescriptorValue =
  import("@workbench/agent-runtime-contracts/runtime-capabilities").WorkbenchWorkspaceFileDescriptor;

export type WorkspaceFileSnapshotValue =
  import("@workbench/agent-runtime-contracts/runtime-capabilities").WorkbenchWorkspaceFileSnapshot;

export type WorkspaceFileWritePayload =
  import("@workbench/agent-runtime-contracts/runtime-capabilities").WorkbenchWorkspaceFileWriteRequest;

export interface HostDescription {
  /** Stable product identity for native shells and protocol clients. */
  product?: "pi-workbench";
  version: string;
  piVersion: string;
  cwd: string;
  /** Root directory for user-scoped Pi resources. */
  userResourceDir?: string;
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
  catalogRefreshFailed?: boolean;
  /** Current Pi runtime catalog. Reload after clearing customizations to obtain provider defaults. */
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
  testTextInput?: boolean;
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
  textSupported?: boolean;
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
  showCacheMissNotices?: boolean;
  /** Empty removes this scope's override so Pi uses the inherited or bundled prompt. */
  systemPrompt: string;
  /** Appended by Pi from this scope's APPEND_SYSTEM.md; empty removes its override. */
  appendSystemPrompt: string;
  compaction: PiCompactionSettingsValue;
}

export interface PiAgentSettingsUserValue {
  showCacheMissNotices?: boolean;
  systemPrompt?: string;
  appendSystemPrompt?: string;
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
> & {
  ns: typeof PI_AGENT_SETTINGS_NAMESPACE;
  /** Static read-only Pi prompt, without session cwd, local asset paths, or user/project resources. */
  builtinSystemPrompt?: string;
  /** Actual save destinations for the selected resource scope. */
  promptFiles?: Record<"systemPrompt" | "appendSystemPrompt", string>;
};

export interface SettingsDescribeValue {
  writable: boolean;
  hasDocument: boolean;
  namespaces: PiAgentSettingsNamespaceView[];
}

export interface SettingsOpenDocumentValue {
  opened: true;
}

export type WorkbenchSettingsDescribeValue =
  import("@workbench/agent-runtime-contracts/settings").WorkbenchSettingsSnapshot;

export type WorkbenchSettingsUpdatePayload =
  import("@workbench/agent-runtime-contracts/settings").WorkbenchSettingsUpdate;

export type WorkbenchSettingsUpdateValue =
  import("@workbench/agent-runtime-contracts/settings").WorkbenchSettingsUpdateResult;

export type {
  AttachmentUnderstandingDescribeValue,
  AttachmentUnderstandingEngine,
  AttachmentUnderstandingOcrAdapterSettingsValue,
  AttachmentUnderstandingOcrProvider,
  AttachmentUnderstandingRouting,
  AttachmentUnderstandingSettingsPatch,
  AttachmentUnderstandingSettingsValue,
  AttachmentUnderstandingUpdatePayload,
};

/** Legacy image-specific names retained on the unchanged Pi wire contract. */
export type ImageUnderstandingRouting = AttachmentUnderstandingRouting;
export type ImageUnderstandingEngine = AttachmentUnderstandingEngine;
export type ImageUnderstandingOcrProvider = AttachmentUnderstandingOcrProvider;
export type ImageUnderstandingOcrAdapterSettingsValue =
  AttachmentUnderstandingOcrAdapterSettingsValue;
export type ImageUnderstandingSettingsValue = AttachmentUnderstandingSettingsValue;
export type ImageUnderstandingDescribeValue = AttachmentUnderstandingDescribeValue;
export type ImageUnderstandingSettingsPatch = AttachmentUnderstandingSettingsPatch;
export type ImageUnderstandingUpdatePayload = AttachmentUnderstandingUpdatePayload;

export interface PiAgentSettingsPatch {
  showCacheMissNotices?: boolean;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  compaction?: Partial<PiCompactionSettingsValue>;
}

export interface PiAgentSettingsUpdatePayload {
  ns: typeof PI_AGENT_SETTINGS_NAMESPACE;
  patch: PiAgentSettingsPatch;
  expectedRevision?: number;
  target?: PiResourceCatalogTarget;
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
  /** The resource belongs to a Workbench-bundled Pi package. */
  packageBuiltin?: boolean;
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
  /** Package distribution does not change the extension's mutable resource identity. */
  packageBuiltin?: boolean;
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
  /** Workbench-owned extensions expose declarations only, without a mutable resource identity. */
  builtins?: BuiltinExtensionView[];
  loadErrorCount: number;
}

export type BuiltinExtensionView = Pick<
  ExtensionView,
  | "name"
  | "eventNames"
  | "toolNames"
  | "commandNames"
  | "eventDetails"
  | "toolDetails"
  | "commandDetails"
> & {
  /** Implementation provenance, independent of the Workbench availability-control extension. */
  provenance?: {
    kind: "pi-builtin" | "workbench" | "custom" | "package";
    source: string;
    scope?: ExtensionSourceScope;
    overridesPiBuiltin?: boolean;
  };
};

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
  builtin?: boolean;
  name?: string;
  description?: string;
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
  builtin?: boolean;
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  license?: string;
  types: PiPackageResourceType[];
  dependencyCount: number;
  peerDependencyCount: number;
  manifestJson?: string;
  /** Resources discovered in this installed version, including disabled resources. */
  resources?: PiPackageResourceView[];
}

export interface PiPackageResourceView {
  type: Exclude<PiPackageResourceType, "package">;
  name: string;
  description?: string;
  enabled: boolean;
  commandNames?: string[];
  toolNames?: string[];
  eventNames?: string[];
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
  prompts: PromptTemplateView[];
}

export interface PromptTemplateView extends PromptCommandView {
  /** Opaque identity of one resolved resource, including same-name templates. */
  id: string;
  enabled: boolean;
  editable: boolean;
}

export interface PromptDescribePayload extends PromptListPayload {
  id: string;
}

export interface PromptDescribeValue extends PromptTemplateView {
  content: string;
  filePath: string;
  version: string;
}

export interface PromptSavePayload extends PromptListPayload {
  /** Omit both id and version to create a template. */
  id?: string;
  version?: string;
  name: string;
  content: string;
}

export interface PromptRemovePayload extends PromptDescribePayload {
  version: string;
}

export interface PromptSetEnabledPayload extends PromptDescribePayload {
  enabled: boolean;
}

export interface PromptExpandPayload extends PromptDescribePayload {
  arguments: string;
}

export interface PromptExpandValue {
  content: string;
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
  /** Effective working directory used while composing this prompt. */
  cwd?: string;
  systemPromptCharacters: number;
  systemPromptSourceCount: number;
  systemPromptSources: SessionContextTraceSystemPromptSourceSummary[];
  contextFileCount: number;
  contextFiles: string[];
  skills: Array<{
    name: string;
    /** Catalog identity used to associate read tool calls with this skill. */
    filePath?: string;
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

/** Context entries confirmed at Pi's prompt-composition lifecycle boundary, in display order. */
export type SessionContextTracePromptInjection =
  | "system-prompt"
  | "workspace"
  | "skills"
  | "tools"
  | "extensions";

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
  /** Present on prompt composition, context snapshots, and finalized model output summaries. */
  model?: SessionContextTraceModel;
  thinkingLevel?: string;
  /** Pi assistant-message timestamp used only to correlate durable trace summaries with history. */
  messageTimestamp?: number;
  /** Bounded user-prompt excerpt present only on prompt-composition summaries. */
  promptPreview?: string;
  /** Final resource inventory used to compose this prompt, without prompt/tool payload bodies. */
  promptResources?: SessionContextTracePromptResources;
  /** Authoritative non-empty entries observed at the real prompt-composition boundary. */
  promptInjections?: SessionContextTracePromptInjection[];
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
      /** Entries confirmed by the before_agent_start observer; clients must not infer these. */
      promptInjections?: SessionContextTracePromptInjection[];
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
      timing?: {
        /** Context snapshot capture to provider payload hook; includes local request preparation. */
        preparationMs?: number;
        payloadBytes: number;
        /** Offsets from the provider payload hook, measured with a monotonic clock. */
        responseHeadersMs?: number;
        firstEventMs?: number;
        firstDeltaMs?: number;
        totalMs: number;
        /** HTTP only. WebSocket transport diagnostics remain on the original message. */
        httpAttempts: Array<{
          startMs: number;
          durationMs?: number;
          bodyBytes?: number;
          contentEncoding?: string;
          status?: number;
          error?: string;
        }>;
      };
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
  /** Canonical message event id used by the conversation UI as the stopped message id. */
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
  | { type: "attachment"; attachmentId: string }
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
