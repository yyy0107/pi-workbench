import {
  PI_THINKING_LEVELS,
  type PiImageContent,
  type PiModelSelection,
  type PiQueuedPrompt,
} from "@workbench/agent-runtime-pi-protocol/messages";
import {
  cancelSession,
  queuePrompt,
  replacePromptQueue,
  sendPrompt,
  setPromptQueuePaused,
  steerQueuedPrompt,
} from "@/workbench/server/pi/installed-pi-server";
import {
  admitInlineImages,
  InlineImageAdmissionError,
  PiServerError,
  piErrorResponse,
  readTrustedJsonPost,
  RPC_REQUEST_BODY_LIMITS,
} from "@workbench/agent-runtime-pi-server/legacy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
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

export async function POST(request: Request, context: RouteContext) {
  const decoded = await readTrustedJsonPost(request, {
    maxRequestBodyBytes: RPC_REQUEST_BODY_LIMITS.inlineAttachment,
  });
  if (!decoded.ok) return decoded.response;

  try {
    const { id } = await context.params;
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
      await cancelSession(id);
      return Response.json({ ok: true });
    }
    const queueMode = body.type;
    if (queueMode === "steer" || queueMode === "followUp") {
      const prompt = admittedQueuedPrompt(body);
      if (!prompt) throw new PiServerError("pi_invalid_command", 400);
      await queuePrompt(id, queueMode, prompt);
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
      await replacePromptQueue(id, steering as PiQueuedPrompt[], followUp as PiQueuedPrompt[]);
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
      await setPromptQueuePaused(
        id,
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
      await steerQueuedPrompt(
        id,
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
    await sendPrompt(id, body.message, images, body.model as PiModelSelection | undefined);
    return Response.json({ ok: true }, { status: 202 });
  } catch (error) {
    return piErrorResponse(error);
  }
}
