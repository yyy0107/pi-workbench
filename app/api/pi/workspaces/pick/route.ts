import { PiServerError } from "@/runtime/pi/server/core/errors";
import { isTrustedLocalApiRequest } from "@/runtime/pi/server/transport/local-api-request-trust";
import { piErrorResponse } from "@/runtime/pi/server/transport/responses";
import { pickWorkspaceDirectory } from "@/runtime/pi/server/workspaces/workspace-paths";

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
