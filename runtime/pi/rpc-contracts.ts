import type {
  ComposerCommandArgsBinding as WorkbenchComposerCommandArgsBinding,
  ComposerCommandArgsSchema as WorkbenchComposerCommandArgsSchema,
  ComposerCommandEffect as WorkbenchComposerCommandEffect,
  ComposerSubmission as WorkbenchComposerSubmission,
} from "../../contracts/composer";
import type { InlineDocumentMediaType, InlineImageMediaType } from "./attachment-contracts";
import type { OcrAdapterPresetId } from "../image-understanding/ocr-adapter";

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
  provider?: string;
  model?: string;
  attachedSessions: number;
  canOpenPath: boolean;
}

export interface ModelSelection {
  provider: string;
  model: string;
  reasoningEffort?: string;
}

export interface ModelReasoningEffort {
  id: string;
  name: string;
  description?: string;
}

export interface ModelCatalogModel {
  id: string;
  name: string;
  description?: string;
  input?: Array<"text" | "image">;
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
  maxTokens?: number;
  input?: Array<"text" | "image">;
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
  models: ModelProviderModelConfiguration[];
}

export interface ModelContextWindowPayload {
  provider: string;
  model: string;
}

export interface ModelContextWindowValue extends ModelContextWindowPayload {
  name: string;
  contextWindow: number;
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
}

export interface DiscoveredModel {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  input?: Array<"text" | "image">;
}

export interface DiscoverModelsValue {
  models: DiscoveredModel[];
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

export interface SkillListPayload {
  sessionId: string;
}

export interface SkillView {
  name: string;
  description: string;
  whenToUse?: string;
  modelInvocable: boolean;
}

export interface SkillListValue {
  skills: SkillView[];
}

export interface ExtensionListPayload {
  sessionId: string;
}

export type ExtensionSourceScope = "user" | "project" | "temporary";

export type ExtensionSourceOrigin = "package" | "top-level";

export interface ExtensionView {
  name: string;
  source: string;
  scope: ExtensionSourceScope;
  origin: ExtensionSourceOrigin;
  eventNames: string[];
  toolNames: string[];
  commandNames: string[];
}

export interface ExtensionListValue {
  extensions: ExtensionView[];
  loadErrorCount: number;
}

export interface CommandListPayload {
  sessionId: string;
}

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
}

export interface SkillCommandView extends CommandViewBase {
  kind: "skill";
  modelInvocable: boolean;
}

export type CommandView =
  | BuiltinCommandView
  | ExtensionCommandView
  | PromptCommandView
  | SkillCommandView;

export interface CommandListValue {
  commands: CommandView[];
}

export interface SessionProjections {
  asOfSeq: number;
  values: Record<string, unknown>;
}

export interface SessionListItem {
  sessionId: string;
  updatedAt: number;
  running: boolean;
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
}

export interface SessionRegenerateValue {
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
