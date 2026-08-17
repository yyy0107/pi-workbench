import { listModels } from "@/runtime/pi/server/registry";
import { piErrorResponse } from "@/runtime/pi/server/responses";
import { PiServerError } from "@/runtime/pi/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const cwd = new URL(request.url).searchParams.get("cwd");
    if (!cwd) throw new PiServerError("pi_workspace_path_required", 400);
    return Response.json(await listModels(cwd));
  } catch (error) {
    return piErrorResponse(error);
  }
}
