import { createRunningEventResponse } from "@/runtime/pi/server/streams/legacy-sse";
import { rejectUntrustedApiRequest } from "@/runtime/pi/server/transport/api-request-guard";
import { piErrorResponse } from "@/runtime/pi/server/transport/responses";

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
