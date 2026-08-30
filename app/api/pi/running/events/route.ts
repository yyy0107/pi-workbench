import { rejectUntrustedApiRequest } from "@workbench/server-core/request-guard";
import { piErrorResponse } from "@workbench/agent-runtime-pi-server/legacy";
import { createRunningEventResponse } from "@/workbench/server/pi/installed-pi-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const rejected = rejectUntrustedApiRequest(request);
  if (rejected) return rejected;
  try {
    return createRunningEventResponse(request);
  } catch (error) {
    return piErrorResponse(error);
  }
}
