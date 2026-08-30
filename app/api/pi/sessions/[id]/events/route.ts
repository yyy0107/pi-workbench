import { rejectUntrustedApiRequest } from "@workbench/server-core/request-guard";
import { piErrorResponse } from "@workbench/agent-runtime-pi-server/legacy";
import { createSessionEventResponse } from "@/workbench/server/pi/installed-pi-server";

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
