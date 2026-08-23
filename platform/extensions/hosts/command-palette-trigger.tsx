"use client";

import { SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";

import { commandPaletteStore } from "./command-palette-store";

export function CommandPaletteTrigger() {
  const { t } = useI18n();
  const label = t("platform.extensions.commandPalette.open");

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={() => commandPaletteStore.setOpen(true)}
    >
      <SearchIcon className="size-4" />
    </Button>
  );
}
