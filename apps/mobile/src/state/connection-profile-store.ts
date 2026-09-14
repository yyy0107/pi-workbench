import {
  addDirectProfileEndpoint,
  createDirectConnectionProfile,
  removeDirectProfileEndpoint,
  reorderDirectProfileEndpoints,
  replaceDirectProfileEndpoint,
  type DirectConnectionProfile,
} from "@workbench/remote-control-client/profiles";
import type { DirectEndpointV1 } from "@workbench/remote-control-contracts/protocol";

interface DirectProfilePersistencePort {
  list(): Promise<readonly DirectConnectionProfile[]>;
  save(profile: DirectConnectionProfile): Promise<void>;
  remove(machineId: string): Promise<void>;
}

interface DirectProfileSecureStorePort {
  loadMachineKeys<T extends object>(machineId: string): Promise<T | undefined>;
  clearMachine(machineId: string): Promise<void>;
}

interface DirectProfileProjectionPort {
  clearMachine(machineId: string): Promise<void>;
}

const STATES = new Set<DirectConnectionProfile["connectionState"]>([
  "offline",
  "connecting",
  "pairing",
  "authenticating",
  "synchronizing",
  "ready",
  "reconnecting",
  "suspended",
  "incompatible",
  "identity-mismatch",
  "revoked",
]);

function validateProfile(value: DirectConnectionProfile): DirectConnectionProfile {
  const rebuilt = createDirectConnectionProfile({
    desktop: {
      machineId: value.machineId,
      machineDisplayName: value.displayName,
      desktopEncryptionKeyId: value.desktopEncryptionKeyId,
      desktopEncryptionPublicKey: value.desktopEncryptionPublicKey,
      desktopEncryptionKeyFingerprint: value.desktopFingerprint,
    },
    deviceId: value.deviceId,
    authorizationRevision: value.authorizationRevision,
    endpoints: value.endpoints.map(({ kind, host, port }) => ({ kind, host, port })),
    protocolRange: value.protocolRange,
    approvedAt: value.endpoints[0]?.approvedAt ?? "",
  });
  if (
    !STATES.has(value.connectionState) ||
    !value.endpoints.every(
      (endpoint, priority) =>
        endpoint.priority === priority &&
        endpoint.endpointId === rebuilt.endpoints[priority]?.endpointId &&
        Number.isFinite(Date.parse(endpoint.approvedAt)) &&
        (endpoint.lastSucceededAt === undefined ||
          Number.isFinite(Date.parse(endpoint.lastSucceededAt))),
    ) ||
    !value.endpoints.some((endpoint) => endpoint.endpointId === value.preferredEndpointId) ||
    (value.lastSeenAt !== undefined && !Number.isFinite(Date.parse(value.lastSeenAt)))
  ) {
    throw new Error("connection_profile_invalid");
  }
  return Object.freeze({
    ...rebuilt,
    endpoints: Object.freeze(value.endpoints.map((endpoint) => Object.freeze({ ...endpoint }))),
    preferredEndpointId: value.preferredEndpointId,
    connectionState: value.connectionState,
    ...(value.lastSeenAt ? { lastSeenAt: value.lastSeenAt } : {}),
  });
}

export function createMobileConnectionProfileStore(options: {
  readonly persistence: DirectProfilePersistencePort;
  readonly secureStore: DirectProfileSecureStorePort;
  readonly projection: DirectProfileProjectionPort;
}) {
  let operation = Promise.resolve();
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const next = operation.then(work, work);
    operation = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  return {
    async list(): Promise<readonly DirectConnectionProfile[]> {
      const values = await options.persistence.list();
      return Object.freeze(values.map(validateProfile));
    },
    async get(machineId: string): Promise<DirectConnectionProfile | undefined> {
      return (await this.list()).find((profile) => profile.machineId === machineId);
    },
    save(profile: DirectConnectionProfile): Promise<void> {
      return enqueue(() => options.persistence.save(validateProfile(profile)));
    },
    reorder(machineId: string, endpointIds: readonly string[]): Promise<void> {
      return enqueue(async () => {
        const current = (await options.persistence.list()).find(
          (profile) => profile.machineId === machineId,
        );
        if (!current) throw new Error("connection_profile_not_found");
        await options.persistence.save(
          validateProfile(reorderDirectProfileEndpoints(validateProfile(current), endpointIds)),
        );
      });
    },
    saveEndpoint(input: {
      readonly machineId: string;
      readonly endpointId?: string;
      readonly endpoint: DirectEndpointV1;
      readonly verify: (endpoint: DirectEndpointV1) => Promise<void>;
      readonly approvedAt?: Date;
    }): Promise<void> {
      return enqueue(async () => {
        const current = (await options.persistence.list()).find(
          (profile) => profile.machineId === input.machineId,
        );
        if (!current) throw new Error("connection_profile_not_found");
        const validated = validateProfile(current);
        const approvedAt = (input.approvedAt ?? new Date()).toISOString();
        const candidate = validateProfile(
          input.endpointId
            ? replaceDirectProfileEndpoint(validated, input.endpointId, input.endpoint, approvedAt)
            : addDirectProfileEndpoint(validated, input.endpoint, approvedAt),
        );
        const changed = input.endpointId
          ? candidate.endpoints[
              validated.endpoints.findIndex((endpoint) => endpoint.endpointId === input.endpointId)
            ]
          : candidate.endpoints.at(-1);
        if (!changed) throw new Error("connection_endpoint_unchanged");
        await input.verify({ kind: changed.kind, host: changed.host, port: changed.port });
        await options.persistence.save(candidate);
      });
    },
    removeEndpoint(machineId: string, endpointId: string): Promise<void> {
      return enqueue(async () => {
        const current = (await options.persistence.list()).find(
          (profile) => profile.machineId === machineId,
        );
        if (!current) throw new Error("connection_profile_not_found");
        await options.persistence.save(
          validateProfile(removeDirectProfileEndpoint(validateProfile(current), endpointId)),
        );
      });
    },
    noteEndpointSuccess(
      machineId: string,
      endpointId: string,
      at = new Date(),
      displayName?: string,
    ): Promise<void> {
      return enqueue(async () => {
        const current = (await options.persistence.list()).find(
          (profile) => profile.machineId === machineId,
        );
        if (!current) throw new Error("connection_profile_not_found");
        const validated = validateProfile(current);
        if (!validated.endpoints.some((endpoint) => endpoint.endpointId === endpointId)) {
          throw new Error("connection_endpoint_not_found");
        }
        const preferred = reorderDirectProfileEndpoints(validated, [
          endpointId,
          ...validated.endpoints
            .map((endpoint) => endpoint.endpointId)
            .filter((value) => value !== endpointId),
        ]);
        await options.persistence.save({
          ...preferred,
          ...(displayName ? { displayName } : {}),
          connectionState: "ready",
          lastSeenAt: at.toISOString(),
          endpoints: preferred.endpoints.map((endpoint) =>
            endpoint.endpointId === endpointId
              ? { ...endpoint, lastSucceededAt: at.toISOString() }
              : endpoint,
          ),
        });
      });
    },
    remove(machineId: string): Promise<void> {
      return enqueue(async () => {
        await options.secureStore.clearMachine(machineId);
        await options.persistence.remove(machineId);
        await options.projection.clearMachine(machineId);
      });
    },
    async hasUsableKeys(machineId: string): Promise<boolean> {
      return Boolean(await options.secureStore.loadMachineKeys(machineId));
    },
  };
}
