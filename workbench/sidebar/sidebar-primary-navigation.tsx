"use client";

import { HouseIcon, SearchIcon, ToolboxIcon, WorkflowIcon, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

import styles from "./sidebar-primary-navigation.module.css";

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
  const navigationGridClass =
    activeSection === "workspace"
      ? "grid-cols-[7rem_2.25rem_2.25rem]"
      : activeSection === "toolbox"
        ? "grid-cols-[2.25rem_7rem_2.25rem]"
        : "grid-cols-[2.25rem_2.25rem_7rem]";

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 ps-4 pe-0.5">
      <nav
        aria-label={t("workbench.sidebar.mainNavigation")}
        className={cn(
          "grid min-w-0 items-center gap-1 transition-[grid-template-columns] duration-[240ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
          navigationGridClass,
        )}
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
                "relative h-9! w-full justify-start! gap-0! overflow-hidden! rounded-xl p-0! text-sm font-semibold transition-[background-color,color]! duration-150 ease-out motion-reduce:transition-none! active:translate-y-0!",
                styles.navigationButton,
                active
                  ? "bg-sidebar-accent hover:bg-sidebar-accent"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => onSectionChange(id)}
            >
              <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center">
                <Icon className={cn("size-[18px]!", styles.icon)} />
              </span>
              <span
                aria-hidden={!active}
                className={cn(
                  "pointer-events-none absolute start-9 top-1/2 w-[4.25rem] -translate-y-1/2 truncate opacity-0 transition-opacity duration-150 ease-out motion-reduce:transition-none",
                  active ? "opacity-100 delay-75" : "delay-0",
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
