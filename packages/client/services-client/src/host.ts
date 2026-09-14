import type { WorkbenchServicesCapabilities } from "@workbench/agent-runtime-client/capabilities";
import type {
  WorkbenchHostDirectoryListing as HostDirectoryListing,
  WorkbenchLocalAppsListResult as LocalAppsListValue,
  WorkbenchLocalAppOpenRequest as LocalAppOpenPayload,
  WorkbenchLocalAppOpenResult as LocalAppOpenValue,
} from "@workbench/runtime-contracts/runtime-capabilities";
import { callServiceRpc, capabilityCall } from "./errors";
import type { RpcCallOptions } from "./errors";
import { fetchFileContent, streamFileText } from "./file-content";

export interface DesktopDirectEndpoint {
  readonly kind: "local-network" | "tailscale";
  readonly host: string;
  readonly port: number;
}

export interface DesktopDirectNetworkInterface {
  readonly interfaceId: string;
  readonly interfaceName: string;
  readonly address: string;
  readonly family: "ipv4" | "ipv6";
  readonly kind: DesktopDirectEndpoint["kind"];
}

export interface DesktopRemoteControlSettings {
  readonly enabled: boolean;
  readonly listenerState:
    | "disabled"
    | "starting"
    | "listening"
    | "replacing"
    | "stopping"
    | "failed";
  readonly port: number;
  readonly selectedInterfaceIds: readonly string[];
  readonly revision: string;
  readonly endpoints: readonly DesktopDirectEndpoint[];
}

export interface DesktopRemotePairingStatus {
  readonly pairingId: string;
  readonly state:
    | "created"
    | "claimed"
    | "confirmed"
    | "denied"
    | "expired"
    | "locked"
    | "consumed"
    | "cancelled";
  readonly expiresAt: string;
  readonly qrPayload: string;
  readonly manualCode: string;
  readonly endpoints: readonly DesktopDirectEndpoint[];
  readonly deviceId?: string;
  readonly deviceDisplayName?: string;
  readonly platform?: "ios" | "android";
  readonly safetyCode?: string;
}

export interface DesktopRemotePairingPayload {
  readonly type: "workbench.remote.direct-pairing";
  readonly version: 1;
  readonly pairingId: string;
  readonly pairingSecret: string;
  readonly manualCode: string;
  readonly endpoints: readonly DesktopDirectEndpoint[];
  readonly machineId: string;
  readonly machineDisplayName: string;
  readonly desktopEncryptionKeyId: string;
  readonly desktopEncryptionPublicKey: string;
  readonly desktopEncryptionKeyFingerprint: string;
  readonly protocolRange: { readonly min: number; readonly max: number };
  readonly expiresAt: string;
}

export interface DesktopRemoteDevice {
  readonly deviceId: string;
  readonly deviceDisplayName: string;
  readonly platform: "ios" | "android";
  readonly state: "active" | "revoked";
  readonly revision: string;
  readonly createdAt: string;
  readonly lastSeenAt?: string;
}

export interface DesktopRemoteControlPort {
  describe(): Promise<DesktopRemoteControlSettings>;
  listInterfaces(): Promise<readonly DesktopDirectNetworkInterface[]>;
  updateConfiguration(input: {
    readonly enabled: boolean;
    readonly port: number;
    readonly selectedInterfaceIds: readonly string[];
    readonly expectedRevision: string;
  }): Promise<DesktopRemoteControlSettings>;
  createPairing(): Promise<DesktopRemotePairingStatus>;
  getPairing(pairingId: string): Promise<DesktopRemotePairingStatus>;
  confirmPairing(pairingId: string, safetyCode: string): Promise<void>;
  rejectPairing(pairingId: string): Promise<void>;
  cancelPairing(pairingId: string): Promise<void>;
  listDevices(): Promise<readonly DesktopRemoteDevice[]>;
  revokeDevice(deviceId: string, expectedRevision: string): Promise<void>;
  resetIdentity(): Promise<void>;
}

export function readDesktopRemoteControlPort(
  value?: unknown,
): DesktopRemoteControlPort | undefined {
  const candidate =
    value ??
    (globalThis as { window?: { workbenchDesktop?: { remoteControl?: unknown } } }).window
      ?.workbenchDesktop?.remoteControl;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return undefined;
  const port = candidate as Partial<DesktopRemoteControlPort>;
  if (
    typeof port.describe !== "function" ||
    typeof port.listInterfaces !== "function" ||
    typeof port.updateConfiguration !== "function" ||
    typeof port.createPairing !== "function" ||
    typeof port.getPairing !== "function" ||
    typeof port.confirmPairing !== "function" ||
    typeof port.rejectPairing !== "function" ||
    typeof port.cancelPairing !== "function" ||
    typeof port.listDevices !== "function" ||
    typeof port.revokeDevice !== "function" ||
    typeof port.resetIdentity !== "function"
  ) {
    return undefined;
  }
  return port as DesktopRemoteControlPort;
}

export function localFileContentUrl(path: string): string {
  return `/api/host.files.content?${new URLSearchParams({ path })}`;
}

export async function pickHostDirectory(options?: RpcCallOptions): Promise<string | undefined> {
  const { path } = await callServiceRpc<Record<string, never>, { path: string | null }>(
    "host.pickDirectory",
    {},
    options,
  );
  return path ?? undefined;
}

export function listHostDirectory(
  path?: string,
  options?: RpcCallOptions,
): Promise<HostDirectoryListing> {
  return callServiceRpc("host.listDirectory", path === undefined ? {} : { path }, options);
}

export function createHostDirectory(
  path: string,
  name: string,
  options?: RpcCallOptions,
): Promise<{ path: string }> {
  return callServiceRpc("host.createDirectory", { path, name }, options);
}

export function openHostPath(path: string, options?: RpcCallOptions): Promise<{ opened: true }> {
  return callServiceRpc("host.openPath", { path }, options);
}

export function listLocalApps(options?: RpcCallOptions): Promise<LocalAppsListValue> {
  return callServiceRpc("host.localApps.list", {}, options);
}

export function refreshLocalApps(options?: RpcCallOptions): Promise<LocalAppsListValue> {
  return callServiceRpc("host.localApps.refresh", {}, options);
}

export function openLocalApp(
  payload: LocalAppOpenPayload,
  options?: RpcCallOptions,
): Promise<LocalAppOpenValue> {
  return callServiceRpc("host.localApps.open", payload, options);
}

export function createHostClient(
  rpcOptions: Readonly<RpcCallOptions> = {},
): WorkbenchServicesCapabilities["host"] {
  const options = Object.freeze({ ...rpcOptions });
  return Object.freeze({
    files: {
      listDirectory: (path) => callServiceRpc("host.files.list", { path }, options),
      describeFile: (path) => callServiceRpc("host.files.describe", { path }, options),
      readFile: (path) => callServiceRpc("host.files.read", { path }, options),
      writeFile: (path, content, expectedVersion) =>
        callServiceRpc("host.files.write", { path, content, expectedVersion }, options),
      fileContentUrl: localFileContentUrl,
      fetchFileContent: (path, requestOptions) =>
        capabilityCall(() =>
          fetchFileContent(localFileContentUrl(path), { ...options, ...requestOptions }),
        ),
      streamFileText: (path, streamOptions) =>
        capabilityCall(() =>
          streamFileText(localFileContentUrl(path), {
            ...streamOptions,
            transport: options.transport,
          }),
        ),
    },
    pickDirectory: (requestOptions) =>
      capabilityCall(() =>
        pickHostDirectory({ ...options, signal: requestOptions?.signal ?? options.signal }),
      ),
    listDirectory: (path?: string) => capabilityCall(() => listHostDirectory(path, options)),
    createDirectory: async (path: string, name: string) =>
      (await capabilityCall(() => createHostDirectory(path, name, options))).path,
    openPath: async (path: string) => {
      await capabilityCall(() => openHostPath(path, options));
    },
    listLocalApps: async () => (await capabilityCall(() => listLocalApps(options))).apps,
    openLocalApp: async (request) => {
      await capabilityCall(() => openLocalApp(request, options));
    },
  });
}
