import { parseDirectEndpointV1 } from "@workbench/remote-control-contracts/codecs";
import type {
  DirectEndpointKindV1,
  DirectEndpointV1,
} from "@workbench/remote-control-contracts/protocol";

function ipv4Octets(host: string): readonly number[] | undefined {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host)) return undefined;
  const octets = host.split(".").map(Number);
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : undefined;
}

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

export function classifyDirectClientHost(host: string): DirectEndpointKindV1 | undefined {
  if (typeof host !== "string" || host.length === 0 || host !== host.trim()) return undefined;
  const canonical = host.toLowerCase();
  const octets = ipv4Octets(canonical);
  if (octets) {
    const [first = -1, second = -1] = octets;
    if (first === 10 || (first === 172 && second >= 16 && second <= 31)) {
      return "local-network";
    }
    if (first === 192 && second === 168) return "local-network";
    if (first === 100 && second >= 64 && second <= 127) return "tailscale";
    return undefined;
  }
  if (canonical.includes(":")) {
    try {
      const parsed = new URL(`http://[${canonical}]/`);
      const normalized = parsed.hostname.slice(1, -1);
      if (normalized.startsWith("fd7a:115c:a1e0:")) return "tailscale";
      if (normalized.startsWith("fc") || normalized.startsWith("fd")) return "local-network";
    } catch {
      return undefined;
    }
    return undefined;
  }
  if (
    canonical.length > 253 ||
    canonical.endsWith(".") ||
    !canonical.split(".").every((label) => HOST_LABEL.test(label))
  ) {
    return undefined;
  }
  if (!canonical.includes(".")) return "tailscale";
  if (canonical.endsWith(".local")) return "local-network";
  if (canonical.endsWith(".ts.net")) return "tailscale";
  return undefined;
}

export function validateDirectClientEndpoint(value: unknown): DirectEndpointV1 {
  const endpoint = parseDirectEndpointV1(value);
  if (!endpoint) throw new Error("endpoint_not_allowed");
  const host = endpoint.host.toLowerCase();
  if (classifyDirectClientHost(host) !== endpoint.kind) {
    throw new Error("endpoint_not_allowed");
  }
  return { kind: endpoint.kind, host, port: endpoint.port };
}
