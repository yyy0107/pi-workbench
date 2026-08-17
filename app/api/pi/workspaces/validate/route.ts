import { PiServerError } from "@/runtime/pi/server/errors";
import { piErrorResponse } from "@/runtime/pi/server/responses";
import { validateWorkspace } from "@/runtime/pi/server/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => undefined)) as { cwd?: unknown } | undefined;
    if (typeof body?.cwd !== "string") {
      throw new PiServerError("pi_workspace_path_required", 400);
    }
    return Response.json({ workspace: validateWorkspace(body.cwd) });
  } catch (error) {
    return piErrorResponse(error);
  }
}
