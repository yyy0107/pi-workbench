import { createSession, listSessions } from "@/workbench/server/pi/installed-pi-server";
import { PiServerError, piErrorResponse } from "@workbench/agent-runtime-pi-server/legacy";
import { rejectUntrustedApiRequest } from "@workbench/server-core/request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const rejected = rejectUntrustedApiRequest(request);
  if (rejected) return rejected;
  try {
    return Response.json(await listSessions());
  } catch (error) {
    return piErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const rejected = rejectUntrustedApiRequest(request);
  if (rejected) return rejected;
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
