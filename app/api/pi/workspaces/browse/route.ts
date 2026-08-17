import { browseWorkspaceDirectories } from "@/runtime/pi/server/workspaces";
import { piErrorResponse } from "@/runtime/pi/server/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const path = new URL(request.url).searchParams.get("path") ?? undefined;
    return Response.json(await browseWorkspaceDirectories(path));
  } catch (error) {
    return piErrorResponse(error);
  }
}
