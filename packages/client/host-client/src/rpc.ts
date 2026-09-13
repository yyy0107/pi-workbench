import { createRuntimeFetch, type RuntimeFetch } from "./runtime-fetch";
import { RUNTIME_CONNECTION_PROTOCOL_VERSION } from "@workbench/host-contracts";

function browserSameOriginTransport(): RuntimeFetch | undefined {
  const origin = globalThis.location?.origin;
  if (typeof origin !== "string" || origin === "null") return undefined;

  return createRuntimeFetch({
    kind: "same-origin",
    protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
    httpOrigin: origin,
  });
}

function defaultRuntimeFetch(path: string, init?: RequestInit): Promise<Response> {
  const transport = browserSameOriginTransport();
  return transport ? transport(path, init) : globalThis.fetch(path, init);
}

export function resolveRuntimeFetch(transport?: RuntimeFetch): RuntimeFetch {
  return transport ?? defaultRuntimeFetch;
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface RpcCallOptions {
  rpcId?: string;
  signal?: AbortSignal;
  transport?: RuntimeFetch;
}

export async function callRpc<Payload, Value>(
  method: string,
  payload: Payload,
  options: RpcCallOptions = {},
): Promise<Value> {
  const rpcId = options.rpcId ?? createRpcId(method);
  const response = await resolveRuntimeFetch(options.transport)(`/api/${method}`, {
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
  if (
    !isRecord(body) ||
    body.type !== "server-response" ||
    body.rpcId !== rpcId ||
    !isRecord(body.result)
  ) {
    throw new RpcClientError("rpc_invalid_response", response.status, { method });
  }
  const result = body.result;
  if (result.ok === false) {
    if (
      !isRecord(result.error) ||
      typeof result.error.code !== "string" ||
      typeof result.error.message !== "string" ||
      !isRecord(result.error.details)
    ) {
      throw new RpcClientError("rpc_invalid_response", response.status, { method });
    }
    throw new RpcClientError(
      result.error.code,
      response.status,
      result.error.details,
      result.error.message,
    );
  }
  if (result.ok !== true) {
    throw new RpcClientError("rpc_invalid_response", response.status, { method });
  }
  return result.value as Value;
}
