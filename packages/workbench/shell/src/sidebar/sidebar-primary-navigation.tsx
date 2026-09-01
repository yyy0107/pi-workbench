"use client";

import { HouseIcon, SearchIcon, ToolboxIcon, WorkflowIcon, type LucideIcon } from "lucide-react";

import { Button } from "../ui/button";
import { useI18n } from "../i18n";
import { cn } from "../utils";

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
      ? "grid-cols-[minmax(var(--icon-frame-size-default),7rem)_var(--icon-frame-size-default)_var(--icon-frame-size-default)]"
      : activeSection === "toolbox"
        ? "grid-cols-[var(--icon-frame-size-default)_minmax(var(--icon-frame-size-default),7rem)_var(--icon-frame-size-default)]"
        : "grid-cols-[var(--icon-frame-size-default)_var(--icon-frame-size-default)_minmax(var(--icon-frame-size-default),7rem)]";

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 ps-4 pe-0.5 md:h-10 md:ps-[calc(var(--icon-frame-size-default)+14px)]">
      <nav
        aria-label={t("workbench.sidebar.mainNavigation")}
        data-active-section={activeSection}
        className={cn(
          "relative isolate grid min-w-0 flex-1 items-center gap-1 transition-[grid-template-columns] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
          navigationGridClass,
        )}
      >
        <span aria-hidden="true" className={styles.selectionIndicator} />

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
              data-selection="none"
              className={cn(
                "relative z-10 w-full justify-start! gap-0! overflow-hidden! rounded-xl bg-transparent! p-0! text-sm font-semibold transition-[background-color,color]! duration-150 ease-out motion-reduce:transition-none! active:translate-y-0!",
                styles.navigationButton,
                active
                  ? "[color:var(--button-foreground-selected)] hover:bg-transparent!"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => onSectionChange(id)}
            >
              <span
                aria-hidden="true"
                className="flex size-[var(--icon-frame-size-default)] shrink-0 items-center justify-center"
              >
                <Icon className={cn("size-[var(--icon-size-lg)]!", styles.icon)} />
              </span>
              <span
                aria-hidden={!active}
                className={cn(
                  "pointer-events-none absolute start-[var(--icon-frame-size-default)] top-[calc(50%+var(--control-text-offset-y))] w-[4.25rem] -translate-x-1 -translate-y-1/2 truncate opacity-0 transition-[opacity,transform] ease-out motion-reduce:transition-none",
                  active
                    ? "translate-x-0 opacity-100 delay-60 duration-140"
                    : "delay-0 duration-80",
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
        className="text-muted-foreground hover:text-foreground ms-auto rounded-xl p-0! transition-none! active:translate-y-0!"
        onClick={onSearchToggle}
      >
        <SearchIcon aria-hidden="true" className="size-[var(--icon-size-lg)]!" />
      </Button>
    </div>
  );
}
