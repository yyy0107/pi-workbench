import type { PiApiErrorBody, PiQueuedPrompt } from "@workbench/agent-runtime-pi-protocol/messages";
import type {
  ClientResponse,
  CommandListPayload,
  CommandListValue,
  AttachmentUnderstandingDescribeValue,
  AttachmentUnderstandingUpdatePayload,
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
  HostDirectoryListing,
  InstalledPackageDescribePayload,
  InstalledPackageDetailsView,
  InstalledPackageListPayload,
  InstalledPackageListValue,
  LocalAppOpenPayload,
  LocalAppOpenValue,
  LocalAppsListValue,
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
  WorkspaceFileDescribePayload,
  WorkspaceFileDescriptorValue,
  WorkspaceFileReadPayload,
  WorkspaceFileSnapshotValue,
  WorkspaceFilesListPayload,
  WorkspaceFilesListValue,
  WorkspaceFilesSearchPayload,
  WorkspaceFilesSearchValue,
  WorkspaceFileWritePayload,
  WorkspaceGitCreateBranchPayload,
  WorkspaceGitDescribePayload,
  WorkspaceGitLogValue,
  WorkspaceGitStatus,
  WorkspaceGitSwitchBranchPayload,
  WorkspaceListValue,
  WorkspacePinValue,
  WorkspaceSessionArchiveValue,
  WorkspaceSessionPinValue,
  WorkspaceView,
  WorkbenchSettingsDescribeValue,
  WorkbenchSettingsUpdatePayload,
  WorkbenchSettingsUpdateValue,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import {
  invalidatePiModelCatalog,
  invalidatePiSessionModelSelection,
} from "../models/model-catalog-invalidation";

const API_ROOT = "/api/pi";

export class PiApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(
    code: string,
    status: number,
    details: Record<string, unknown> = {},
    message: string = code,
  ) {
    super(message);
    this.name = "PiApiError";
    this.code = code;
    this.status = status;
    this.details = details;
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

export function createPiRpcId(method: string): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${method}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface PiRpcCallOptions {
  /** Allows a caller to correlate the HTTP response with a matching events.mux frame. */
  rpcId?: string;
  /** Cancels the underlying HTTP request when the caller no longer needs the response. */
  signal?: AbortSignal;
}

export async function callPiRpc<Payload, Value>(
  method: string,
  payload: Payload,
  options: PiRpcCallOptions = {},
): Promise<Value> {
  const rpcId = options.rpcId ?? createPiRpcId(method);
  const response = await fetch(`/api/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "client-request", rpcId, method, payload }),
    signal: options.signal,
  });

  if (!response.ok) {
    throw new PiApiError("pi_rpc_transport_failed", response.status, { method });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new PiApiError("pi_rpc_invalid_response", response.status, { method });
  }
  if (
    !isRecord(body) ||
    body.type !== "server-response" ||
    body.rpcId !== rpcId ||
    !isRecord(body.result)
  ) {
    throw new PiApiError("pi_rpc_invalid_response", response.status, { method });
  }
  const result = body.result;
  if (result.ok === false) {
    if (
      !isRecord(result.error) ||
      typeof result.error.code !== "string" ||
      typeof result.error.message !== "string" ||
      !isRecord(result.error.details)
    ) {
      throw new PiApiError("pi_rpc_invalid_response", response.status, { method });
    }
    throw new PiApiError(
      result.error.code,
      response.status,
      result.error.details,
      result.error.message,
    );
  }
  if (result.ok !== true) {
    throw new PiApiError("pi_rpc_invalid_response", response.status, { method });
  }
  return result.value as Value;
}

/** Answer an interactive mux request using the request's existing rpcId. */
export async function respondPiRpc(response: ClientResponse): Promise<RpcReceipt> {
  const carrier = await fetch("/api/respond", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(response),
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

export async function pickPiHostDirectory(): Promise<string | undefined> {
  const { path } = await callPiRpc<Record<string, never>, { path: string | null }>(
    "host.pickDirectory",
    {},
  );
  return path ?? undefined;
}

export function describePiHost(): Promise<HostDescription> {
  return callPiRpc("host.describe", {});
}

export function listPiHostDirectory(path?: string): Promise<HostDirectoryListing> {
  return callPiRpc("host.listDirectory", path === undefined ? {} : { path });
}

export function createPiHostDirectory(path: string, name: string): Promise<{ path: string }> {
  return callPiRpc("host.createDirectory", { path, name });
}

export function openPiHostPath(path: string): Promise<{ opened: true }> {
  return callPiRpc("host.openPath", { path });
}

export function describePiProjectTrust(
  payload: ProjectTrustDescribePayload,
): Promise<ProjectTrustDescribeValue> {
  return callPiRpc("projectTrust.describe", payload);
}

export function updatePiProjectTrust(
  payload: ProjectTrustUpdatePayload,
): Promise<ProjectTrustDescribeValue> {
  return callPiRpc("projectTrust.update", payload);
}

export function listPiLocalApps(): Promise<LocalAppsListValue> {
  return callPiRpc("host.localApps.list", {});
}

export function refreshPiLocalApps(): Promise<LocalAppsListValue> {
  return callPiRpc("host.localApps.refresh", {});
}

export function openPiLocalApp(payload: LocalAppOpenPayload): Promise<LocalAppOpenValue> {
  return callPiRpc("host.localApps.open", payload);
}

export function listPiWorkspaceFiles(
  payload: WorkspaceFilesListPayload,
): Promise<WorkspaceFilesListValue> {
  return callPiRpc("workspace.files.list", payload);
}

export function searchPiWorkspaceFiles(
  payload: WorkspaceFilesSearchPayload,
  options?: PiRpcCallOptions,
): Promise<WorkspaceFilesSearchValue> {
  return callPiRpc("workspace.files.search", payload, options);
}

export function describePiWorkspaceFile(
  payload: WorkspaceFileDescribePayload,
): Promise<WorkspaceFileDescriptorValue> {
  return callPiRpc("workspace.files.describe", payload);
}

export function piWorkspaceFileContentUrl(payload: WorkspaceFileDescribePayload): string {
  const query = new URLSearchParams({
    workspaceId: payload.workspaceId,
    relativePath: payload.relativePath,
  });
  return `/api/workspace.files.content?${query.toString()}`;
}

export interface PiWorkspaceFileTextChunk {
  text: string;
  loadedBytes: number;
  totalBytes?: number;
}

export interface StreamPiWorkspaceFileTextOptions {
  signal?: AbortSignal;
  onChunk(chunk: PiWorkspaceFileTextChunk): void;
}

function contentLength(response: Response): number | undefined {
  const header = response.headers.get("content-length");
  if (header === null) return undefined;
  const value = Number(header);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function decodeWorkspaceFileText(decoder: TextDecoder, value?: Uint8Array, stream = false): string {
  try {
    return value ? decoder.decode(value, { stream }) : decoder.decode();
  } catch {
    throw new PiApiError("workspace-file-unsupported-encoding", 422);
  }
}

export async function streamPiWorkspaceFileText(
  payload: WorkspaceFileDescribePayload,
  { signal, onChunk }: StreamPiWorkspaceFileTextOptions,
): Promise<{ loadedBytes: number; totalBytes?: number }> {
  const response = await fetch(piWorkspaceFileContentUrl(payload), {
    headers: { Accept: "text/plain, text/*;q=0.9, application/json;q=0.8, */*;q=0.1" },
    signal,
  });
  if (!response.ok) {
    throw new PiApiError("workspace_file_content_failed", response.status);
  }

  const totalBytes = contentLength(response);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const reader = response.body?.getReader();
  if (!reader) throw new PiApiError("workspace_file_content_unavailable", response.status);

  let loadedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      if (value.includes(0)) {
        throw new PiApiError("workspace-file-unsupported-encoding", 422);
      }
      loadedBytes += value.byteLength;
      const text = decodeWorkspaceFileText(decoder, value, true);
      onChunk({ text, loadedBytes, ...(totalBytes === undefined ? {} : { totalBytes }) });
    }
    const text = decodeWorkspaceFileText(decoder);
    if (text) {
      onChunk({ text, loadedBytes, ...(totalBytes === undefined ? {} : { totalBytes }) });
    }
  } catch (error) {
    if (error instanceof PiApiError || signal?.aborted) throw error;
    throw new PiApiError("workspace_file_content_failed", response.status);
  } finally {
    reader.releaseLock();
  }

  return { loadedBytes, ...(totalBytes === undefined ? {} : { totalBytes }) };
}

export function readPiWorkspaceFile(
  payload: WorkspaceFileReadPayload,
): Promise<WorkspaceFileSnapshotValue> {
  return callPiRpc("workspace.files.read", payload);
}

export function writePiWorkspaceFile(
  payload: WorkspaceFileWritePayload,
): Promise<WorkspaceFileSnapshotValue> {
  return callPiRpc("workspace.files.write", payload);
}

export function describePiWorkspaceGit(
  payload: WorkspaceGitDescribePayload,
  options?: PiRpcCallOptions,
): Promise<WorkspaceGitStatus> {
  return callPiRpc("workspace.git.describe", payload, options);
}

export function readPiWorkspaceGitLog(
  payload: WorkspaceGitDescribePayload,
  options?: PiRpcCallOptions,
): Promise<WorkspaceGitLogValue> {
  return callPiRpc("workspace.git.log", payload, options);
}

export function switchPiWorkspaceGitBranch(
  payload: WorkspaceGitSwitchBranchPayload,
): Promise<WorkspaceGitStatus> {
  return callPiRpc("workspace.git.switchBranch", payload);
}

export function createPiWorkspaceGitBranch(
  payload: WorkspaceGitCreateBranchPayload,
): Promise<WorkspaceGitStatus> {
  return callPiRpc("workspace.git.createBranch", payload);
}

export function listPiWorkspaces(): Promise<WorkspaceListValue> {
  return callPiRpc("workspace.list", {});
}

export function listPiArchivedWorkspaceSessions(): Promise<WorkspaceArchivedSessionsValue> {
  return callPiRpc("workspace.listArchivedSessions", {});
}

export function createPiWorkspace(
  path: string,
): Promise<{ workspace: WorkspaceView; created: boolean }> {
  return callPiRpc("workspace.create", { path });
}

export function renamePiWorkspace(
  workspaceId: string,
  title: string,
): Promise<{ workspace: WorkspaceView }> {
  return callPiRpc("workspace.rename", { workspaceId, title });
}

export function deletePiWorkspace(workspaceId: string): Promise<{ deleted: true }> {
  return callPiRpc("workspace.delete", { workspaceId });
}

export function insertPiWorkspaceBefore(
  workspaceId: string,
  beforeWorkspaceId?: string,
): Promise<{ workspaceIds: string[] }> {
  return callPiRpc("workspace.insertBefore", { workspaceId, beforeWorkspaceId });
}

export function insertPiSessionBefore(
  workspaceId: string,
  sessionId: string,
  beforeSessionId?: string,
): Promise<{ workspace: WorkspaceView }> {
  return callPiRpc("workspace.insertSessionBefore", {
    workspaceId,
    sessionId,
    beforeSessionId,
  });
}

export function setPiWorkspacePinned(
  workspaceId: string,
  pinned: boolean,
): Promise<WorkspacePinValue> {
  return callPiRpc("workspace.setPinned", { workspaceId, pinned });
}

export function setPiWorkspaceSessionPinned(
  sessionId: string,
  pinned: boolean,
): Promise<WorkspaceSessionPinValue> {
  return callPiRpc("workspace.setSessionPinned", { sessionId, pinned });
}

export function archivePiWorkspaceSession(
  sessionId: string,
): Promise<WorkspaceSessionArchiveValue> {
  return callPiRpc("workspace.archiveSession", { sessionId });
}

export function unarchivePiWorkspaceSession(
  sessionId: string,
): Promise<WorkspaceSessionArchiveValue> {
  return callPiRpc("workspace.unarchiveSession", { sessionId });
}

export function listPiModelProviders(): Promise<ModelProvidersValue> {
  return callPiRpc("llm.providers", {});
}

export function getPiModelProviderConfig(
  payload: ModelProviderConfigPayload,
): Promise<ModelProviderConfigValue> {
  return callPiRpc("llm.providerConfig", payload);
}

function providerLoginValue(value: ModelProviderLoginValue): ModelProviderLoginValue {
  if (value.status === "complete") invalidatePiModelCatalog();
  return value;
}

export async function startPiModelProviderLogin(
  payload: StartModelProviderLoginPayload,
): Promise<ModelProviderLoginValue> {
  return providerLoginValue(
    await callPiRpc<StartModelProviderLoginPayload, ModelProviderLoginValue>(
      "llm.startProviderLogin",
      payload,
    ),
  );
}

export async function getPiModelProviderLogin(
  payload: ModelProviderLoginPayload,
): Promise<ModelProviderLoginValue> {
  return providerLoginValue(
    await callPiRpc<ModelProviderLoginPayload, ModelProviderLoginValue>(
      "llm.providerLogin",
      payload,
    ),
  );
}

export async function respondPiModelProviderLogin(
  payload: RespondModelProviderLoginPayload,
): Promise<ModelProviderLoginValue> {
  return providerLoginValue(
    await callPiRpc<RespondModelProviderLoginPayload, ModelProviderLoginValue>(
      "llm.respondProviderLogin",
      payload,
    ),
  );
}

export function cancelPiModelProviderLogin(
  payload: ModelProviderLoginPayload,
): Promise<ModelProviderLoginValue> {
  return callPiRpc("llm.cancelProviderLogin", payload);
}

export function getPiModelContextWindow(
  payload: ModelContextWindowPayload,
): Promise<ModelContextWindowValue> {
  return callPiRpc("llm.modelContextWindow", payload);
}

export async function updatePiModelContextWindow(
  payload: UpdateModelContextWindowPayload,
): Promise<ModelContextWindowValue> {
  const value = await callPiRpc<UpdateModelContextWindowPayload, ModelContextWindowValue>(
    "llm.updateModelContextWindow",
    payload,
  );
  invalidatePiModelCatalog();
  return value;
}

export async function resetPiModelContextWindow(
  payload: ModelContextWindowPayload,
): Promise<ModelContextWindowValue> {
  const value = await callPiRpc<ModelContextWindowPayload, ModelContextWindowValue>(
    "llm.resetModelContextWindow",
    payload,
  );
  invalidatePiModelCatalog();
  return value;
}

export async function configurePiModelProvider(
  payload: ConfigureModelProviderPayload,
): Promise<ModelProvidersValue> {
  const value = await callPiRpc<ConfigureModelProviderPayload, ModelProvidersValue>(
    "llm.configureProvider",
    payload,
  );
  invalidatePiModelCatalog();
  return value;
}

export async function removePiModelProvider(
  payload: RemoveModelProviderPayload,
): Promise<ModelProvidersValue> {
  const value = await callPiRpc<RemoveModelProviderPayload, ModelProvidersValue>(
    "llm.removeProvider",
    payload,
  );
  invalidatePiModelCatalog();
  return value;
}

export function listPiModelCatalog(): Promise<ModelCatalogValue> {
  return callPiRpc("llm.models", {});
}

export function discoverPiModels(payload: DiscoverModelsPayload): Promise<DiscoverModelsValue> {
  return callPiRpc("llm.discoverModels", payload);
}

export function testPiModelImageInput(
  payload: TestModelImageInputPayload,
): Promise<TestModelImageInputValue> {
  return callPiRpc("llm.testModelImageInput", payload);
}

export function listPiSkills(payload: SkillListPayload): Promise<SkillListValue> {
  return callPiRpc("skill.list", payload);
}

export function describePiSkill(payload: SkillDescribePayload): Promise<SkillDescribeValue> {
  return callPiRpc("skill.describe", payload);
}

export function setPiSkillEnabled(payload: SkillSetEnabledPayload): Promise<SkillSetEnabledValue> {
  return callPiRpc("skill.setEnabled", payload);
}

export function removePiSkill(payload: SkillRemovePayload): Promise<SkillRemoveValue> {
  return callPiRpc("skill.remove", payload);
}

export function listPiSkillFiles(payload: SkillFilesListPayload): Promise<SkillFilesListValue> {
  return callPiRpc("skill.files.list", payload);
}

export function readPiSkillFile(payload: SkillFileReadPayload): Promise<SkillFileSnapshotValue> {
  return callPiRpc("skill.files.read", payload);
}

export function listPiCommands(payload: CommandListPayload): Promise<CommandListValue> {
  return callPiRpc("command.list", payload);
}

export function listPiPrompts(payload: PromptListPayload): Promise<PromptListValue> {
  return callPiRpc("prompt.list", payload);
}

export function listPiExtensions(payload: ExtensionListPayload): Promise<ExtensionListValue> {
  return callPiRpc("extension.list", payload);
}

export function readPiExtensionFile(
  payload: ExtensionFileReadPayload,
): Promise<ExtensionFileSnapshotValue> {
  return callPiRpc("extension.files.read", payload);
}

export function listPiExtensionFiles(
  payload: ExtensionFilesListPayload,
): Promise<ExtensionFilesListValue> {
  return callPiRpc("extension.files.list", payload);
}

export function setPiExtensionEnabled(
  payload: ExtensionSetEnabledPayload,
): Promise<ExtensionSetEnabledValue> {
  return callPiRpc("extension.setEnabled", payload);
}

export function removePiExtension(payload: ExtensionRemovePayload): Promise<ExtensionRemoveValue> {
  return callPiRpc("extension.remove", payload);
}

export function listInstalledPiPackages(
  payload: InstalledPackageListPayload,
): Promise<InstalledPackageListValue> {
  return callPiRpc("package.list", payload);
}

export function describeInstalledPiPackage(
  payload: InstalledPackageDescribePayload,
): Promise<InstalledPackageDetailsView> {
  return callPiRpc("package.describe", payload);
}

export function listAvailablePiPackageUpdates(
  payload: PiPackageUpdatesPayload,
): Promise<PiPackageUpdatesValue> {
  return callPiRpc("package.updates", payload);
}

export function installPiPackage(payload: PiPackageInstallPayload): Promise<PiPackageInstallValue> {
  return callPiRpc("package.install", payload);
}

export function updatePiPackage(payload: PiPackageUpdatePayload): Promise<PiPackageUpdateValue> {
  return callPiRpc("package.update", payload);
}

export function removePiPackage(payload: PiPackageRemovePayload): Promise<PiPackageRemoveValue> {
  return callPiRpc("package.remove", payload);
}

export function searchPiPackageCatalog(
  payload: PiPackageCatalogSearchPayload = {},
): Promise<PiPackageCatalogSearchValue> {
  return callPiRpc("packageCatalog.search", payload);
}

export function describePiPackageCatalog(
  payload: PiPackageCatalogDescribePayload,
): Promise<PiPackageCatalogDetailsView> {
  return callPiRpc("packageCatalog.describe", payload);
}

export function describePiSettings(): Promise<SettingsDescribeValue> {
  return callPiRpc("settings.describe", {});
}

export function openPiSettingsDocument(): Promise<SettingsOpenDocumentValue> {
  return callPiRpc("settings.openDocument", {});
}

export function updatePiAgentSettings(
  payload: PiAgentSettingsUpdatePayload,
): Promise<PiAgentSettingsNamespaceView> {
  return callPiRpc("settings.update", payload);
}

export function describeWorkbenchSettings(): Promise<WorkbenchSettingsDescribeValue> {
  return callPiRpc("workbenchSettings.describe", {});
}

export function openWorkbenchSettingsDocument(): Promise<SettingsOpenDocumentValue> {
  return callPiRpc("workbenchSettings.openDocument", {});
}

export function updateWorkbenchSettings(
  payload: WorkbenchSettingsUpdatePayload,
): Promise<WorkbenchSettingsUpdateValue> {
  return callPiRpc("workbenchSettings.update", payload);
}

export function describeAttachmentUnderstandingSettings(): Promise<AttachmentUnderstandingDescribeValue> {
  return callPiRpc("imageUnderstanding.describe", {});
}

export function updateAttachmentUnderstandingSettings(
  payload: AttachmentUnderstandingUpdatePayload,
): Promise<AttachmentUnderstandingDescribeValue> {
  return callPiRpc("imageUnderstanding.update", payload);
}

/** @deprecated Use the attachment-neutral settings API name. */
export const describeImageUnderstandingSettings = describeAttachmentUnderstandingSettings;
/** @deprecated Use the attachment-neutral settings API name. */
export const updateImageUnderstandingSettings = updateAttachmentUnderstandingSettings;

export function listPiRpcSessions(payload: SessionListPayload = {}): Promise<SessionListValue> {
  return callPiRpc("session.list", payload);
}

export function searchPiRpcSessions(payload: SessionSearchPayload): Promise<SessionSearchValue> {
  return callPiRpc("session.search", payload);
}

export function createPiRpcSession(payload: SessionCreatePayload): Promise<SessionCreateValue> {
  return callPiRpc("session.create", payload);
}

export function scanExternalSessions(): Promise<ExternalSessionImportScanValue> {
  return callPiRpc("sessionImport.scan", {});
}

export function importExternalSessions(
  payload: ExternalSessionImportPayload,
): Promise<ExternalSessionImportValue> {
  return callPiRpc("sessionImport.import", payload);
}

export function fetchPiRpcSessionHistory(
  payload: SessionHistoryPayload,
): Promise<SessionHistoryValue> {
  return callPiRpc("session.history", payload);
}

export function listPiRpcSessionContextTrace(
  payload: SessionContextTraceListPayload,
): Promise<SessionContextTraceListValue> {
  return callPiRpc("session.contextTrace.list", payload);
}

export function listPiRpcSessionContextTraceActivations(
  payload: SessionContextTraceActivationsPayload,
): Promise<SessionContextTraceActivationsValue> {
  return callPiRpc("session.contextTrace.activations", payload);
}

export function fetchPiRpcSessionContextTracePromptParts(
  payload: SessionContextTracePromptPartsPayload,
): Promise<SessionContextTracePromptPartsValue> {
  return callPiRpc("session.contextTrace.promptParts", payload);
}

export function readPiRpcSessionContextTrace(
  payload: SessionContextTraceReadPayload,
): Promise<SessionContextTraceReadValue> {
  return callPiRpc("session.contextTrace.read", payload);
}

export function regeneratePiRpcSession(
  payload: SessionRegeneratePayload,
): Promise<SessionRegenerateValue> {
  return callPiRpc("session.regenerate", payload);
}

export function resumePiRpcSession(payload: SessionResumePayload): Promise<SessionResumeValue> {
  return callPiRpc("session.resume", payload);
}

export function selectPiRpcSessionBranch(
  payload: SessionSelectBranchPayload,
): Promise<SessionSelectBranchValue> {
  return callPiRpc("session.selectBranch", payload);
}

export function listPiRpcSessionModels(payload: SessionModelsPayload): Promise<SessionModelsValue> {
  return callPiRpc("session.models", payload);
}

const pendingSessionModelSelections = new Map<string, Promise<SessionSelectModelValue>>();

/**
 * Wait until the selector's optimistic session model has been committed by the server. Retry and
 * other model-sensitive actions use this to avoid racing the request that produced the visible UI.
 */
export async function waitForPendingPiRpcSessionModelSelection(sessionId: string): Promise<void> {
  while (true) {
    const pending = pendingSessionModelSelections.get(sessionId);
    if (!pending) return;
    await pending;
  }
}

export async function selectPiRpcSessionModel(
  payload: SessionSelectModelPayload,
): Promise<SessionSelectModelValue> {
  const request = callPiRpc<SessionSelectModelPayload, SessionSelectModelValue>(
    "session.selectModel",
    payload,
  );
  pendingSessionModelSelections.set(payload.sessionId, request);
  try {
    const value = await request;
    invalidatePiSessionModelSelection(payload.sessionId);
    return value;
  } finally {
    if (pendingSessionModelSelections.get(payload.sessionId) === request) {
      pendingSessionModelSelections.delete(payload.sessionId);
    }
  }
}

export function getPiRpcSessionContextPolicy(
  payload: SessionContextPolicyPayload,
): Promise<SessionContextPolicyValue> {
  return callPiRpc("session.contextPolicy", payload);
}

export function updatePiRpcSessionContextPolicy(
  payload: SessionContextPolicyUpdatePayload,
): Promise<SessionContextPolicyValue> {
  return callPiRpc("session.updateContextPolicy", payload);
}

export function compactPiRpcSessionContext(
  payload: SessionContextPolicyPayload,
): Promise<SessionCompactValue> {
  return callPiRpc("session.compactContext", payload);
}

export function renamePiRpcSession(payload: SessionRenamePayload): Promise<SessionRenameValue> {
  return callPiRpc("session.rename", payload);
}

export function deletePiRpcSession(payload: SessionDeletePayload): Promise<SessionDeleteValue> {
  return callPiRpc("session.delete", payload);
}

export function forkPiRpcSession(payload: SessionForkPayload): Promise<SessionForkValue> {
  return callPiRpc("session.fork", payload);
}

export function createPiRpcScratchSession(
  payload: SessionScratchCreatePayload,
): Promise<SessionScratchCreateValue> {
  return callPiRpc("session.scratch.create", payload);
}

export function releasePiRpcScratchSession(
  payload: SessionScratchReleasePayload,
): Promise<SessionScratchReleaseValue> {
  return callPiRpc("session.scratch.release", payload);
}

export function promotePiRpcScratchSession(
  payload: SessionScratchPromotePayload,
): Promise<SessionScratchPromoteValue> {
  return callPiRpc("session.scratch.promote", payload);
}

export function promptPiRpcSession(
  payload: SessionPromptPayload,
  rpcId?: string,
): Promise<SessionPromptValue> {
  return callPiRpc("session.prompt", payload, rpcId === undefined ? {} : { rpcId });
}

export function fetchPiRpcSessionAttachment(
  payload: SessionAttachmentPayload,
): Promise<SessionAttachmentValue> {
  return callPiRpc("session.attachment", payload);
}

export function updatePiRpcSessionQueue(
  payload: SessionUpdateQueuePayload,
): Promise<SessionUpdateQueueValue> {
  return callPiRpc("session.updateQueue", payload);
}

export function cancelPiRpcSession(payload: SessionCancelPayload): Promise<SessionCancelValue> {
  return callPiRpc("session.cancel", payload);
}

export async function replacePiSessionQueue(
  sessionId: string,
  steering: readonly PiQueuedPrompt[],
  followUp: readonly PiQueuedPrompt[],
): Promise<void> {
  await responseJson(
    await fetch(`${API_ROOT}/sessions/${encodeURIComponent(sessionId)}/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "replaceQueue", steering, followUp }),
    }),
  );
}

export async function setPiSessionQueuePaused(
  sessionId: string,
  paused: boolean,
  steering: readonly PiQueuedPrompt[],
  followUp: readonly PiQueuedPrompt[],
): Promise<void> {
  await responseJson(
    await fetch(`${API_ROOT}/sessions/${encodeURIComponent(sessionId)}/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "setQueuePaused", paused, steering, followUp }),
    }),
  );
}
