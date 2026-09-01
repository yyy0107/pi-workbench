"use client";

import type { ComponentType, RefObject } from "react";
import { SlotHost } from "@workbench/extension-host/hosts/slot-host";

import { CommandPaletteHost } from "./command-palette-host";

export interface WorkbenchInstallationEffectsProps {
  ownerRootRef: RefObject<HTMLElement | null>;
}

export function WorkbenchGlobalLayer({
  installationEffects: InstallationEffects,
  ownerRootRef,
}: Readonly<{
  installationEffects?: ComponentType<WorkbenchInstallationEffectsProps>;
  ownerRootRef: RefObject<HTMLElement | null>;
}>) {
  return (
    <>
      <SlotHost name="shell.overlay" />
      <CommandPaletteHost ownerRootRef={ownerRootRef} />
      {InstallationEffects ? <InstallationEffects ownerRootRef={ownerRootRef} /> : null}
    </>
  );
}
