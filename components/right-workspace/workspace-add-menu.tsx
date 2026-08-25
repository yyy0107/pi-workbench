"use client";

import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/i18n";
import { useExtensionErrorReporter } from "@/platform/extensions";
import { ExtensionErrorBoundary } from "@/platform/extensions/hosts/extension-error-boundary";

import { useWorkspaceSurfaceDefinitions } from "./workspace-context";

interface WorkspaceSurfaceMenuItemsProps {
  closeMenu(): void;
}

export function WorkspaceSurfaceMenuItems({ closeMenu }: WorkspaceSurfaceMenuItemsProps) {
  const definitions = useWorkspaceSurfaceDefinitions();
  const reportError = useExtensionErrorReporter();
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
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("rightWorkspace.addSurface")}
            title={t("rightWorkspace.addSurface")}
            className="text-muted-foreground hover:text-foreground"
          />
        }
      >
        <PlusIcon className="size-4" />
      </PopoverTrigger>
      <PopoverContent
        role="group"
        aria-label={t("rightWorkspace.addSurface")}
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-44 gap-1 rounded-xl p-1.5"
      >
        <WorkspaceSurfaceMenuItems closeMenu={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
