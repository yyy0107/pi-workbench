import { isIP } from "node:net";

import { parseDirectEndpointV1 } from "@workbench/remote-control-contracts/codecs";
import type { DirectEndpointV1 } from "@workbench/remote-control-contracts/protocol";

import { DIRECT_REMOTE_SOCKET_PATH } from "./constants.ts";
import { canonicalizeDirectHost, classifyDirectHost } from "./lib/address.ts";

export { classifyDirectHost } from "./lib/address.ts";

export function parseAllowedDirectEndpoint(value: unknown): DirectEndpointV1 {
  const endpoint = parseDirectEndpointV1(value);
  if (!endpoint) throw new Error("endpoint_not_allowed");
  const host = canonicalizeDirectHost(endpoint.host);
  if (classifyDirectHost(host) !== endpoint.kind) throw new Error("endpoint_kind_mismatch");
  return { kind: endpoint.kind, host, port: endpoint.port };
}

export function createDirectSocketUrl(value: DirectEndpointV1): string {
  const endpoint = parseAllowedDirectEndpoint(value);
  const host = isIP(endpoint.host) === 6 ? `[${endpoint.host}]` : endpoint.host;
  return `ws://${host}:${endpoint.port}${DIRECT_REMOTE_SOCKET_PATH}`;
}

export function formatDirectEndpointForDisplay(value: DirectEndpointV1): string {
  const endpoint = parseAllowedDirectEndpoint(value);
  const host = isIP(endpoint.host) === 6 ? `[${endpoint.host}]` : endpoint.host;
  return `${host}:${endpoint.port}`;
}
