import { resolveRuntimeUrl } from "../lib/runtime-url";
import {
  RUNTIME_CONNECTION_PROTOCOL_VERSION,
  type RuntimeConnection,
} from "@workbench/runtime-contracts";

export type RuntimeFetchImplementation = (input: URL, init?: RequestInit) => Promise<Response>;

export type RuntimeFetch = (path: string, init?: RequestInit) => Promise<Response>;

/** Resolves a Runtime HTTP endpoint without permitting a caller-selected origin. */
export function resolveRuntimeHttpUrl(connection: RuntimeConnection, path: string): URL {
  return resolveRuntimeUrl(connection, path);
}

/** Resolves a Runtime WebSocket endpoint without embedding desktop credentials. */
export function resolveRuntimeWebSocketUrl(connection: RuntimeConnection, path: string): URL {
  const url = resolveRuntimeUrl(connection, path);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url;
}

/**
 * Creates a small HTTP transport for a particular Runtime connection. Desktop
 * bearer credentials are attached only as a header and always replace a
 * caller-supplied Authorization value; same-origin requests are unmodified.
 */
export function createRuntimeFetch(
  connection: RuntimeConnection,
  fetchImplementation: RuntimeFetchImplementation = globalThis.fetch.bind(globalThis),
): RuntimeFetch {
  return async (path, init) => {
    const url = resolveRuntimeHttpUrl(connection, path);
    if (connection.kind !== "desktop-sidecar") return fetchImplementation(url, init);

    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${connection.accessToken}`);
    return fetchImplementation(url, { ...init, headers });
  };
}

function browserSameOriginTransport(): RuntimeFetch | undefined {
  const origin = (globalThis as typeof globalThis & { location?: { origin?: string } }).location
    ?.origin;
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
