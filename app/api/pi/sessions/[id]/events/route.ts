import { createSessionEventResponse } from "@/runtime/pi/server/streams/legacy-sse";
import { rejectUntrustedApiRequest } from "@/runtime/pi/server/transport/api-request-guard";
import { piErrorResponse } from "@/runtime/pi/server/transport/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const rejected = rejectUntrustedApiRequest(request);
  if (rejected) return rejected;
  try {
    const { id } = await context.params;
    return await createSessionEventResponse(request, id);
  } catch (error) {
    return piErrorResponse(error);
  }
}
