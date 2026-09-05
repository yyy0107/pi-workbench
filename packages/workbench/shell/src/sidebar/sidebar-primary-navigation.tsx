"use client";

import { SearchIcon } from "lucide-react";

import type { SidebarSectionDefinition } from "@workbench/extension-sdk";

import { Button } from "../ui/button";
import { useI18n } from "../i18n";
import { cn } from "../utils";

import styles from "./sidebar-primary-navigation.module.css";

export function SidebarPrimaryNavigation({
  activeSectionId,
  sections,
  searchOpen,
  onSectionChange,
  onSearchToggle,
}: {
  activeSectionId?: string;
  sections: readonly SidebarSectionDefinition[];
  searchOpen: boolean;
  onSectionChange(sectionId: string): void;
  onSearchToggle(): void;
}) {
  const { t, text } = useI18n();
  const activeSection = sections.find(({ id }) => id === activeSectionId);
  const searchLabel = activeSection?.search ? text(activeSection.search.label) : "";

  return (
    <div className="mb-2 flex h-11 shrink-0 items-center gap-1 ps-4 pe-0.5 sm:h-10 sm:ps-[calc(var(--icon-frame-size-default)+14px)]">
      <nav
        aria-label={t("workbench.sidebar.mainNavigation")}
        data-active-section={activeSectionId}
        className="relative isolate flex min-w-0 flex-1 items-center gap-1"
      >
        {sections.map(({ id, icon: Icon, title }) => {
          const active = id === activeSectionId;
          const label = text(title);

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
                "relative z-10 min-w-[var(--icon-frame-size-default)] shrink justify-start! gap-0! overflow-hidden! rounded-xl p-0! text-sm font-semibold transition-[width,background-color,color]! duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none!",
                styles.navigationButton,
                active
                  ? "w-28 [background:var(--button-background-selected)]! [color:var(--button-foreground-selected)] hover:[background:var(--button-background-selected)]!"
                  : "text-muted-foreground hover:text-foreground w-[var(--icon-frame-size-default)] bg-transparent!",
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
                  "pointer-events-none absolute start-[var(--icon-frame-size-default)] end-3 top-[calc(50%+var(--control-text-offset-y))] -translate-x-1 -translate-y-1/2 truncate opacity-0 transition-[opacity,transform] ease-out motion-reduce:transition-none",
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

      {activeSection?.search ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={searchLabel}
          title={searchLabel}
          aria-expanded={searchOpen}
          className="text-muted-foreground hover:text-foreground ms-auto rounded-xl p-0! transition-none!"
          onClick={onSearchToggle}
        >
          <SearchIcon aria-hidden="true" className="size-[var(--icon-size-lg)]!" />
        </Button>
      ) : null}
    </div>
  );
}
