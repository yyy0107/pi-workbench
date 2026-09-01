import { PiServerError } from "../core/errors";

export function piErrorResponse(error: unknown): Response {
  if (error instanceof PiServerError) {
    return Response.json({ error: { code: error.code } }, { status: error.status });
  }
  console.error("[workbench-pi] request failed", error);
  return Response.json({ error: { code: "pi_internal_error" } }, { status: 500 });
}
