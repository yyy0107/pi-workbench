"use client";

import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

import { Button } from "../../../ui/button";
import { useSidebar } from "../../../ui/sidebar";
import { useI18n } from "../../../i18n";
import { useWorkbenchBranding } from "../../../presentation";
import { cn } from "../../../utils";
import { useMainViewService } from "@workbench/extension-host";

export function WorkbenchBrandToggle() {
  const { t } = useI18n();
  const { productLogoUrl } = useWorkbenchBranding();
  const { isMobile, state, toggleSidebar } = useSidebar();
  const mainViews = useMainViewService();
  const activeMainView = useSyncExternalStore(
    mainViews.subscribe,
    mainViews.getSnapshot,
    mainViews.getInitialSnapshot,
  );

  if (isMobile) return null;

  const productIconHidden = activeMainView?.chrome?.productIcon === "hidden";
  if (productIconHidden && state === "expanded") return null;

  const expanded = state === "expanded";
  const label = t(expanded ? "workbench.sidebar.collapse" : "workbench.sidebar.expand");
  const ToggleIcon = expanded ? PanelLeftCloseIcon : PanelLeftOpenIcon;
  const showsProductLogo = !productIconHidden && Boolean(productLogoUrl);

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
        {showsProductLogo ? (
          <img
            src={productLogoUrl}
            alt=""
            className="absolute inset-0 size-full group-hover/button:opacity-0 group-focus-visible/button:opacity-0 dark:invert"
          />
        ) : null}
        <ToggleIcon
          className={cn(
            "absolute",
            !showsProductLogo
              ? "opacity-100"
              : "opacity-0 group-hover/button:opacity-100 group-focus-visible/button:opacity-100",
          )}
        />
      </span>
    </Button>
  );
}
