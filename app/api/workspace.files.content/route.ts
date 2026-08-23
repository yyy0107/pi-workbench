import { handleWorkspaceFileContentRequest } from "@/runtime/pi/server/workspaces/workspace-file-content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleWorkspaceFileContentRequest(request);
}

export function HEAD(request: Request) {
  return handleWorkspaceFileContentRequest(request);
}
