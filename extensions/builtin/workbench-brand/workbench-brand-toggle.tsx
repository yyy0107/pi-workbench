"use client";

import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { useI18n } from "@/i18n";

export function WorkbenchBrandToggle() {
  const { t } = useI18n();
  const { isMobile, state, toggleSidebar } = useSidebar();

  if (isMobile) return null;

  const expanded = state === "expanded";
  const label = t(expanded ? "workbench.sidebar.collapse" : "workbench.sidebar.expand");
  const ToggleIcon = expanded ? PanelLeftCloseIcon : PanelLeftOpenIcon;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-expanded={expanded}
      aria-label={label}
      title={label}
      onClick={toggleSidebar}
      className="absolute start-[6px] top-[calc(1.25rem-14px)] z-30 size-[28px]! min-h-[28px]! min-w-[28px]! p-0! aria-expanded:bg-transparent! [app-region:no-drag]"
    >
      <span
        aria-hidden="true"
        className="relative flex size-[28px] shrink-0 items-center justify-center"
      >
        <img
          src="/pi-logo-on-light.svg"
          alt=""
          className="absolute inset-0 size-[28px] group-hover/button:opacity-0 group-focus-visible/button:opacity-0 dark:invert"
        />
        <ToggleIcon className="absolute opacity-0 group-hover/button:opacity-100 group-focus-visible/button:opacity-100" />
      </span>
    </Button>
  );
}
