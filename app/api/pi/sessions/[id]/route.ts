import {
  deleteSession,
  getSessionHistory,
  renameSession,
} from "@/workbench/server/pi/installed-pi-server";
import { PiServerError, piErrorResponse } from "@workbench/agent-runtime-pi-server/legacy";
import { rejectUntrustedApiRequest } from "@workbench/server-core/request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const rejected = rejectUntrustedApiRequest(request);
  if (rejected) return rejected;
  try {
    const { id } = await context.params;
    return Response.json(await getSessionHistory(id));
  } catch (error) {
    return piErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const rejected = rejectUntrustedApiRequest(request);
  if (rejected) return rejected;
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

export async function DELETE(request: Request, context: RouteContext) {
  const rejected = rejectUntrustedApiRequest(request);
  if (rejected) return rejected;
  try {
    const { id } = await context.params;
    await deleteSession(id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return piErrorResponse(error);
  }
}
