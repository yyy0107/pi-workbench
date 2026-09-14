import { isIP } from "node:net";

import type { DirectEndpointKindV1 } from "@workbench/remote-control-contracts/protocol";

function parseIpv4(host: string): readonly number[] | undefined {
  if (isIP(host) !== 4) return undefined;
  const octets = host.split(".").map(Number);
  return octets.length === 4 ? octets : undefined;
}

function classifyIpv4(host: string): DirectEndpointKindV1 | undefined {
  const octets = parseIpv4(host);
  if (!octets) return undefined;
  const [first = -1, second = -1] = octets;
  if (first === 10) return "local-network";
  if (first === 172 && second >= 16 && second <= 31) return "local-network";
  if (first === 192 && second === 168) return "local-network";
  if (first === 100 && second >= 64 && second <= 127) return "tailscale";
  return undefined;
}

function classifyIpv6(host: string): DirectEndpointKindV1 | undefined {
  if (isIP(host) !== 6) return undefined;
  const normalized = host.toLowerCase();
  if (normalized.startsWith("fd7a:115c:a1e0:")) return "tailscale";
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return "local-network";
  return undefined;
}

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

function isValidHostname(host: string): boolean {
  return (
    host.length <= 253 &&
    host === host.toLowerCase() &&
    !host.endsWith(".") &&
    host.split(".").every((label) => HOST_LABEL.test(label))
  );
}

export function classifyDirectHost(host: string): DirectEndpointKindV1 | undefined {
  if (typeof host !== "string" || host.length === 0 || host !== host.trim()) return undefined;
  const canonical = host.toLowerCase();
  const ipKind = classifyIpv4(canonical) ?? classifyIpv6(canonical);
  if (ipKind) return ipKind;
  if (isIP(canonical) !== 0 || !isValidHostname(canonical)) return undefined;
  if (!canonical.includes(".")) return "tailscale";
  if (canonical.endsWith(".local")) return "local-network";
  if (canonical.endsWith(".ts.net")) return "tailscale";
  return undefined;
}

export function canonicalizeDirectHost(host: string): string {
  const canonical = host.toLowerCase();
  if (!classifyDirectHost(canonical)) throw new Error("endpoint_not_allowed");
  return canonical;
}
