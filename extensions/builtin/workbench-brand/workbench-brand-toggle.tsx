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
      data-frame="none"
      data-selection="none"
      aria-expanded={expanded}
      aria-label={label}
      title={label}
      onClick={toggleSidebar}
      className="absolute start-[6px] top-[calc((2.5rem-var(--icon-frame-size-default))/2)] z-30 p-0! [app-region:no-drag]"
    >
      <span
        aria-hidden="true"
        className="relative flex size-full shrink-0 items-center justify-center"
      >
        <img
          src="/pi-logo-on-light.svg"
          alt=""
          className="absolute inset-0 size-full group-hover/button:opacity-0 group-focus-visible/button:opacity-0 dark:invert"
        />
        <ToggleIcon className="absolute opacity-0 group-hover/button:opacity-100 group-focus-visible/button:opacity-100" />
      </span>
    </Button>
  );
}
