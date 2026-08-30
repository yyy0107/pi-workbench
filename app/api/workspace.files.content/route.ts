import { handleWorkspaceFileContentRequest } from "@/workbench/server/pi/installed-pi-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleWorkspaceFileContentRequest(request);
}

export function HEAD(request: Request) {
  return handleWorkspaceFileContentRequest(request);
}
