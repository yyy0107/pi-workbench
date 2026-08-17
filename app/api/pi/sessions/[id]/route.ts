import {
  deleteSession,
  getSessionHistory,
  PiServerError,
  renameSession,
} from "@/runtime/pi/server/registry";
import { piErrorResponse } from "@/runtime/pi/server/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    return Response.json(await getSessionHistory(id));
  } catch (error) {
    return piErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { name?: unknown };
    if (typeof body.name !== "string") {
      throw new PiServerError("pi_invalid_session_name", 400);
    }
    await renameSession(id, body.name);
    return Response.json({ ok: true });
  } catch (error) {
    return piErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await deleteSession(id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return piErrorResponse(error);
  }
}
