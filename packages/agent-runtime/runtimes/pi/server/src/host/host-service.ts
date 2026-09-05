import path from "node:path";

import { getAgentDir, VERSION as PI_VERSION } from "@earendil-works/pi-coding-agent";

import type { HostDescription } from "@workbench/agent-runtime-pi-protocol/rpc";
import { getAttachedSessionCount, listModels } from "../sessions/session-registry";
import { canOpenHostPath } from "@workbench/local-host-server/directories";
import { ensureWorkbenchBuiltinResources } from "../builtin-resources";

const WORKBENCH_VERSION = process.env.npm_package_version ?? "0.1.0";

/** Stable Host capabilities exposed to transport without leaking process or Pi SDK state. */
export interface HostProtocol {
  describe(): Promise<HostDescription>;
}

export class HostService implements HostProtocol {
  async describe(): Promise<HostDescription> {
    const cwd = process.cwd();
    const userResourceDir = getAgentDir();
    await ensureWorkbenchBuiltinResources(userResourceDir);
    const models = await listModels(cwd).catch(() => undefined);
    return {
      product: "pi-workbench",
      version: WORKBENCH_VERSION,
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
