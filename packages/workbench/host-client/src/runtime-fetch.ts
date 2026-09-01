import type { RuntimeConnection } from "@workbench/host-contracts";

export type RuntimeFetchImplementation = (input: URL, init?: RequestInit) => Promise<Response>;

export type RuntimeFetch = (path: string, init?: RequestInit) => Promise<Response>;

const LOOPBACK_SIDECAR_ORIGIN = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/?$/;

function invalidConnection(): never {
  throw new Error("Invalid Runtime connection descriptor.");
}

function invalidRuntimePath(): never {
  throw new Error("Runtime requests require a root-relative path.");
}

function runtimeOrigin(connection: RuntimeConnection): URL {
  let origin: URL;
  try {
    origin = new URL(connection.httpOrigin);
  } catch {
    return invalidConnection();
  }

  if (
    (origin.protocol !== "http:" && origin.protocol !== "https:") ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    return invalidConnection();
  }

  if (connection.kind === "desktop-sidecar") {
    const match = LOOPBACK_SIDECAR_ORIGIN.exec(connection.httpOrigin);
    const port = match ? Number(match[1]) : NaN;
    if (!match || port > 65_535) return invalidConnection();
  }

  return origin;
}

function assertRootRelativePath(path: string): void {
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\")
  ) {
    invalidRuntimePath();
  }
}

function resolveRuntimeUrl(connection: RuntimeConnection, path: string): URL {
  assertRootRelativePath(path);
  const origin = runtimeOrigin(connection);
  let url: URL;
  try {
    url = new URL(path, origin);
  } catch {
    return invalidRuntimePath();
  }
  if (url.origin !== origin.origin || url.username || url.password) return invalidRuntimePath();
  return url;
}

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
