import {
  PI_THINKING_LEVELS,
  type PiImageContent,
  type PiModelSelection,
  type PiQueuedPrompt,
} from "@/runtime/pi/contracts";
import {
  cancelSession,
  PiServerError,
  queuePrompt,
  replacePromptQueue,
  sendPrompt,
  setPromptQueuePaused,
  steerQueuedPrompt,
} from "@/runtime/pi/server/sessions/session-registry";
import { rejectUntrustedApiRequest } from "@/runtime/pi/server/transport/api-request-guard";
import { piErrorResponse } from "@/runtime/pi/server/transport/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function isImage(value: unknown): value is PiImageContent {
  if (!value || typeof value !== "object") return false;
  const image = value as Partial<PiImageContent>;
  return (
    image.type === "image" && typeof image.data === "string" && typeof image.mimeType === "string"
  );
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

function isQueuedPrompt(value: unknown): value is PiQueuedPrompt {
  if (!value || typeof value !== "object") return false;
  const prompt = value as Partial<PiQueuedPrompt>;
  return (
    typeof prompt.message === "string" &&
    (prompt.images === undefined || (Array.isArray(prompt.images) && prompt.images.every(isImage)))
  );
}

export async function POST(request: Request, context: RouteContext) {
  const rejected = rejectUntrustedApiRequest(request);
  if (rejected) return rejected;
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
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
      await cancelSession(id);
      return Response.json({ ok: true });
    }
    const queueMode = body.type;
    if (queueMode === "steer" || queueMode === "followUp") {
      if (!isQueuedPrompt(body)) throw new PiServerError("pi_invalid_command", 400);
      await queuePrompt(id, queueMode, body);
      return Response.json({ ok: true }, { status: 202 });
    }
    if (body.type === "replaceQueue") {
      if (
        !Array.isArray(body.steering) ||
        !body.steering.every(isQueuedPrompt) ||
        !Array.isArray(body.followUp) ||
        !body.followUp.every(isQueuedPrompt)
      ) {
        throw new PiServerError("pi_invalid_command", 400);
      }
      await replacePromptQueue(id, body.steering, body.followUp);
      return Response.json({ ok: true }, { status: 202 });
    }
    if (body.type === "setQueuePaused") {
      if (
        typeof body.paused !== "boolean" ||
        !Array.isArray(body.steering) ||
        !body.steering.every(isQueuedPrompt) ||
        !Array.isArray(body.followUp) ||
        !body.followUp.every(isQueuedPrompt)
      ) {
        throw new PiServerError("pi_invalid_command", 400);
      }
      await setPromptQueuePaused(id, body.paused, body.steering, body.followUp);
      return Response.json({ ok: true }, { status: 202 });
    }
    if (body.type === "steerQueued") {
      if (
        !isQueuedPrompt(body.prompt) ||
        !Array.isArray(body.steering) ||
        !body.steering.every(isQueuedPrompt) ||
        !Array.isArray(body.followUp) ||
        !body.followUp.every(isQueuedPrompt)
      ) {
        throw new PiServerError("pi_invalid_command", 400);
      }
      await steerQueuedPrompt(id, body.prompt, body.steering, body.followUp);
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

    await sendPrompt(
      id,
      body.message,
      body.images as PiImageContent[] | undefined,
      body.model as PiModelSelection | undefined,
    );
    return Response.json({ ok: true }, { status: 202 });
  } catch (error) {
    return piErrorResponse(error);
  }
}
