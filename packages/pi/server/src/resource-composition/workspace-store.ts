import {
  WorkspaceStore as ResourceWorkspaceStore,
  type WorkspaceStoreOptions,
} from "@workbench/pi-resources-server/workspace-store";
import { getStreamHub } from "../streams/stream-hub";
export class WorkspaceStore extends ResourceWorkspaceStore {
  constructor(options: WorkspaceStoreOptions | string) {
    const resolved = typeof options === "string" ? { stateFile: options } : options;
    super({ publishHost: (payload) => getStreamHub().publishHost(payload), ...resolved });
  }
}
