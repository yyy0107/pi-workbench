import {
  PI_THINKING_LEVELS,
  type PiImageContent,
  type PiModelSelection,
} from "@/runtime/pi/contracts";
import { cancelSession, PiServerError, sendPrompt } from "@/runtime/pi/server/registry";
import { piErrorResponse } from "@/runtime/pi/server/responses";

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

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      type?: unknown;
      message?: unknown;
      images?: unknown;
      model?: unknown;
    };

    if (body.type === "cancel") {
      await cancelSession(id);
      return Response.json({ ok: true });
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
