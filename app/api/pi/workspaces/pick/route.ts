import { PiServerError } from "@/runtime/pi/server/errors";
import { piErrorResponse } from "@/runtime/pi/server/responses";
import { pickWorkspaceDirectory } from "@/runtime/pi/server/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) {
      throw new PiServerError("pi_workspace_picker_forbidden", 403);
    }

    const workspace = await pickWorkspaceDirectory();
    return workspace ? Response.json({ workspace }) : new Response(null, { status: 204 });
  } catch (error) {
    return piErrorResponse(error);
  }
}
