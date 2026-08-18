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
  PiWorkspaceBrowseResponse,
  PiWorkspaceSummary,
} from "../contracts";

const API_ROOT = "/api/pi";

export class PiApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "PiApiError";
    this.code = code;
    this.status = status;
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

export async function browsePiWorkspaces(path?: string): Promise<PiWorkspaceBrowseResponse> {
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  return responseJson(await fetch(`${API_ROOT}/workspaces/browse${query}`, { cache: "no-store" }));
}

export async function validatePiWorkspace(cwd: string): Promise<PiWorkspaceSummary> {
  const body = await responseJson<{ workspace: PiWorkspaceSummary }>(
    await fetch(`${API_ROOT}/workspaces/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd }),
    }),
  );
  return body.workspace;
}

export async function pickPiWorkspace(): Promise<PiWorkspaceSummary | undefined> {
  const response = await fetch(`${API_ROOT}/workspaces/pick`, { method: "POST" });
  if (response.status === 204) return undefined;
  const body = await responseJson<{ workspace: PiWorkspaceSummary }>(response);
  return body.workspace;
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
