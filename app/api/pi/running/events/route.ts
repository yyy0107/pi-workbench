import { piErrorResponse } from "@/runtime/pi/server/responses";
import { createRunningEventResponse } from "@/runtime/pi/server/streams";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  try {
    return createRunningEventResponse(request);
  } catch (error) {
    return piErrorResponse(error);
  }
}
