import {
  WorkspaceStore as CatalogStore,
  type WorkspaceStoreOptions as CatalogOptions,
  type WorkspaceStoreEvent,
} from "@workbench/workspace-server/catalog";
import type { PiStreamPublisher } from "@workbench/pi-server-ports/streams";
import type { HostStreamPayload } from "@workbench/pi-protocol/stream";
import { getStreamHub } from "../streams/stream-hub";

export function workspaceHostEvent(event: WorkspaceStoreEvent): HostStreamPayload {
  switch (event.type) {
    case "workspace-changed":
      return { ...event, type: "host/workspace-changed" };
    case "workspace-removed":
      return { ...event, type: "host/workspace-removed" };
    case "workspace-order-changed":
      return { ...event, type: "host/workspace-order-changed" };
    case "workspace-pinned-changed":
      return { ...event, type: "host/workspace-pinned-changed" };
    case "session-archive-changed":
      return { ...event, type: "host/session-archive-changed" };
    case "session-pinned-changed":
      return { ...event, type: "host/session-pinned-changed" };
  }
}

export interface WorkspaceStoreOptions extends Omit<CatalogOptions, "onEvent"> {
  publishHost?: PiStreamPublisher["publishHost"];
}

/** Pi projection after catalog persistence and local subscribers; no second store. */
export class WorkspaceStore extends CatalogStore {
  constructor(options: WorkspaceStoreOptions | string) {
    const resolved = typeof options === "string" ? { stateFile: options } : options;
    const { publishHost, ...catalog } = {
      publishHost: (payload: HostStreamPayload) => getStreamHub().publishHost(payload),
      ...resolved,
    };
    super({
      ...catalog,
      onEvent: (event) => {
        publishHost?.(workspaceHostEvent(event));
      },
    });
  }
}
