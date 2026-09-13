"use client";

import type { ComponentType, RefObject } from "react";
import { SlotHost } from "@workbench/extension-host/hosts/slot-host";

import { useTranslationBundle } from "@workbench/i18n";
import { uiTranslationBundle } from "@workbench/ui/i18n";
import { Toaster } from "@workbench/ui";
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
  const { t } = useTranslationBundle(uiTranslationBundle);

  return (
    <>
      <SlotHost name="shell.overlay" />
      <CommandPaletteHost ownerRootRef={ownerRootRef} />
      <Toaster label={t("ui.toast.regionLabel")} closeLabel={t("ui.toast.closeLabel")} />
      {InstallationEffects ? <InstallationEffects ownerRootRef={ownerRootRef} /> : null}
    </>
  );
}
