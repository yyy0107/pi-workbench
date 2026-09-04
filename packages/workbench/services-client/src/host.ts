import type { WorkbenchServicesCapabilities } from "@workbench/agent-runtime-client/capabilities";
import type {
  WorkbenchHostDirectoryListing as HostDirectoryListing,
  WorkbenchLocalAppsListResult as LocalAppsListValue,
  WorkbenchLocalAppOpenRequest as LocalAppOpenPayload,
  WorkbenchLocalAppOpenResult as LocalAppOpenValue,
} from "@workbench/host-contracts/runtime-capabilities";
import { callServiceRpc, capabilityCall } from "./errors";
import type { RpcCallOptions } from "@workbench/host-client/rpc";

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
    pickDirectory: () => capabilityCall(() => pickHostDirectory(options)),
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
