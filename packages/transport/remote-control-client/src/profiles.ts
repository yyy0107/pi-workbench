import type {
  DirectDesktopIdentityV1,
  DirectEndpointV1,
  RemoteProtocolVersionRange,
} from "@workbench/remote-control-contracts/protocol";

import { validateDirectClientEndpoint } from "./endpoint-policy.ts";

export type DirectProfileConnectionState =
  | "offline"
  | "connecting"
  | "pairing"
  | "authenticating"
  | "synchronizing"
  | "ready"
  | "reconnecting"
  | "suspended"
  | "incompatible"
  | "identity-mismatch"
  | "revoked";

export type DirectProfileEvent =
  | "connect"
  | "pair"
  | "authenticate"
  | "synchronize"
  | "ready"
  | "disconnect"
  | "retry"
  | "suspend"
  | "incompatible"
  | "identity-mismatch"
  | "revoke";

export interface DirectProfileEndpoint extends DirectEndpointV1 {
  readonly endpointId: string;
  readonly priority: number;
  readonly approvedAt: string;
  readonly lastSucceededAt?: string;
}

export interface DirectConnectionProfile {
  readonly machineId: string;
  readonly displayName: string;
  readonly desktopEncryptionKeyId: string;
  readonly desktopEncryptionPublicKey: string;
  readonly desktopFingerprint: string;
  readonly deviceId: string;
  readonly authorizationRevision: string;
  readonly endpoints: readonly DirectProfileEndpoint[];
  readonly preferredEndpointId: string;
  readonly protocolRange: RemoteProtocolVersionRange;
  readonly connectionState: DirectProfileConnectionState;
  readonly lastSeenAt?: string;
}

export interface CreateDirectConnectionProfileInput {
  readonly desktop: DirectDesktopIdentityV1;
  readonly deviceId: string;
  readonly authorizationRevision: string;
  readonly endpoints: readonly DirectEndpointV1[];
  readonly protocolRange?: RemoteProtocolVersionRange;
  readonly approvedAt: string;
}

function endpointId(endpoint: DirectEndpointV1): string {
  return `${endpoint.kind}:${endpoint.host.toLowerCase()}:${endpoint.port}`;
}

function rebuildDirectProfileEndpoints(
  profile: DirectConnectionProfile,
  values: readonly DirectEndpointV1[],
  approvedAt: string,
): DirectConnectionProfile {
  if (values.length < 1 || values.length > 8) {
    throw new RangeError("A direct connection profile requires one to eight endpoints");
  }
  if (!Number.isFinite(Date.parse(approvedAt))) {
    throw new RangeError("Direct connection endpoint approval time is invalid");
  }
  const previousById = new Map(
    profile.endpoints.map((endpoint) => [endpoint.endpointId, endpoint]),
  );
  const validated = values.map(validateDirectClientEndpoint);
  const identifiers = validated.map(endpointId);
  if (new Set(identifiers).size !== identifiers.length) {
    throw new Error("Direct connection profile endpoints must be unique");
  }
  const endpoints = validated.map((endpoint, priority) => {
    const id = identifiers[priority]!;
    const previous = previousById.get(id);
    return {
      ...endpoint,
      endpointId: id,
      priority,
      approvedAt: previous?.approvedAt ?? approvedAt,
      ...(previous?.lastSucceededAt ? { lastSucceededAt: previous.lastSucceededAt } : {}),
    };
  });
  return {
    ...profile,
    endpoints,
    preferredEndpointId: endpoints.some(
      (endpoint) => endpoint.endpointId === profile.preferredEndpointId,
    )
      ? profile.preferredEndpointId
      : endpoints[0]!.endpointId,
  };
}

export function createDirectConnectionProfile(
  input: CreateDirectConnectionProfileInput,
): DirectConnectionProfile {
  if (input.endpoints.length < 1 || input.endpoints.length > 8) {
    throw new RangeError("A direct connection profile requires one to eight endpoints");
  }
  if (!Number.isFinite(Date.parse(input.approvedAt))) {
    throw new RangeError("Direct connection profile approval time is invalid");
  }
  const approvedEndpoints = input.endpoints.map(validateDirectClientEndpoint);
  const identifiers = approvedEndpoints.map(endpointId);
  if (new Set(identifiers).size !== identifiers.length) {
    throw new Error("Direct connection profile endpoints must be unique");
  }
  const endpoints = approvedEndpoints.map((endpoint, priority) => ({
    ...endpoint,
    host: endpoint.host.toLowerCase(),
    endpointId: identifiers[priority]!,
    priority,
    approvedAt: input.approvedAt,
  }));
  return {
    machineId: input.desktop.machineId,
    displayName: input.desktop.machineDisplayName,
    desktopEncryptionKeyId: input.desktop.desktopEncryptionKeyId,
    desktopEncryptionPublicKey: input.desktop.desktopEncryptionPublicKey,
    desktopFingerprint: input.desktop.desktopEncryptionKeyFingerprint,
    deviceId: input.deviceId,
    authorizationRevision: input.authorizationRevision,
    endpoints,
    preferredEndpointId: endpoints[0]!.endpointId,
    protocolRange: input.protocolRange ?? { min: 1, max: 1 },
    connectionState: "offline",
  };
}

export function reorderDirectProfileEndpoints(
  profile: DirectConnectionProfile,
  orderedEndpointIds: readonly string[],
): DirectConnectionProfile {
  const currentIds = new Set(profile.endpoints.map((endpoint) => endpoint.endpointId));
  if (
    orderedEndpointIds.length !== currentIds.size ||
    new Set(orderedEndpointIds).size !== currentIds.size ||
    !orderedEndpointIds.every((id) => currentIds.has(id))
  ) {
    throw new Error("Endpoint order must contain every approved endpoint exactly once");
  }
  const byId = new Map(profile.endpoints.map((endpoint) => [endpoint.endpointId, endpoint]));
  const endpoints = orderedEndpointIds.map((id, priority) => ({ ...byId.get(id)!, priority }));
  return { ...profile, endpoints, preferredEndpointId: endpoints[0]!.endpointId };
}

export function addDirectProfileEndpoint(
  profile: DirectConnectionProfile,
  endpoint: DirectEndpointV1,
  approvedAt: string,
): DirectConnectionProfile {
  return rebuildDirectProfileEndpoints(
    profile,
    [...profile.endpoints.map(({ kind, host, port }) => ({ kind, host, port })), endpoint],
    approvedAt,
  );
}

export function replaceDirectProfileEndpoint(
  profile: DirectConnectionProfile,
  endpointIdToReplace: string,
  endpoint: DirectEndpointV1,
  approvedAt: string,
): DirectConnectionProfile {
  const index = profile.endpoints.findIndex((value) => value.endpointId === endpointIdToReplace);
  if (index < 0) throw new Error("connection_endpoint_not_found");
  const endpoints = profile.endpoints.map((value, currentIndex) =>
    currentIndex === index ? endpoint : { kind: value.kind, host: value.host, port: value.port },
  );
  return rebuildDirectProfileEndpoints(profile, endpoints, approvedAt);
}

export function removeDirectProfileEndpoint(
  profile: DirectConnectionProfile,
  endpointIdToRemove: string,
): DirectConnectionProfile {
  if (!profile.endpoints.some((endpoint) => endpoint.endpointId === endpointIdToRemove)) {
    throw new Error("connection_endpoint_not_found");
  }
  if (profile.endpoints.length === 1) {
    throw new Error("connection_endpoint_required");
  }
  return rebuildDirectProfileEndpoints(
    profile,
    profile.endpoints
      .filter((endpoint) => endpoint.endpointId !== endpointIdToRemove)
      .map(({ kind, host, port }) => ({ kind, host, port })),
    profile.endpoints[0]!.approvedAt,
  );
}

export function verifyDirectChallengeIdentity(
  profile: Pick<
    DirectConnectionProfile,
    "machineId" | "desktopEncryptionKeyId" | "desktopFingerprint"
  >,
  challenge: {
    readonly machineId: string;
    readonly desktopEncryptionKeyId: string;
    readonly desktopEncryptionKeyFingerprint: string;
  },
): boolean {
  return (
    profile.machineId === challenge.machineId &&
    profile.desktopEncryptionKeyId === challenge.desktopEncryptionKeyId &&
    profile.desktopFingerprint === challenge.desktopEncryptionKeyFingerprint
  );
}

export function applyDirectProfileEvent(
  state: DirectProfileConnectionState,
  event: DirectProfileEvent,
): { readonly state: DirectProfileConnectionState; readonly reconnectAllowed: boolean } {
  if (event === "identity-mismatch") return { state: "identity-mismatch", reconnectAllowed: false };
  if (event === "revoke") return { state: "revoked", reconnectAllowed: false };
  if (event === "suspend") return { state: "suspended", reconnectAllowed: false };
  if (event === "incompatible") return { state: "incompatible", reconnectAllowed: false };

  if (
    state === "identity-mismatch" ||
    state === "revoked" ||
    state === "suspended" ||
    state === "incompatible"
  ) {
    return { state, reconnectAllowed: false };
  }

  const nextByEvent: Partial<Record<DirectProfileEvent, DirectProfileConnectionState>> = {
    connect: "connecting",
    pair: "pairing",
    authenticate: "authenticating",
    synchronize: "synchronizing",
    ready: "ready",
    disconnect: "offline",
    retry: "reconnecting",
  };
  const next = nextByEvent[event];
  if (!next) throw new Error(`Unsupported direct profile event: ${event}`);
  return { state: next, reconnectAllowed: true };
}
