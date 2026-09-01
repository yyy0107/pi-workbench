"use client";

import { useMemo } from "react";

import { usePiSessionManager } from "../runtime/context";
import {
  createPiHostDirectory,
  describePiHost,
  listPiHostDirectory,
  listPiLocalApps,
  openPiHostPath,
  openPiLocalApp,
  pickPiHostDirectory,
  refreshPiLocalApps,
} from "../transport/api";

export {
  createPiHostDirectory,
  describePiHost,
  listPiHostDirectory,
  listPiLocalApps,
  openPiHostPath,
  openPiLocalApp,
  pickPiHostDirectory,
  refreshPiLocalApps,
} from "../transport/api";
export { usePiHostDescription } from "../runtime/context";

/** Bind host-owned filesystem/application actions to this installation's runtime transport. */
export function usePiHostClient() {
  const manager = usePiSessionManager();
  return useMemo(() => {
    const options = manager.rpcTransportOptions;
    return {
      describe: () => describePiHost(options),
      pickDirectory: () => pickPiHostDirectory(options),
      listDirectory: (path?: string) => listPiHostDirectory(path, options),
      createDirectory: (path: string, name: string) => createPiHostDirectory(path, name, options),
      openPath: (path: string) => openPiHostPath(path, options),
      listLocalApps: () => listPiLocalApps(options),
      refreshLocalApps: () => refreshPiLocalApps(options),
      openLocalApp: (payload: Parameters<typeof openPiLocalApp>[0]) =>
        openPiLocalApp(payload, options),
    };
  }, [manager]);
}
