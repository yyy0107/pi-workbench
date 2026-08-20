"use client";

import { CommandPaletteHost, SlotHost } from "@/platform/extensions";

export function WorkbenchGlobalLayer() {
  return (
    <>
      <SlotHost name="shell.overlay" />
      <CommandPaletteHost />
    </>
  );
}
