import {
  callRpc,
  resolveRuntimeFetch as resolvePiHttpTransport,
  RpcClientError,
} from "@workbench/host-client/rpc";
export { createRpcId as createPiRpcId } from "@workbench/host-client/rpc";
import type { PiApiErrorBody, PiQueuedPrompt } from "@workbench/agent-runtime-pi-protocol/messages";
import {
  createRuntimeFetch,
  type RuntimeFetch,
  type RuntimeFetchImplementation,
} from "@workbench/host-client";
import type {
  ClientResponse,
  CommandListPayload,
  CommandListValue,
  ConfigureModelProviderPayload,
  DiscoverModelsPayload,
  DiscoverModelsValue,
  ExternalSessionImportPayload,
  ExternalSessionImportScanValue,
  ExternalSessionImportValue,
  ExtensionFileReadPayload,
  ExtensionFileSnapshotValue,
  ExtensionFilesListPayload,
  ExtensionFilesListValue,
  ExtensionListPayload,
  ExtensionListValue,
  ExtensionRemovePayload,
  ExtensionRemoveValue,
  ExtensionSetEnabledPayload,
  ExtensionSetEnabledValue,
  HostDescription,
  InstalledPackageDescribePayload,
  InstalledPackageDetailsView,
  InstalledPackageListPayload,
  InstalledPackageListValue,
  ModelCatalogValue,
  ModelContextWindowPayload,
  ModelContextWindowValue,
  ModelProviderConfigPayload,
  ModelProviderConfigValue,
  ModelProviderLoginPayload,
  ModelProviderLoginValue,
  ModelProvidersValue,
  PiAgentSettingsNamespaceView,
  PiAgentSettingsUpdatePayload,
  PiResourceCatalogTarget,
  PiPackageCatalogDescribePayload,
  PiPackageCatalogDetailsView,
  PiPackageCatalogSearchPayload,
  PiPackageCatalogSearchValue,
  PiPackageInstallPayload,
  PiPackageInstallValue,
  PiPackageRemovePayload,
  PiPackageRemoveValue,
  PiPackageUpdatePayload,
  PiPackageUpdateValue,
  PiPackageUpdatesPayload,
  PiPackageUpdatesValue,
  ProjectTrustDescribePayload,
  ProjectTrustDescribeValue,
  ProjectTrustUpdatePayload,
  PromptListPayload,
  PromptListValue,
  RemoveModelProviderPayload,
  RespondModelProviderLoginPayload,
  RpcReceipt,
  SessionAttachmentPayload,
  SessionAttachmentValue,
  SessionCancelPayload,
  SessionCancelValue,
  SessionCompactValue,
  SessionContextPolicyPayload,
  SessionContextPolicyUpdatePayload,
  SessionContextPolicyValue,
  SessionContextTraceActivationsPayload,
  SessionContextTraceActivationsValue,
  SessionContextTraceListPayload,
  SessionContextTraceListValue,
  SessionContextTracePromptPartsPayload,
  SessionContextTracePromptPartsValue,
  SessionContextTraceReadPayload,
  SessionContextTraceReadValue,
  SessionCreatePayload,
  SessionCreateValue,
  SessionDeletePayload,
  SessionDeleteValue,
  SessionForkPayload,
  SessionForkValue,
  SessionHistoryPayload,
  SessionHistoryValue,
  SessionListPayload,
  SessionListValue,
  SessionModelsPayload,
  SessionModelsValue,
  SessionPromptPayload,
  SessionPromptValue,
  SessionRegeneratePayload,
  SessionRegenerateValue,
  SessionResumePayload,
  SessionResumeValue,
  SessionRenamePayload,
  SessionRenameValue,
  SessionSearchPayload,
  SessionSearchValue,
  SessionSelectModelPayload,
  SessionSelectModelValue,
  SessionSelectBranchPayload,
  SessionSelectBranchValue,
  SessionScratchCreatePayload,
  SessionScratchCreateValue,
  SessionScratchPromotePayload,
  SessionScratchPromoteValue,
  SessionScratchReleasePayload,
  SessionScratchReleaseValue,
  SessionUpdateQueuePayload,
  SessionUpdateQueueValue,
  SkillDescribePayload,
  SkillDescribeValue,
  SkillFileReadPayload,
  SkillFileSnapshotValue,
  SkillFilesListPayload,
  SkillFilesListValue,
  SkillListPayload,
  SkillListValue,
  SkillRemovePayload,
  SkillRemoveValue,
  SkillSetEnabledPayload,
  SkillSetEnabledValue,
  SettingsDescribeValue,
  SettingsOpenDocumentValue,
  StartModelProviderLoginPayload,
  TestModelImageInputPayload,
  TestModelImageInputValue,
  UpdateModelContextWindowPayload,
  WorkspaceArchivedSessionsValue,
  WorkspaceListValue,
  WorkspacePinValue,
  WorkspaceSessionArchiveValue,
  WorkspaceSessionPinValue,
  WorkspaceView,
} from "@workbench/agent-runtime-pi-protocol/rpc";
const API_ROOT = "/api/pi";

/**
 * The per-Host HTTP seam for Pi API requests. Pass a `RuntimeFetch` created
 * by `@workbench/host-client` to direct a call at a desktop sidecar without
 * changing the browser's same-origin default.
 */
export type PiHttpTransport = RuntimeFetch;

/** Creates a Pi HTTP transport for one immutable Runtime Host connection. */
export function createPiHttpTransport(
  connection: Parameters<typeof createRuntimeFetch>[0],
  fetchImplementation?: RuntimeFetchImplementation,
): PiHttpTransport {
  return createRuntimeFetch(connection, fetchImplementation);
}

export class PiApiError extends RpcClientError {
  constructor(
    code: string,
    status: number,
    details: Record<string, unknown> = {},
    message: string = code,
  ) {
    super(code, status, details, message);
    this.name = "PiApiError";
  }
}

async function responseJson<T>(response: Response): Promise<T> {
  if (response.ok) return (await response.json()) as T;

  let code = "pi_request_failed";
  try {
    const body = (await response.json()) as PiApiErrorBody;
    if (typeof body.error?.code === "string") code = body.error.code;
  } catch {
    // Preserve the stable fallback code.
  }
  throw new PiApiError(code, response.status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface PiRpcCallOptions {
  /** Allows a caller to correlate the HTTP response with a matching events.mux frame. */
  rpcId?: string;
  /** Cancels the underlying HTTP request when the caller no longer needs the response. */
  signal?: AbortSignal;
  /** Directs this request to one explicit Runtime Host without global mutation. */
  transport?: PiHttpTransport;
  /** Publishes successful model mutations to the installation that issued this request. */
  invalidation?: PiRpcInvalidation;
}

export interface PiRpcInvalidation {
  invalidateModelCatalog(): void;
  invalidateSessionModelSelection(sessionId: string): void;
}

export async function callPiRpc<Payload, Value>(
  method: string,
  payload: Payload,
  options: PiRpcCallOptions = {},
): Promise<Value> {
  try {
    return await callRpc<Payload, Value>(method, payload, options);
  } catch (error) {
    if (error instanceof RpcClientError) {
      const code =
        error.code === "rpc_transport_failed" || error.code === "rpc_invalid_response"
          ? `pi_${error.code}`
          : error.code;
      throw new PiApiError(code, error.status, error.details, error.message);
    }
    throw error;
  }
}

/** Answer an interactive mux request using the request's existing rpcId. */
export async function respondPiRpc(
  response: ClientResponse,
  options: Pick<PiRpcCallOptions, "signal" | "transport"> = {},
): Promise<RpcReceipt> {
  const carrier = await resolvePiHttpTransport(options.transport)("/api/respond", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(response),
    signal: options.signal,
  });
  if (!carrier.ok) {
    throw new PiApiError("pi_rpc_transport_failed", carrier.status, { method: "respond" });
  }

  let receipt: unknown;
  try {
    receipt = await carrier.json();
  } catch {
    throw new PiApiError("pi_rpc_invalid_response", carrier.status, { method: "respond" });
  }
  if (!isRecord(receipt)) {
    throw new PiApiError("pi_rpc_invalid_response", carrier.status, { method: "respond" });
  }
  if (receipt.accepted === true) return { accepted: true };
  if (
    receipt.accepted === false &&
    (receipt.reason === "not-pending" || receipt.reason === "bad-response")
  ) {
    return { accepted: false, reason: receipt.reason };
  }
  throw new PiApiError("pi_rpc_invalid_response", carrier.status, { method: "respond" });
}

export function describePiHost(options?: PiRpcCallOptions): Promise<HostDescription> {
  return callPiRpc("host.describe", {}, options);
}

export function describePiProjectTrust(
  payload: ProjectTrustDescribePayload,
  options?: PiRpcCallOptions,
): Promise<ProjectTrustDescribeValue> {
  return callPiRpc("projectTrust.describe", payload, options);
}

export function updatePiProjectTrust(
  payload: ProjectTrustUpdatePayload,
  options?: PiRpcCallOptions,
): Promise<ProjectTrustDescribeValue> {
  return callPiRpc("projectTrust.update", payload, options);
}

export function listPiWorkspaces(options?: PiRpcCallOptions): Promise<WorkspaceListValue> {
  return callPiRpc("workspace.list", {}, options);
}

export function listPiArchivedWorkspaceSessions(
  options?: PiRpcCallOptions,
): Promise<WorkspaceArchivedSessionsValue> {
  return callPiRpc("workspace.listArchivedSessions", {}, options);
}

export function createPiWorkspace(
  path: string,
  options?: PiRpcCallOptions,
): Promise<{ workspace: WorkspaceView; created: boolean }> {
  return callPiRpc("workspace.create", { path }, options);
}

export function renamePiWorkspace(
  workspaceId: string,
  title: string,
  options?: PiRpcCallOptions,
): Promise<{ workspace: WorkspaceView }> {
  return callPiRpc("workspace.rename", { workspaceId, title }, options);
}

export function deletePiWorkspace(
  workspaceId: string,
  options?: PiRpcCallOptions,
): Promise<{ deleted: true }> {
  return callPiRpc("workspace.delete", { workspaceId }, options);
}

export function insertPiWorkspaceBefore(
  workspaceId: string,
  beforeWorkspaceId?: string,
  options?: PiRpcCallOptions,
): Promise<{ workspaceIds: string[] }> {
  return callPiRpc("workspace.insertBefore", { workspaceId, beforeWorkspaceId }, options);
}

export function insertPiSessionBefore(
  workspaceId: string,
  sessionId: string,
  beforeSessionId?: string,
  options?: PiRpcCallOptions,
): Promise<{ workspace: WorkspaceView }> {
  return callPiRpc(
    "workspace.insertSessionBefore",
    {
      workspaceId,
      sessionId,
      beforeSessionId,
    },
    options,
  );
}

export function setPiWorkspacePinned(
  workspaceId: string,
  pinned: boolean,
  options?: PiRpcCallOptions,
): Promise<WorkspacePinValue> {
  return callPiRpc("workspace.setPinned", { workspaceId, pinned }, options);
}

export function setPiWorkspaceSessionPinned(
  sessionId: string,
  pinned: boolean,
  options?: PiRpcCallOptions,
): Promise<WorkspaceSessionPinValue> {
  return callPiRpc("workspace.setSessionPinned", { sessionId, pinned }, options);
}

export function archivePiWorkspaceSession(
  sessionId: string,
  options?: PiRpcCallOptions,
): Promise<WorkspaceSessionArchiveValue> {
  return callPiRpc("workspace.archiveSession", { sessionId }, options);
}

export function unarchivePiWorkspaceSession(
  sessionId: string,
  options?: PiRpcCallOptions,
): Promise<WorkspaceSessionArchiveValue> {
  return callPiRpc("workspace.unarchiveSession", { sessionId }, options);
}

export function listPiModelProviders(options?: PiRpcCallOptions): Promise<ModelProvidersValue> {
  return callPiRpc("llm.providers", {}, options);
}

export function getPiModelProviderConfig(
  payload: ModelProviderConfigPayload,
  options?: PiRpcCallOptions,
): Promise<ModelProviderConfigValue> {
  return callPiRpc("llm.providerConfig", payload, options);
}

function providerLoginValue(
  value: ModelProviderLoginValue,
  options?: PiRpcCallOptions,
): ModelProviderLoginValue {
  if (value.status === "complete") options?.invalidation?.invalidateModelCatalog();
  return value;
}

export async function startPiModelProviderLogin(
  payload: StartModelProviderLoginPayload,
  options?: PiRpcCallOptions,
): Promise<ModelProviderLoginValue> {
  return providerLoginValue(
    await callPiRpc<StartModelProviderLoginPayload, ModelProviderLoginValue>(
      "llm.startProviderLogin",
      payload,
      options,
    ),
    options,
  );
}

export async function getPiModelProviderLogin(
  payload: ModelProviderLoginPayload,
  options?: PiRpcCallOptions,
): Promise<ModelProviderLoginValue> {
  return providerLoginValue(
    await callPiRpc<ModelProviderLoginPayload, ModelProviderLoginValue>(
      "llm.providerLogin",
      payload,
      options,
    ),
    options,
  );
}

export async function respondPiModelProviderLogin(
  payload: RespondModelProviderLoginPayload,
  options?: PiRpcCallOptions,
): Promise<ModelProviderLoginValue> {
  return providerLoginValue(
    await callPiRpc<RespondModelProviderLoginPayload, ModelProviderLoginValue>(
      "llm.respondProviderLogin",
      payload,
      options,
    ),
    options,
  );
}

export function cancelPiModelProviderLogin(
  payload: ModelProviderLoginPayload,
  options?: PiRpcCallOptions,
): Promise<ModelProviderLoginValue> {
  return callPiRpc("llm.cancelProviderLogin", payload, options);
}

export function getPiModelContextWindow(
  payload: ModelContextWindowPayload,
  options?: PiRpcCallOptions,
): Promise<ModelContextWindowValue> {
  return callPiRpc("llm.modelContextWindow", payload, options);
}

export async function updatePiModelContextWindow(
  payload: UpdateModelContextWindowPayload,
  options?: PiRpcCallOptions,
): Promise<ModelContextWindowValue> {
  const value = await callPiRpc<UpdateModelContextWindowPayload, ModelContextWindowValue>(
    "llm.updateModelContextWindow",
    payload,
    options,
  );
  options?.invalidation?.invalidateModelCatalog();
  return value;
}

export async function resetPiModelContextWindow(
  payload: ModelContextWindowPayload,
  options?: PiRpcCallOptions,
): Promise<ModelContextWindowValue> {
  const value = await callPiRpc<ModelContextWindowPayload, ModelContextWindowValue>(
    "llm.resetModelContextWindow",
    payload,
    options,
  );
  options?.invalidation?.invalidateModelCatalog();
  return value;
}

export async function configurePiModelProvider(
  payload: ConfigureModelProviderPayload,
  options?: PiRpcCallOptions,
): Promise<ModelProvidersValue> {
  const value = await callPiRpc<ConfigureModelProviderPayload, ModelProvidersValue>(
    "llm.configureProvider",
    payload,
    options,
  );
  options?.invalidation?.invalidateModelCatalog();
  return value;
}

export async function removePiModelProvider(
  payload: RemoveModelProviderPayload,
  options?: PiRpcCallOptions,
): Promise<ModelProvidersValue> {
  const value = await callPiRpc<RemoveModelProviderPayload, ModelProvidersValue>(
    "llm.removeProvider",
    payload,
    options,
  );
  options?.invalidation?.invalidateModelCatalog();
  return value;
}

export function listPiModelCatalog(options?: PiRpcCallOptions): Promise<ModelCatalogValue> {
  return callPiRpc("llm.models", {}, options);
}

export function discoverPiModels(
  payload: DiscoverModelsPayload,
  options?: PiRpcCallOptions,
): Promise<DiscoverModelsValue> {
  return callPiRpc("llm.discoverModels", payload, options);
}

export function testPiModelImageInput(
  payload: TestModelImageInputPayload,
  options?: PiRpcCallOptions,
): Promise<TestModelImageInputValue> {
  return callPiRpc("llm.testModelImageInput", payload, options);
}

export function listPiSkills(
  payload: SkillListPayload,
  options?: PiRpcCallOptions,
): Promise<SkillListValue> {
  return callPiRpc("skill.list", payload, options);
}

export function describePiSkill(
  payload: SkillDescribePayload,
  options?: PiRpcCallOptions,
): Promise<SkillDescribeValue> {
  return callPiRpc("skill.describe", payload, options);
}

export function setPiSkillEnabled(
  payload: SkillSetEnabledPayload,
  options?: PiRpcCallOptions,
): Promise<SkillSetEnabledValue> {
  return callPiRpc("skill.setEnabled", payload, options);
}

export function removePiSkill(
  payload: SkillRemovePayload,
  options?: PiRpcCallOptions,
): Promise<SkillRemoveValue> {
  return callPiRpc("skill.remove", payload, options);
}

export function listPiSkillFiles(
  payload: SkillFilesListPayload,
  options?: PiRpcCallOptions,
): Promise<SkillFilesListValue> {
  return callPiRpc("skill.files.list", payload, options);
}

export function readPiSkillFile(
  payload: SkillFileReadPayload,
  options?: PiRpcCallOptions,
): Promise<SkillFileSnapshotValue> {
  return callPiRpc("skill.files.read", payload, options);
}

export function listPiCommands(
  payload: CommandListPayload,
  options?: PiRpcCallOptions,
): Promise<CommandListValue> {
  return callPiRpc("command.list", payload, options);
}

export function listPiPrompts(
  payload: PromptListPayload,
  options?: PiRpcCallOptions,
): Promise<PromptListValue> {
  return callPiRpc("prompt.list", payload, options);
}

export function listPiExtensions(
  payload: ExtensionListPayload,
  options?: PiRpcCallOptions,
): Promise<ExtensionListValue> {
  return callPiRpc("extension.list", payload, options);
}

export function readPiExtensionFile(
  payload: ExtensionFileReadPayload,
  options?: PiRpcCallOptions,
): Promise<ExtensionFileSnapshotValue> {
  return callPiRpc("extension.files.read", payload, options);
}

export function listPiExtensionFiles(
  payload: ExtensionFilesListPayload,
  options?: PiRpcCallOptions,
): Promise<ExtensionFilesListValue> {
  return callPiRpc("extension.files.list", payload, options);
}

export function setPiExtensionEnabled(
  payload: ExtensionSetEnabledPayload,
  options?: PiRpcCallOptions,
): Promise<ExtensionSetEnabledValue> {
  return callPiRpc("extension.setEnabled", payload, options);
}

export function removePiExtension(
  payload: ExtensionRemovePayload,
  options?: PiRpcCallOptions,
): Promise<ExtensionRemoveValue> {
  return callPiRpc("extension.remove", payload, options);
}

export function listInstalledPiPackages(
  payload: InstalledPackageListPayload,
  options?: PiRpcCallOptions,
): Promise<InstalledPackageListValue> {
  return callPiRpc("package.list", payload, options);
}

export function describeInstalledPiPackage(
  payload: InstalledPackageDescribePayload,
  options?: PiRpcCallOptions,
): Promise<InstalledPackageDetailsView> {
  return callPiRpc("package.describe", payload, options);
}

export function listAvailablePiPackageUpdates(
  payload: PiPackageUpdatesPayload,
  options?: PiRpcCallOptions,
): Promise<PiPackageUpdatesValue> {
  return callPiRpc("package.updates", payload, options);
}

export function installPiPackage(
  payload: PiPackageInstallPayload,
  options?: PiRpcCallOptions,
): Promise<PiPackageInstallValue> {
  return callPiRpc("package.install", payload, options);
}

export function updatePiPackage(
  payload: PiPackageUpdatePayload,
  options?: PiRpcCallOptions,
): Promise<PiPackageUpdateValue> {
  return callPiRpc("package.update", payload, options);
}

export function removePiPackage(
  payload: PiPackageRemovePayload,
  options?: PiRpcCallOptions,
): Promise<PiPackageRemoveValue> {
  return callPiRpc("package.remove", payload, options);
}

export function searchPiPackageCatalog(
  payload: PiPackageCatalogSearchPayload = {},
  options?: PiRpcCallOptions,
): Promise<PiPackageCatalogSearchValue> {
  return callPiRpc("packageCatalog.search", payload, options);
}

export function describePiPackageCatalog(
  payload: PiPackageCatalogDescribePayload,
  options?: PiRpcCallOptions,
): Promise<PiPackageCatalogDetailsView> {
  return callPiRpc("packageCatalog.describe", payload, options);
}

export function describePiSettings(
  options?: PiRpcCallOptions,
  target?: PiResourceCatalogTarget,
): Promise<SettingsDescribeValue> {
  return callPiRpc(
    target ? "settings.describeScoped" : "settings.describe",
    target ? { target } : {},
    options,
  );
}

export function openPiSettingsDocument(
  options?: PiRpcCallOptions,
): Promise<SettingsOpenDocumentValue> {
  return callPiRpc("settings.openDocument", {}, options);
}

export async function updatePiAgentSettings(
  payload: PiAgentSettingsUpdatePayload,
  options?: PiRpcCallOptions,
): Promise<PiAgentSettingsNamespaceView> {
  const updated: PiAgentSettingsNamespaceView = await callPiRpc(
    payload.target ? "settings.updateScoped" : "settings.update",
    payload,
    options,
  );
  // Older Runtimes may accept the request while silently stripping unknown prompt fields.
  for (const field of ["systemPrompt", "appendSystemPrompt"] as const) {
    if (payload.patch[field] !== undefined && typeof updated.value?.[field] !== "string") {
      throw new PiApiError("settings-unsupported", 200, { field });
    }
  }
  return updated;
}

export function listPiRpcSessions(
  payload: SessionListPayload = {},
  options?: PiRpcCallOptions,
): Promise<SessionListValue> {
  return callPiRpc("session.list", payload, options);
}

export function searchPiRpcSessions(
  payload: SessionSearchPayload,
  options?: PiRpcCallOptions,
): Promise<SessionSearchValue> {
  return callPiRpc("session.search", payload, options);
}

export function createPiRpcSession(
  payload: SessionCreatePayload,
  options?: PiRpcCallOptions,
): Promise<SessionCreateValue> {
  return callPiRpc("session.create", payload, options);
}

export function scanExternalSessions(
  options?: PiRpcCallOptions,
): Promise<ExternalSessionImportScanValue> {
  return callPiRpc("sessionImport.scan", {}, options);
}

export function importExternalSessions(
  payload: ExternalSessionImportPayload,
  options?: PiRpcCallOptions,
): Promise<ExternalSessionImportValue> {
  return callPiRpc("sessionImport.import", payload, options);
}

export function fetchPiRpcSessionHistory(
  payload: SessionHistoryPayload,
  options?: PiRpcCallOptions,
): Promise<SessionHistoryValue> {
  return callPiRpc("session.history", payload, options);
}

export function listPiRpcSessionContextTrace(
  payload: SessionContextTraceListPayload,
  options?: PiRpcCallOptions,
): Promise<SessionContextTraceListValue> {
  return callPiRpc("session.contextTrace.list", payload, options);
}

export function listPiRpcSessionContextTraceActivations(
  payload: SessionContextTraceActivationsPayload,
  options?: PiRpcCallOptions,
): Promise<SessionContextTraceActivationsValue> {
  return callPiRpc("session.contextTrace.activations", payload, options);
}

export function fetchPiRpcSessionContextTracePromptParts(
  payload: SessionContextTracePromptPartsPayload,
  options?: PiRpcCallOptions,
): Promise<SessionContextTracePromptPartsValue> {
  return callPiRpc("session.contextTrace.promptParts", payload, options);
}

export function readPiRpcSessionContextTrace(
  payload: SessionContextTraceReadPayload,
  options?: PiRpcCallOptions,
): Promise<SessionContextTraceReadValue> {
  return callPiRpc("session.contextTrace.read", payload, options);
}

export function regeneratePiRpcSession(
  payload: SessionRegeneratePayload,
  options?: PiRpcCallOptions,
): Promise<SessionRegenerateValue> {
  return callPiRpc("session.regenerate", payload, options);
}

export function resumePiRpcSession(
  payload: SessionResumePayload,
  options?: PiRpcCallOptions,
): Promise<SessionResumeValue> {
  return callPiRpc("session.resume", payload, options);
}

export function selectPiRpcSessionBranch(
  payload: SessionSelectBranchPayload,
  options?: PiRpcCallOptions,
): Promise<SessionSelectBranchValue> {
  return callPiRpc("session.selectBranch", payload, options);
}

export function listPiRpcSessionModels(
  payload: SessionModelsPayload,
  options?: PiRpcCallOptions,
): Promise<SessionModelsValue> {
  return callPiRpc("session.models", payload, options);
}

export async function selectPiRpcSessionModel(
  payload: SessionSelectModelPayload,
  options?: PiRpcCallOptions,
): Promise<SessionSelectModelValue> {
  const value = await callPiRpc<SessionSelectModelPayload, SessionSelectModelValue>(
    "session.selectModel",
    payload,
    options,
  );
  options?.invalidation?.invalidateSessionModelSelection(payload.sessionId);
  return value;
}

export function getPiRpcSessionContextPolicy(
  payload: SessionContextPolicyPayload,
  options?: PiRpcCallOptions,
): Promise<SessionContextPolicyValue> {
  return callPiRpc("session.contextPolicy", payload, options);
}

export function updatePiRpcSessionContextPolicy(
  payload: SessionContextPolicyUpdatePayload,
  options?: PiRpcCallOptions,
): Promise<SessionContextPolicyValue> {
  return callPiRpc("session.updateContextPolicy", payload, options);
}

export function compactPiRpcSessionContext(
  payload: SessionContextPolicyPayload,
  options?: PiRpcCallOptions,
): Promise<SessionCompactValue> {
  return callPiRpc("session.compactContext", payload, options);
}

export function renamePiRpcSession(
  payload: SessionRenamePayload,
  options?: PiRpcCallOptions,
): Promise<SessionRenameValue> {
  return callPiRpc("session.rename", payload, options);
}

export function deletePiRpcSession(
  payload: SessionDeletePayload,
  options?: PiRpcCallOptions,
): Promise<SessionDeleteValue> {
  return callPiRpc("session.delete", payload, options);
}

export function forkPiRpcSession(
  payload: SessionForkPayload,
  options?: PiRpcCallOptions,
): Promise<SessionForkValue> {
  return callPiRpc("session.fork", payload, options);
}

export function createPiRpcScratchSession(
  payload: SessionScratchCreatePayload,
  options?: PiRpcCallOptions,
): Promise<SessionScratchCreateValue> {
  return callPiRpc("session.scratch.create", payload, options);
}

export function releasePiRpcScratchSession(
  payload: SessionScratchReleasePayload,
  options?: PiRpcCallOptions,
): Promise<SessionScratchReleaseValue> {
  return callPiRpc("session.scratch.release", payload, options);
}

export function promotePiRpcScratchSession(
  payload: SessionScratchPromotePayload,
  options?: PiRpcCallOptions,
): Promise<SessionScratchPromoteValue> {
  return callPiRpc("session.scratch.promote", payload, options);
}

export function promptPiRpcSession(
  payload: SessionPromptPayload,
  rpcId?: string,
  options: Omit<PiRpcCallOptions, "rpcId"> = {},
): Promise<SessionPromptValue> {
  return callPiRpc("session.prompt", payload, {
    ...options,
    ...(rpcId === undefined ? {} : { rpcId }),
  });
}

export function fetchPiRpcSessionAttachment(
  payload: SessionAttachmentPayload,
  options?: PiRpcCallOptions,
): Promise<SessionAttachmentValue> {
  return callPiRpc("session.attachment", payload, options);
}

export function updatePiRpcSessionQueue(
  payload: SessionUpdateQueuePayload,
  options?: PiRpcCallOptions,
): Promise<SessionUpdateQueueValue> {
  return callPiRpc("session.updateQueue", payload, options);
}

export function cancelPiRpcSession(
  payload: SessionCancelPayload,
  options?: PiRpcCallOptions,
): Promise<SessionCancelValue> {
  return callPiRpc("session.cancel", payload, options);
}

export async function replacePiSessionQueue(
  sessionId: string,
  steering: readonly PiQueuedPrompt[],
  followUp: readonly PiQueuedPrompt[],
  options: Pick<PiRpcCallOptions, "signal" | "transport"> = {},
): Promise<void> {
  await responseJson(
    await resolvePiHttpTransport(options.transport)(
      `${API_ROOT}/sessions/${encodeURIComponent(sessionId)}/commands`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "replaceQueue", steering, followUp }),
        signal: options.signal,
      },
    ),
  );
}

export async function setPiSessionQueuePaused(
  sessionId: string,
  paused: boolean,
  steering: readonly PiQueuedPrompt[],
  followUp: readonly PiQueuedPrompt[],
  options: Pick<PiRpcCallOptions, "signal" | "transport"> = {},
): Promise<void> {
  await responseJson(
    await resolvePiHttpTransport(options.transport)(
      `${API_ROOT}/sessions/${encodeURIComponent(sessionId)}/commands`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "setQueuePaused", paused, steering, followUp }),
        signal: options.signal,
      },
    ),
  );
}
