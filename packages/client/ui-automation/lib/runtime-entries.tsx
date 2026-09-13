"use client";

import { useLayoutEffect } from "react";
import {
  createDisposable,
  disposeAll,
  type Disposable,
  type ExtensionContext,
} from "@workbench/extension-sdk";

/** Keep settings/navigation/commands out of the existing registries until their capability exists. */
export function registerRuntimeEntries(
  context: ExtensionContext,
  id: string,
  useAvailable: () => boolean,
  register: () => readonly Disposable[],
): Disposable {
  let entries: readonly Disposable[] = [];
  let disposed = false;

  function RuntimeEntries() {
    const available = useAvailable();
    useLayoutEffect(() => {
      if (!available || disposed) return;
      entries = register();
      return () => {
        disposeAll(entries);
        entries = [];
      };
    }, [available]);
    return null;
  }

  const slot = context.slots.register("shell.overlay", { id, component: RuntimeEntries });
  return createDisposable(() => {
    disposed = true;
    disposeAll([slot, ...entries]);
    entries = [];
  });
}
