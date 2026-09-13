import type { RpcError } from "../src/contracts";

export type ValidatedRpcResult = { ok: true; value: unknown } | { ok: false; error: RpcError };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateRpcResponseEnvelope(
  body: unknown,
  rpcId: string,
): ValidatedRpcResult | undefined {
  if (
    !isRecord(body) ||
    body.type !== "server-response" ||
    body.rpcId !== rpcId ||
    !isRecord(body.result)
  ) {
    return undefined;
  }

  const result = body.result;
  if (result.ok === false) {
    if (
      !isRecord(result.error) ||
      typeof result.error.code !== "string" ||
      typeof result.error.message !== "string" ||
      !isRecord(result.error.details)
    ) {
      return undefined;
    }
    return {
      ok: false,
      error: {
        code: result.error.code,
        message: result.error.message,
        details: result.error.details,
      },
    };
  }

  if (result.ok !== true) return undefined;
  return { ok: true, value: result.value };
}
