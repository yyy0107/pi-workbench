import type {
  WorkbenchComposerCommandArgsBinding,
  WorkbenchComposerCommandArgsSchema,
  WorkbenchComposerCommandEffect,
  WorkbenchComposerSubmission,
} from "../composer-request";

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
  archivedSessionIds: string[];
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

export interface HostDescription {
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
  apiKeyConfigurable: boolean;
  removable: boolean;
  configurationDefined: boolean;
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
      mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
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
    mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
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
