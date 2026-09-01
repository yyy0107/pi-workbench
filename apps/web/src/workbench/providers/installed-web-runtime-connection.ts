import type { RuntimeConnection } from "@workbench/host-contracts";
import { createSameOriginRuntimeConnection } from "@workbench/shell/runtime-connection";

interface RequestHeadersPort {
  get(name: string): string | null;
}

function firstForwardedValue(value: string | null): string | undefined {
  return value?.split(",", 1)[0]?.trim().toLowerCase();
}

/** Resolve the public same-origin Runtime proxy selected by the Web request owner. */
export function createInstalledWebRuntimeConnection(
  requestHeaders: RequestHeadersPort,
): RuntimeConnection {
  const host = requestHeaders.get("host")?.trim();
  if (!host) throw new Error("The Web Runtime connection requires a request Host header.");

  const forwardedProtocol = firstForwardedValue(requestHeaders.get("x-forwarded-proto"));
  const protocol = forwardedProtocol === "https" ? "https" : "http";
  let origin: URL;
  try {
    origin = new URL(`${protocol}://${host}`);
  } catch {
    throw new Error("The Web Runtime connection received an invalid request Host header.");
  }
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error("The Web Runtime connection received an invalid request Host header.");
  }
  return createSameOriginRuntimeConnection(origin.origin);
}
