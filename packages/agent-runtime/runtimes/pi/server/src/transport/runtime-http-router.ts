import { RPC_REQUEST_BODY_LIMITS } from "./rpc-request-budgets";
import {
  PI_THINKING_LEVELS,
  type PiImageContent,
  type PiModelSelection,
  type PiQueuedPrompt,
} from "@workbench/agent-runtime-pi-protocol/messages";
import { rejectUntrustedApiRequest } from "@workbench/server-core/request-guard";
import { isTrustedLocalApiRequest } from "@workbench/server-core/request-trust";

import { PiServerError } from "../core/errors";
import { admitInlineImages, InlineImageAdmissionError } from "../sessions/inline-image-admission";
import { piErrorResponse } from "./responses";
import { readTrustedJsonPost } from "@workbench/host-server/rpc";

type Awaitable<Value> = Value | Promise<Value>;

interface SummarizableSession {
  summary(): unknown;
}

/**
 * Stateful Pi capabilities injected into the Runtime HTTP carrier.
 *
 * The router deliberately does not import the session registry or construct services. The
 * application installation supplies the one live graph shared by RPC, legacy HTTP and streams.
 */
export interface PiRuntimeHttpRouterDependencies {
  readonly listModels: (cwd: string) => Awaitable<unknown>;
  readonly createRunningEventResponse: (request: Request) => Awaitable<Response>;
  readonly createSessionEventResponse: (request: Request, sessionId: string) => Awaitable<Response>;
  readonly cancelSession: (sessionId: string) => Awaitable<void>;
  readonly queuePrompt: (
    sessionId: string,
    mode: "steer" | "followUp",
    prompt: PiQueuedPrompt,
  ) => Awaitable<void>;
  readonly replacePromptQueue: (
    sessionId: string,
    steering: readonly PiQueuedPrompt[],
    followUp: readonly PiQueuedPrompt[],
  ) => Awaitable<void>;
  readonly sendPrompt: (
    sessionId: string,
    message: string,
    images?: PiImageContent[],
    model?: PiModelSelection,
  ) => Awaitable<void>;
  readonly setPromptQueuePaused: (
    sessionId: string,
    paused: boolean,
    steering: readonly PiQueuedPrompt[],
    followUp: readonly PiQueuedPrompt[],
  ) => Awaitable<void>;
  readonly steerQueuedPrompt: (
    sessionId: string,
    prompt: PiQueuedPrompt,
    steering: readonly PiQueuedPrompt[],
    followUp: readonly PiQueuedPrompt[],
  ) => Awaitable<void>;
  readonly deleteSession: (sessionId: string) => Awaitable<void>;
  readonly getSessionHistory: (sessionId: string) => Awaitable<unknown>;
  readonly renameSession: (sessionId: string, name: string) => Awaitable<unknown>;
  readonly createSession: (cwd: string) => Awaitable<SummarizableSession>;
  readonly listSessions: () => Awaitable<unknown>;
  readonly pickWorkspaceDirectory: (signal: AbortSignal) => Awaitable<unknown | undefined>;
  readonly handleSessionExportRequest: (request: Request) => Awaitable<Response>;
}

export type PiRuntimeHttpHandler = (request: Request) => Promise<Response>;

const SESSION_ROUTE = /^\/api\/pi\/sessions\/([^/]+)(?:\/(commands|events))?$/u;

function notFound(): Response {
  return new Response("Not Found", { status: 404 });
}

function methodNotAllowed(): Response {
  return new Response(null, { status: 405 });
}

function automaticOptions(allowed: readonly string[]): Response {
  const methods = [...new Set(["OPTIONS", ...allowed])].sort();
  return new Response(null, {
    status: 204,
    headers: { Allow: methods.join(", ") },
  });
}

function unsupportedMethod(request: Request, allowed: readonly string[]): Response | undefined {
  if (allowed.includes(request.method)) return undefined;
  return request.method === "OPTIONS" ? automaticOptions(allowed) : methodNotAllowed();
}

async function automaticHead(
  request: Request,
  get: (request: Request) => Awaitable<Response>,
): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort(request.signal.reason);
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  try {
    const response = await get(
      new Request(request, {
        method: "GET",
        signal: controller.signal,
      }),
    );
    controller.abort();
    await response.body?.cancel().catch(() => undefined);
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } finally {
    request.signal.removeEventListener("abort", abort);
    controller.abort();
  }
}

function decodePathSegment(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function isImage(value: unknown): value is PiImageContent {
  if (!value || typeof value !== "object") return false;
  const image = value as Partial<PiImageContent>;
  return (
    image.type === "image" &&
    typeof image.data === "string" &&
    typeof image.mimeType === "string" &&
    (image.name === undefined || typeof image.name === "string")
  );
}

function admittedImages(images: readonly PiImageContent[]): PiImageContent[] | undefined {
  try {
    return admitInlineImages(
      images.map((image) => ({
        type: "image",
        mediaType: image.mimeType,
        data: image.data,
        ...(image.name === undefined ? {} : { name: image.name }),
      })),
    );
  } catch (error) {
    if (error instanceof InlineImageAdmissionError) return undefined;
    throw error;
  }
}

function admittedQueuedPrompt(value: unknown): PiQueuedPrompt | undefined {
  if (!value || typeof value !== "object") return undefined;
  const prompt = value as Partial<PiQueuedPrompt>;
  if (
    typeof prompt.message !== "string" ||
    (prompt.images !== undefined &&
      (!Array.isArray(prompt.images) || !prompt.images.every(isImage)))
  ) {
    return undefined;
  }
  const images = prompt.images === undefined ? [] : admittedImages(prompt.images);
  if (!images) return undefined;
  return { message: prompt.message, ...(images.length ? { images } : {}) };
}

function isModelSelection(value: unknown): value is PiModelSelection {
  if (!value || typeof value !== "object") return false;
  const selection = value as Partial<PiModelSelection>;
  return (
    typeof selection.provider === "string" &&
    selection.provider.length > 0 &&
    typeof selection.modelId === "string" &&
    selection.modelId.length > 0 &&
    (selection.thinkingLevel === undefined || PI_THINKING_LEVELS.includes(selection.thinkingLevel))
  );
}

async function handleModels(
  request: Request,
  dependencies: PiRuntimeHttpRouterDependencies,
): Promise<Response> {
  const rejected = rejectUntrustedApiRequest(request);
  if (rejected) return rejected;
  try {
    const cwd = new URL(request.url).searchParams.get("cwd");
    if (!cwd) throw new PiServerError("pi_workspace_path_required", 400);
    return Response.json(await dependencies.listModels(cwd));
  } catch (error) {
    return piErrorResponse(error);
  }
}

async function handleRunningEvents(
  request: Request,
  dependencies: PiRuntimeHttpRouterDependencies,
): Promise<Response> {
  const rejected = rejectUntrustedApiRequest(request);
  if (rejected) return rejected;
  try {
    return await dependencies.createRunningEventResponse(request);
  } catch (error) {
    return piErrorResponse(error);
  }
}

async function handleSessionEvents(
  request: Request,
  sessionId: string,
  dependencies: PiRuntimeHttpRouterDependencies,
): Promise<Response> {
  const rejected = rejectUntrustedApiRequest(request);
  if (rejected) return rejected;
  try {
    return await dependencies.createSessionEventResponse(request, sessionId);
  } catch (error) {
    return piErrorResponse(error);
  }
}

async function handleSessionCommand(
  request: Request,
  sessionId: string,
  dependencies: PiRuntimeHttpRouterDependencies,
): Promise<Response> {
  const decoded = await readTrustedJsonPost(request, {
    maxRequestBodyBytes: RPC_REQUEST_BODY_LIMITS.inlineAttachment,
  });
  if (!decoded.ok) return decoded.response;

  try {
    const body = decoded.value as {
      type?: unknown;
      message?: unknown;
      images?: unknown;
      model?: unknown;
      steering?: unknown;
      followUp?: unknown;
      paused?: unknown;
      prompt?: unknown;
    };

    if (body.type === "cancel") {
      await dependencies.cancelSession(sessionId);
      return Response.json({ ok: true });
    }
    const queueMode = body.type;
    if (queueMode === "steer" || queueMode === "followUp") {
      const prompt = admittedQueuedPrompt(body);
      if (!prompt) throw new PiServerError("pi_invalid_command", 400);
      await dependencies.queuePrompt(sessionId, queueMode, prompt);
      return Response.json({ ok: true }, { status: 202 });
    }
    if (body.type === "replaceQueue") {
      const steering = Array.isArray(body.steering) ? body.steering.map(admittedQueuedPrompt) : [];
      const followUp = Array.isArray(body.followUp) ? body.followUp.map(admittedQueuedPrompt) : [];
      if (
        !Array.isArray(body.steering) ||
        steering.some((prompt) => prompt === undefined) ||
        !Array.isArray(body.followUp) ||
        followUp.some((prompt) => prompt === undefined)
      ) {
        throw new PiServerError("pi_invalid_command", 400);
      }
      await dependencies.replacePromptQueue(
        sessionId,
        steering as PiQueuedPrompt[],
        followUp as PiQueuedPrompt[],
      );
      return Response.json({ ok: true }, { status: 202 });
    }
    if (body.type === "setQueuePaused") {
      const steering = Array.isArray(body.steering) ? body.steering.map(admittedQueuedPrompt) : [];
      const followUp = Array.isArray(body.followUp) ? body.followUp.map(admittedQueuedPrompt) : [];
      if (
        typeof body.paused !== "boolean" ||
        !Array.isArray(body.steering) ||
        steering.some((prompt) => prompt === undefined) ||
        !Array.isArray(body.followUp) ||
        followUp.some((prompt) => prompt === undefined)
      ) {
        throw new PiServerError("pi_invalid_command", 400);
      }
      await dependencies.setPromptQueuePaused(
        sessionId,
        body.paused,
        steering as PiQueuedPrompt[],
        followUp as PiQueuedPrompt[],
      );
      return Response.json({ ok: true }, { status: 202 });
    }
    if (body.type === "steerQueued") {
      const prompt = admittedQueuedPrompt(body.prompt);
      const steering = Array.isArray(body.steering) ? body.steering.map(admittedQueuedPrompt) : [];
      const followUp = Array.isArray(body.followUp) ? body.followUp.map(admittedQueuedPrompt) : [];
      if (
        !prompt ||
        !Array.isArray(body.steering) ||
        steering.some((candidate) => candidate === undefined) ||
        !Array.isArray(body.followUp) ||
        followUp.some((candidate) => candidate === undefined)
      ) {
        throw new PiServerError("pi_invalid_command", 400);
      }
      await dependencies.steerQueuedPrompt(
        sessionId,
        prompt,
        steering as PiQueuedPrompt[],
        followUp as PiQueuedPrompt[],
      );
      return Response.json({ ok: true }, { status: 202 });
    }
    if (
      body.type !== "prompt" ||
      typeof body.message !== "string" ||
      (body.images !== undefined && (!Array.isArray(body.images) || !body.images.every(isImage))) ||
      (body.model !== undefined && !isModelSelection(body.model))
    ) {
      throw new PiServerError("pi_invalid_command", 400);
    }

    const images = admittedImages((body.images as PiImageContent[] | undefined) ?? []);
    if (!images) throw new PiServerError("pi_invalid_command", 400);
    await dependencies.sendPrompt(
      sessionId,
      body.message,
      images,
      body.model as PiModelSelection | undefined,
    );
    return Response.json({ ok: true }, { status: 202 });
  } catch (error) {
    return piErrorResponse(error);
  }
}

async function handleSessionResource(
  request: Request,
  sessionId: string,
  dependencies: PiRuntimeHttpRouterDependencies,
): Promise<Response> {
  const rejected = rejectUntrustedApiRequest(request);
  if (rejected) return rejected;
  try {
    if (request.method === "GET") {
      return Response.json(await dependencies.getSessionHistory(sessionId));
    }
    if (request.method === "PATCH") {
      const body = (await request.json()) as { name?: unknown };
      if (typeof body.name !== "string") {
        throw new PiServerError("pi_invalid_session_name", 400);
      }
      await dependencies.renameSession(sessionId, body.name);
      return Response.json({ ok: true });
    }
    await dependencies.deleteSession(sessionId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return piErrorResponse(error);
  }
}

async function handleSessions(
  request: Request,
  dependencies: PiRuntimeHttpRouterDependencies,
): Promise<Response> {
  const rejected = rejectUntrustedApiRequest(request);
  if (rejected) return rejected;
  try {
    if (request.method === "GET") return Response.json(await dependencies.listSessions());
    const body = (await request.json().catch(() => undefined)) as { cwd?: unknown } | undefined;
    if (typeof body?.cwd !== "string") {
      throw new PiServerError("pi_invalid_workspace", 400);
    }
    const session = await dependencies.createSession(body.cwd);
    return Response.json({ session: session.summary() }, { status: 201 });
  } catch (error) {
    return piErrorResponse(error);
  }
}

async function handleWorkspacePicker(
  request: Request,
  dependencies: PiRuntimeHttpRouterDependencies,
): Promise<Response> {
  try {
    if (!isTrustedLocalApiRequest(request)) {
      throw new PiServerError("pi_workspace_picker_forbidden", 403);
    }
    const workspace = await dependencies.pickWorkspaceDirectory(request.signal);
    return workspace ? Response.json({ workspace }) : new Response(null, { status: 204 });
  } catch (error) {
    return piErrorResponse(error);
  }
}

/**
 * Creates the sole Fetch router for Pi Runtime HTTP APIs.
 *
 * The returned closure is transport-only state. Construct it once beside the installed Pi service
 * graph, then share that exact function with the API-only Host and temporary Next delegators.
 */
export function createPiRuntimeHttpRouter(
  dependencies: PiRuntimeHttpRouterDependencies,
): PiRuntimeHttpHandler {
  return async (request) => {
    const pathname = new URL(request.url).pathname;

    if (pathname === "/api/pi/models") {
      const unsupported = unsupportedMethod(request, ["GET", "HEAD"]);
      if (request.method === "HEAD") {
        return automaticHead(request, (headRequest) => handleModels(headRequest, dependencies));
      }
      return unsupported ?? handleModels(request, dependencies);
    }
    if (pathname === "/api/pi/running/events") {
      const unsupported = unsupportedMethod(request, ["GET", "HEAD"]);
      if (request.method === "HEAD") {
        return automaticHead(request, (headRequest) =>
          handleRunningEvents(headRequest, dependencies),
        );
      }
      return unsupported ?? handleRunningEvents(request, dependencies);
    }
    if (pathname === "/api/pi/sessions") {
      const unsupported = unsupportedMethod(request, ["GET", "HEAD", "POST"]);
      if (request.method === "HEAD") {
        return automaticHead(request, (headRequest) => handleSessions(headRequest, dependencies));
      }
      return unsupported ?? handleSessions(request, dependencies);
    }
    if (pathname === "/api/pi/workspaces/pick") {
      const unsupported = unsupportedMethod(request, ["POST"]);
      return unsupported ?? handleWorkspacePicker(request, dependencies);
    }
    if (pathname === "/api/session.export") {
      const unsupported = unsupportedMethod(request, ["GET", "HEAD"]);
      return unsupported ?? dependencies.handleSessionExportRequest(request);
    }
    const sessionMatch = SESSION_ROUTE.exec(pathname);
    if (sessionMatch) {
      const sessionId = decodePathSegment(sessionMatch[1]!);
      if (sessionId === undefined) return new Response("Bad Request", { status: 400 });
      if (sessionMatch[2] === "commands") {
        const unsupported = unsupportedMethod(request, ["POST"]);
        return unsupported ?? handleSessionCommand(request, sessionId, dependencies);
      }
      if (sessionMatch[2] === "events") {
        const unsupported = unsupportedMethod(request, ["GET", "HEAD"]);
        if (request.method === "HEAD") {
          return automaticHead(request, (headRequest) =>
            handleSessionEvents(headRequest, sessionId, dependencies),
          );
        }
        return unsupported ?? handleSessionEvents(request, sessionId, dependencies);
      }
      const unsupported = unsupportedMethod(request, ["GET", "HEAD", "PATCH", "DELETE"]);
      if (request.method === "HEAD") {
        return automaticHead(request, (headRequest) =>
          handleSessionResource(headRequest, sessionId, dependencies),
        );
      }
      return unsupported ?? handleSessionResource(request, sessionId, dependencies);
    }

    return notFound();
  };
}
