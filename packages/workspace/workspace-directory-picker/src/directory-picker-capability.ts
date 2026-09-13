import type { RuntimeConnection } from "@workbench/host-contracts";

function isLoopbackHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "[::1]" || hostname === "::1") return true;

  const parts = hostname.split(".");
  return (
    parts.length === 4 &&
    parts[0] === "127" &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  );
}

/**
 * A sidecar is always local to its desktop container, regardless of the renderer's custom-scheme
 * origin. Same-origin Web installations retain the existing loopback-only native picker policy.
 */
export function shouldUseNativeDirectoryPicker(connection: RuntimeConnection): boolean {
  if (connection.kind === "desktop-sidecar") return true;
  try {
    return isLoopbackHostname(new URL(connection.httpOrigin).hostname);
  } catch {
    return false;
  }
}
