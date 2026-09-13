import {
  WorkbenchAgentCapabilityError,
  type WorkbenchAgentCapabilityErrorCode,
} from "@workbench/agent-runtime-client/capabilities";
import { callRpc, RpcClientError, type RpcCallOptions } from "@workbench/host-client/rpc";

function errorCode(error: RpcClientError): WorkbenchAgentCapabilityErrorCode {
  const code = error.code;
  if (code === "rpc_invalid_response") return "failed";
  if (/busy|in-progress|running/u.test(code)) return "busy";
  if (/conflict|exists|stale/u.test(code)) return "conflict";
  if (/not[-_]found/u.test(code)) return "not-found";
  if (/unavailable|unsupported|readonly/u.test(code)) return "unavailable";
  if (/invalid|bad-request|mismatch/u.test(code)) return "invalid-request";
  if (/forbidden|permission/u.test(code) || error.status === 401 || error.status === 403) {
    return "permission-denied";
  }
  if (/cancelled|canceled/u.test(code)) return "cancelled";
  if (/transport/u.test(code)) return "unavailable";
  if (error.status === 404) return "not-found";
  if (error.status === 409) return "conflict";
  if (error.status === 429) return "busy";
  if ([501, 502, 503, 504].includes(error.status)) return "unavailable";
  if (error.status === 400 || error.status === 422) return "invalid-request";
  return "failed";
}

/** Translate service failures once, before a capability reaches Workbench UI. */
export function projectServiceCapabilityError(error: unknown): WorkbenchAgentCapabilityError {
  if (error instanceof WorkbenchAgentCapabilityError) return error;
  if (error instanceof RpcClientError) {
    const details =
      !error.code.startsWith("rpc_") && Object.keys(error.details).length
        ? Object.freeze({ ...error.details })
        : undefined;
    return new WorkbenchAgentCapabilityError(errorCode(error), details);
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new WorkbenchAgentCapabilityError("cancelled");
  }
  return new WorkbenchAgentCapabilityError("failed");
}

export async function capabilityCall<Value>(operation: () => Promise<Value>): Promise<Value> {
  try {
    return await operation();
  } catch (error) {
    throw projectServiceCapabilityError(error);
  }
}

export function callServiceRpc<Payload, Value>(
  method: string,
  payload: Payload,
  options?: RpcCallOptions,
): Promise<Value> {
  return capabilityCall(() => callRpc<Payload, Value>(method, payload, options));
}
