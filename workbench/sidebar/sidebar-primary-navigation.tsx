"use client";

import { HouseIcon, SearchIcon, ToolboxIcon, WorkflowIcon, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

export type SidebarSection = "workspace" | "toolbox" | "workflows";

interface SidebarNavigationItem {
  id: SidebarSection;
  icon: LucideIcon;
  label: string;
}

export function SidebarPrimaryNavigation({
  activeSection,
  searchOpen,
  onSectionChange,
  onSearchToggle,
}: {
  activeSection: SidebarSection;
  searchOpen: boolean;
  onSectionChange(section: SidebarSection): void;
  onSearchToggle(): void;
}) {
  const { t } = useI18n();
  const items: readonly SidebarNavigationItem[] = [
    {
      id: "workspace",
      icon: HouseIcon,
      label: t("workbench.shell.workspace"),
    },
    {
      id: "toolbox",
      icon: ToolboxIcon,
      label: t("workbench.sidebar.toolbox"),
    },
    {
      id: "workflows",
      icon: WorkflowIcon,
      label: t("workbench.sidebar.workflows"),
    },
  ];
  const searchLabel = t(
    activeSection === "toolbox"
      ? "workbench.sidebar.searchToolbox"
      : activeSection === "workflows"
        ? "workbench.sidebar.searchWorkflows"
        : "workbench.sidebar.search",
  );

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 px-0.5">
      <nav
        aria-label={t("workbench.sidebar.mainNavigation")}
        className="flex min-w-0 items-center gap-1"
      >
        {items.map(({ id, icon: Icon, label }) => {
          const active = id === activeSection;

          return (
            <Button
              key={id}
              type="button"
              variant="ghost"
              aria-current={active ? "page" : undefined}
              aria-label={label}
              title={label}
              className={cn(
                "h-9! w-9 gap-0! overflow-hidden! rounded-xl px-[9px]! text-sm font-semibold transition-[width]! duration-200 ease-out motion-reduce:transition-none! active:translate-y-0!",
                active
                  ? "bg-sidebar-accent hover:bg-sidebar-accent w-28"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => onSectionChange(id)}
            >
              <Icon aria-hidden="true" className="size-[18px]!" />
              <span
                aria-hidden={!active}
                className={cn(
                  "ms-0 max-w-0 overflow-hidden opacity-0 transition-[max-width,margin-inline-start,opacity] duration-200 ease-out motion-reduce:transition-none",
                  active && "ms-1.5 max-w-32 opacity-100",
                )}
              >
                {label}
              </span>
            </Button>
          );
        })}
      </nav>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={searchLabel}
        title={searchLabel}
        aria-expanded={searchOpen}
        className={cn(
          "text-muted-foreground hover:text-foreground ms-auto size-9! rounded-xl transition-none! active:translate-y-0!",
          searchOpen && "bg-sidebar-accent text-sidebar-foreground",
        )}
        onClick={onSearchToggle}
      >
        <SearchIcon aria-hidden="true" className="size-[18px]!" />
      </Button>
    </div>
  );
}
