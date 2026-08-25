"use client";

import { CommandPaletteHost } from "@/platform/extensions/hosts/command-palette-host";
import { SlotHost } from "@/platform/extensions/hosts/slot-host";

export function WorkbenchGlobalLayer() {
  return (
    <>
      <SlotHost name="shell.overlay" />
      <CommandPaletteHost />
    </>
  );
}
