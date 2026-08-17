import { piErrorResponse } from "@/runtime/pi/server/responses";
import { createSessionEventResponse } from "@/runtime/pi/server/streams";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    return await createSessionEventResponse(request, id);
  } catch (error) {
    return piErrorResponse(error);
  }
}
