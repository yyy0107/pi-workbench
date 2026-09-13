import type { RuntimeConnection } from "@workbench/runtime-contracts";

export const LOOPBACK_SIDECAR_ORIGIN = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/?$/;

export function invalidConnection(): never {
  throw new Error("Invalid Runtime connection descriptor.");
}

export function invalidRuntimePath(): never {
  throw new Error("Runtime requests require a root-relative path.");
}

export function runtimeOrigin(connection: RuntimeConnection): URL {
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

export function assertRootRelativePath(path: string): void {
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\")
  ) {
    invalidRuntimePath();
  }
}

export function resolveRuntimeUrl(connection: RuntimeConnection, path: string): URL {
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
