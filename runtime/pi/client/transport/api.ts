import type {
  PiApiErrorBody,
  PiImageContent,
  PiModelListResponse,
  PiModelSelection,
  PiQueuedPrompt,
  PiQueueMode,
  PiSessionHistory,
  PiSessionListResponse,
  PiSessionSummary,
  PiWorkspaceSummary,
} from "../../contracts";
import type {
  ClientResponse,
  CommandListPayload,
  CommandListValue,
  ConfigureModelProviderPayload,
  DiscoverModelsPayload,
  DiscoverModelsValue,
  ExtensionListPayload,
  ExtensionListValue,
  HostDescription,
  HostDirectoryListing,
  ModelCatalogValue,
  ModelContextWindowPayload,
  ModelContextWindowValue,
  ModelProviderConfigPayload,
  ModelProviderConfigValue,
  ModelProvidersValue,
  PiAgentSettingsNamespaceView,
  PiAgentSettingsUpdatePayload,
  RemoveModelProviderPayload,
  RpcReceipt,
  SessionAttachmentPayload,
  SessionAttachmentValue,
  SessionCancelPayload,
  SessionCancelValue,
  SessionCreatePayload,
  SessionCreateValue,
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
  SessionRenamePayload,
  SessionRenameValue,
  SessionSearchPayload,
  SessionSearchValue,
  SessionSelectModelPayload,
  SessionSelectModelValue,
  SessionUpdateQueuePayload,
  SessionUpdateQueueValue,
  SkillListPayload,
  SkillListValue,
  SettingsDescribeValue,
  SettingsOpenDocumentValue,
  UpdateModelContextWindowPayload,
  WorkspaceListValue,
  WorkspaceView,
} from "../../rpc-contracts";
import { invalidatePiModelCatalog } from "../models/model-catalog-invalidation";

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

export async function listPiSessions(): Promise<PiSessionListResponse> {
  return responseJson(await fetch(`${API_ROOT}/sessions`, { cache: "no-store" }));
}

export async function listPiModels(cwd: string): Promise<PiModelListResponse> {
  const query = `?cwd=${encodeURIComponent(cwd)}`;
  return responseJson(await fetch(`${API_ROOT}/models${query}`, { cache: "no-store" }));
}

export async function createPiSession(cwd: string): Promise<PiSessionSummary> {
  const body = await responseJson<{ session: PiSessionSummary }>(
    await fetch(`${API_ROOT}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd }),
    }),
  );
  return body.session;
}

export async function pickPiWorkspace(): Promise<PiWorkspaceSummary | undefined> {
  const { path } = await callPiRpc<Record<string, never>, { path: string | null }>(
    "host.pickDirectory",
    {},
  );
  if (!path) return undefined;
  const { workspace } = await createPiWorkspace(path);
  return workspaceSummary(workspace);
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

function workspaceSummary(workspace: WorkspaceView): PiWorkspaceSummary {
  return { id: workspace.workspaceId, name: workspace.title, cwd: workspace.path };
}

export function listPiWorkspaces(): Promise<WorkspaceListValue> {
  return callPiRpc("workspace.list", {});
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

export function archivePiWorkspaceSession(
  sessionId: string,
): Promise<{ archivedSessionIds: string[] }> {
  return callPiRpc("workspace.archiveSession", { sessionId });
}

export function unarchivePiWorkspaceSession(
  sessionId: string,
): Promise<{ archivedSessionIds: string[] }> {
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

export function listPiSkills(payload: SkillListPayload): Promise<SkillListValue> {
  return callPiRpc("skill.list", payload);
}

export function listPiCommands(payload: CommandListPayload): Promise<CommandListValue> {
  return callPiRpc("command.list", payload);
}

export function listPiExtensions(payload: ExtensionListPayload): Promise<ExtensionListValue> {
  return callPiRpc("extension.list", payload);
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

export function listPiRpcSessions(payload: SessionListPayload = {}): Promise<SessionListValue> {
  return callPiRpc("session.list", payload);
}

export function searchPiRpcSessions(payload: SessionSearchPayload): Promise<SessionSearchValue> {
  return callPiRpc("session.search", payload);
}

export function createPiRpcSession(payload: SessionCreatePayload): Promise<SessionCreateValue> {
  return callPiRpc("session.create", payload);
}

export function fetchPiRpcSessionHistory(
  payload: SessionHistoryPayload,
): Promise<SessionHistoryValue> {
  return callPiRpc("session.history", payload);
}

export function listPiRpcSessionModels(payload: SessionModelsPayload): Promise<SessionModelsValue> {
  return callPiRpc("session.models", payload);
}

export function selectPiRpcSessionModel(
  payload: SessionSelectModelPayload,
): Promise<SessionSelectModelValue> {
  return callPiRpc("session.selectModel", payload);
}

export function renamePiRpcSession(payload: SessionRenamePayload): Promise<SessionRenameValue> {
  return callPiRpc("session.rename", payload);
}

export function forkPiRpcSession(payload: SessionForkPayload): Promise<SessionForkValue> {
  return callPiRpc("session.fork", payload);
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

export async function fetchPiSessionHistory(sessionId: string): Promise<PiSessionHistory> {
  return responseJson(
    await fetch(`${API_ROOT}/sessions/${encodeURIComponent(sessionId)}`, {
      cache: "no-store",
    }),
  );
}

export async function renamePiSession(sessionId: string, name: string): Promise<void> {
  await responseJson(
    await fetch(`${API_ROOT}/sessions/${encodeURIComponent(sessionId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  );
}

export async function deletePiSession(sessionId: string): Promise<void> {
  const response = await fetch(`${API_ROOT}/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
  if (!response.ok) await responseJson(response);
}

export async function promptPiSession(
  sessionId: string,
  message: string,
  images?: PiImageContent[],
  model?: PiModelSelection,
): Promise<void> {
  await responseJson(
    await fetch(`${API_ROOT}/sessions/${encodeURIComponent(sessionId)}/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "prompt", message, images, model }),
    }),
  );
}

export async function queuePiSession(
  sessionId: string,
  mode: PiQueueMode,
  prompt: PiQueuedPrompt,
): Promise<void> {
  await responseJson(
    await fetch(`${API_ROOT}/sessions/${encodeURIComponent(sessionId)}/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: mode, ...prompt }),
    }),
  );
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

export async function steerQueuedPiSession(
  sessionId: string,
  prompt: PiQueuedPrompt,
  steering: readonly PiQueuedPrompt[],
  followUp: readonly PiQueuedPrompt[],
): Promise<void> {
  await responseJson(
    await fetch(`${API_ROOT}/sessions/${encodeURIComponent(sessionId)}/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "steerQueued", prompt, steering, followUp }),
    }),
  );
}

export async function cancelPiSession(sessionId: string): Promise<void> {
  await responseJson(
    await fetch(`${API_ROOT}/sessions/${encodeURIComponent(sessionId)}/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "cancel" }),
    }),
  );
}

export function piSessionEventsUrl(sessionId: string): string {
  return `${API_ROOT}/sessions/${encodeURIComponent(sessionId)}/events`;
}

export function piRunningEventsUrl(): string {
  return `${API_ROOT}/running/events`;
}
