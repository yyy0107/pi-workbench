import { PiServerError, piErrorResponse } from "@workbench/agent-runtime-pi-server/legacy";
import { isTrustedLocalApiRequest } from "@workbench/server-core/request-trust";
import { pickWorkspaceDirectory } from "@/workbench/server/pi/installed-pi-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (!isTrustedLocalApiRequest(request)) {
      throw new PiServerError("pi_workspace_picker_forbidden", 403);
    }

    const workspace = await pickWorkspaceDirectory(request.signal);
    return workspace ? Response.json({ workspace }) : new Response(null, { status: 204 });
  } catch (error) {
    return piErrorResponse(error);
  }
}
