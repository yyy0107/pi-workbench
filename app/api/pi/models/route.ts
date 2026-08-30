import { PiServerError, piErrorResponse } from "@workbench/agent-runtime-pi-server/legacy";
import { rejectUntrustedApiRequest } from "@workbench/server-core/request-guard";
import { listModels } from "@/workbench/server/pi/installed-pi-server";

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
