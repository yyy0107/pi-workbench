import type { RemoteMachineSummaryV1 } from "@workbench/remote-control-contracts/protocol";
import type { DirectConnectionProfile } from "@workbench/remote-control-client/profiles";

import type { MobileRemoteConnectionStatus } from "../state/remote-client.ts";

const MAXIMUM_MACHINES = 100;

export interface MobileMachineCatalogSnapshot {
  readonly items: readonly RemoteMachineSummaryV1[];
  readonly stale: boolean;
  readonly errorCode?: string;
}

export interface MobileDirectProfileCatalogPort {
  list(): Promise<readonly DirectConnectionProfile[]>;
}

export function markRemoteMachineOnline<Snapshot extends MobileMachineCatalogSnapshot>(
  snapshot: Snapshot,
  machineId: string,
  lastSeenAt: string,
): Snapshot {
  const targetIndex = snapshot.items.findIndex((item) => item.machineId === machineId);
  if (targetIndex < 0) return snapshot;
  const target = snapshot.items[targetIndex];
  if (!snapshot.stale && target?.presence === "online") return snapshot;
  return Object.freeze({
    ...snapshot,
    stale: false,
    items: Object.freeze(
      snapshot.items.map((item, index) =>
        index === targetIndex
          ? Object.freeze({ ...item, presence: "online" as const, lastSeenAt })
          : item,
      ),
    ),
  }) as Snapshot;
}

export function sortRemoteMachines(
  items: readonly RemoteMachineSummaryV1[],
): readonly RemoteMachineSummaryV1[] {
  return Object.freeze(
    [...items].sort((left, right) => {
      const byRecent = right.lastSeenAt.localeCompare(left.lastSeenAt);
      return byRecent === 0 ? left.machineId.localeCompare(right.machineId) : byRecent;
    }),
  );
}

export function canMutateRemoteMachine(machine: RemoteMachineSummaryV1): boolean {
  return (
    machine.presence === "online" &&
    machine.protocolRange.min <= 1 &&
    machine.protocolRange.max >= 1
  );
}

export function mobileMachineConnectionStatus(
  machine: RemoteMachineSummaryV1,
  catalogStale: boolean,
): MobileRemoteConnectionStatus {
  if (machine.presence === "incompatible") return "incompatible";
  if (machine.presence === "reconnecting") return "reconnecting";
  if (machine.presence === "offline") return "offline";
  return catalogStale ? "stale" : "ready";
}

function projectProfile(profile: DirectConnectionProfile): RemoteMachineSummaryV1 {
  const incompatible = profile.connectionState === "incompatible";
  const reconnecting = ["connecting", "authenticating", "synchronizing", "reconnecting"].includes(
    profile.connectionState,
  );
  const online = profile.connectionState === "ready";
  return {
    machineId: profile.machineId,
    displayName: profile.displayName,
    presence: incompatible
      ? "incompatible"
      : reconnecting
        ? "reconnecting"
        : online
          ? "online"
          : "offline",
    protocolRange: profile.protocolRange,
    lastSeenAt: profile.lastSeenAt ?? profile.endpoints[0]?.approvedAt ?? new Date(0).toISOString(),
  };
}

export function createMobileMachinesFeature(options: {
  readonly profiles: MobileDirectProfileCatalogPort;
}) {
  return {
    async load(): Promise<MobileMachineCatalogSnapshot> {
      try {
        const profiles = await options.profiles.list();
        if (profiles.length > MAXIMUM_MACHINES) throw new Error("machine_catalog_invalid");
        return Object.freeze({
          items: sortRemoteMachines(profiles.map(projectProfile)),
          stale: false,
        });
      } catch (error) {
        return Object.freeze({
          items: Object.freeze([]),
          stale: true,
          errorCode: error instanceof Error ? error.message : "machine_catalog_unavailable",
        });
      }
    },
  };
}
