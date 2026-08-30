import path from "node:path";

import { getAgentDir, VERSION as PI_VERSION } from "@earendil-works/pi-coding-agent";

import type {
  HostDescription,
  HostDirectoryListing,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import { getAttachedSessionCount, listModels } from "../sessions/session-registry";
import {
  canOpenHostPath,
  createHostDirectory,
  type CreateHostDirectoryInput,
  listHostDirectory,
  openHostPath,
  pickHostDirectory,
} from "./host-directories";

const WORKBENCH_VERSION = process.env.npm_package_version ?? "0.1.0";

/** Stable Host capabilities exposed to transport without leaking process or Pi SDK state. */
export interface HostProtocol {
  describe(): Promise<HostDescription>;
  pickDirectory(signal: AbortSignal): Promise<{ path: string | null }>;
  listDirectory(path: string | undefined, signal: AbortSignal): Promise<HostDirectoryListing>;
  createDirectory(input: CreateHostDirectoryInput): Promise<{ path: string }>;
  openPath(path: string, signal: AbortSignal): Promise<{ opened: true }>;
}

export class HostService implements HostProtocol {
  async describe(): Promise<HostDescription> {
    const cwd = process.cwd();
    const models = await listModels(cwd).catch(() => undefined);
    return {
      product: "pi-workbench",
      version: WORKBENCH_VERSION,
      piVersion: PI_VERSION,
      cwd,
      userPackageDir: path.join(getAgentDir(), "npm"),
      ...(models?.defaultModel
        ? {
            provider: models.defaultModel.provider,
            model: models.defaultModel.modelId,
          }
        : {}),
      attachedSessions: getAttachedSessionCount(),
      canOpenPath: canOpenHostPath(),
    };
  }

  async pickDirectory(signal: AbortSignal): Promise<{ path: string | null }> {
    return { path: await pickHostDirectory(signal) };
  }

  listDirectory(path: string | undefined, signal: AbortSignal): Promise<HostDirectoryListing> {
    return listHostDirectory(path, signal);
  }

  createDirectory(input: CreateHostDirectoryInput): Promise<{ path: string }> {
    return createHostDirectory(input);
  }

  openPath(path: string, signal: AbortSignal): Promise<{ opened: true }> {
    return openHostPath(path, { signal });
  }
}
