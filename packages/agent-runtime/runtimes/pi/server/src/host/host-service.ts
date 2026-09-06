import path from "node:path";

import { getAgentDir, VERSION as PI_VERSION } from "@earendil-works/pi-coding-agent";

import type { HostDescription } from "@workbench/agent-runtime-pi-protocol/rpc";
import { getAttachedSessionCount, listModels } from "../sessions/session-registry";
import { canOpenHostPath } from "@workbench/local-host-server/directories";
import { ensureWorkbenchBuiltinResources } from "../builtin-resources";

/** Stable Host capabilities exposed to transport without leaking process or Pi SDK state. */
export interface HostProtocol {
  describe(): Promise<HostDescription>;
}

export class HostService implements HostProtocol {
  private readonly applicationVersion: string;

  constructor(applicationVersion: string) {
    this.applicationVersion = applicationVersion;
  }

  async describe(): Promise<HostDescription> {
    const cwd = process.cwd();
    const userResourceDir = getAgentDir();
    await ensureWorkbenchBuiltinResources(userResourceDir);
    const models = await listModels(cwd).catch(() => undefined);
    return {
      product: "pi-workbench",
      version: this.applicationVersion,
      piVersion: PI_VERSION,
      cwd,
      userResourceDir,
      userPackageDir: path.join(userResourceDir, "npm"),
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
}
