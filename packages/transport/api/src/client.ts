import { validateRpcResponseEnvelope } from "../lib/response-envelope";

export type RpcTransport = (path: string, init?: RequestInit) => Promise<Response>;

export class RpcClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(
    code: string,
    status: number,
    details: Record<string, unknown> = {},
    message: string = code,
  ) {
    super(message);
    this.name = "RpcClientError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function createRpcId(method: string): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${method}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

export interface RpcCallOptions {
  transport: RpcTransport;
  rpcId?: string;
  signal?: AbortSignal;
}

export async function callRpc<Payload, Value>(
  method: string,
  payload: Payload,
  options: RpcCallOptions,
): Promise<Value> {
  const rpcId = options.rpcId ?? createRpcId(method);
  const response = await options.transport(`/api/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "client-request", rpcId, method, payload }),
    signal: options.signal,
  });

  if (!response.ok) {
    throw new RpcClientError("rpc_transport_failed", response.status, { method });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new RpcClientError("rpc_invalid_response", response.status, { method });
  }

  const result = validateRpcResponseEnvelope(body, rpcId);
  if (!result) {
    throw new RpcClientError("rpc_invalid_response", response.status, { method });
  }
  if (!result.ok) {
    throw new RpcClientError(
      result.error.code,
      response.status,
      result.error.details,
      result.error.message,
    );
  }
  return result.value as Value;
}
