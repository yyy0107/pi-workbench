import { createSession, listSessions, PiServerError } from "@/runtime/pi/server/registry";
import { piErrorResponse } from "@/runtime/pi/server/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await listSessions());
  } catch (error) {
    return piErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => undefined)) as { cwd?: unknown } | undefined;
    if (typeof body?.cwd !== "string") {
      throw new PiServerError("pi_invalid_workspace", 400);
    }
    const session = await createSession(body.cwd);
    return Response.json({ session: session.summary() }, { status: 201 });
  } catch (error) {
    return piErrorResponse(error);
  }
}
