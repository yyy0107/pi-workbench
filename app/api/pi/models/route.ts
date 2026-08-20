import { PiServerError } from "@/runtime/pi/server/core/errors";
import { listModels } from "@/runtime/pi/server/sessions/session-registry";
import { rejectUntrustedApiRequest } from "@/runtime/pi/server/transport/api-request-guard";
import { piErrorResponse } from "@/runtime/pi/server/transport/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const rejected = rejectUntrustedApiRequest(request);
  if (rejected) return rejected;
  try {
    const cwd = new URL(request.url).searchParams.get("cwd");
    if (!cwd) throw new PiServerError("pi_workspace_path_required", 400);
    return Response.json(await listModels(cwd));
  } catch (error) {
    return piErrorResponse(error);
  }
}
