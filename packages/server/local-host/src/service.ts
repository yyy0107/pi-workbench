import type { WorkbenchHostDirectoryListing } from "@workbench/host-contracts/runtime-capabilities";
import {
  createHostDirectory,
  listHostDirectory,
  openHostPath,
  pickHostDirectory,
  type CreateHostDirectoryInput,
} from "./host-directories";
export interface LocalHostProtocol {
  pickDirectory(signal: AbortSignal): Promise<{ path: string | null }>;
  listDirectory(
    path: string | undefined,
    signal: AbortSignal,
  ): Promise<WorkbenchHostDirectoryListing>;
  createDirectory(input: CreateHostDirectoryInput): Promise<{ path: string }>;
  openPath(path: string, signal: AbortSignal): Promise<{ opened: true }>;
}
export const localHostService: LocalHostProtocol = Object.freeze({
  pickDirectory: async (signal: AbortSignal) => ({ path: await pickHostDirectory(signal) }),
  listDirectory: listHostDirectory,
  createDirectory: createHostDirectory,
  openPath: (path: string, signal: AbortSignal) => openHostPath(path, { signal }),
});
