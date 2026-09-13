"use client";

import { useWorkspaceI18n } from "../use-i18n";
import { SlotHost } from "@workbench/extension-host/hosts/slot-host";

import { WorkspaceSurfaceMenuItems } from "./workspace-add-menu";

const keepLauncherListOpen = () => undefined;

export function WorkspaceEmptyState() {
  const { t } = useWorkspaceI18n();

  return (
    <div className="flex size-full items-center justify-center px-8 py-16">
      <div
        role="group"
        aria-label={t("rightWorkspace.addSurface")}
        className="flex w-full max-w-md flex-col gap-2"
      >
        <WorkspaceSurfaceMenuItems closeMenu={keepLauncherListOpen} />
        <SlotHost name="workspace.empty.actions" context={{ isOpen: true }} />
      </div>
    </div>
  );
}
