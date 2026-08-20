import { handleSessionExportRequest } from "@/runtime/pi/server/sessions/session-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleSessionExportRequest(request);
}

export function HEAD(request: Request) {
  return handleSessionExportRequest(request);
}
