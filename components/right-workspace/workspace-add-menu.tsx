"use client";

import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/i18n";
import { ExtensionErrorBoundary, useExtensionEnvironment } from "@/platform/extensions";

import { useWorkspaceSurfaceDefinitions } from "./workspace-context";

interface WorkspaceSurfaceMenuItemsProps {
  closeMenu(): void;
}

export function WorkspaceSurfaceMenuItems({ closeMenu }: WorkspaceSurfaceMenuItemsProps) {
  const definitions = useWorkspaceSurfaceDefinitions();
  const { reportError } = useExtensionEnvironment();
  const contributions = definitions.filter((definition) => definition.menuItem);

  return contributions.map((definition) => {
    const MenuItem = definition.menuItem;
    if (!MenuItem) return null;
    return (
      <ExtensionErrorBoundary
        key={definition.kind}
        contributionId={definition.kind}
        source="workspace"
        onError={reportError}
      >
        <MenuItem closeMenu={closeMenu} />
      </ExtensionErrorBoundary>
    );
  });
}

export function WorkspaceAddMenu() {
  const { t } = useI18n();
  const definitions = useWorkspaceSurfaceDefinitions();
  const [open, setOpen] = useState(false);
  const contributions = definitions.filter((definition) => definition.menuItem);

  if (contributions.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        aria-label={t("rightWorkspace.addSurface")}
        title={t("rightWorkspace.addSurface")}
        className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex size-8 shrink-0 items-center justify-center rounded-lg"
      >
        <PlusIcon className="size-4" />
      </PopoverTrigger>
      <PopoverContent
        role="menu"
        aria-label={t("rightWorkspace.addSurface")}
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-72 gap-1 rounded-2xl p-2"
      >
        <WorkspaceSurfaceMenuItems closeMenu={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
