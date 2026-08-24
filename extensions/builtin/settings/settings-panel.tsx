"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { useI18n } from "@/i18n";
import {
  ExtensionErrorBoundary,
  useExtensionErrorReporter,
  useSettingsRegistry,
  type SettingsItemDefinition,
  type SettingsSectionDefinition,
  type SettingsSectionGroupDefinition,
} from "@/platform/extensions";
import { cn } from "@/lib/utils";

const EMPTY_SECTIONS = Object.freeze([]) as readonly SettingsSectionDefinition[];
const EMPTY_ITEMS = Object.freeze([]) as readonly SettingsItemDefinition[];

interface SettingsNavigationGroup {
  id: string;
  title?: SettingsSectionGroupDefinition["title"];
  sections: SettingsSectionDefinition[];
}

function groupSettingsSections(
  sections: readonly SettingsSectionDefinition[],
): SettingsNavigationGroup[] {
  const groups: SettingsNavigationGroup[] = [];
  const groupsById = new Map<string, SettingsNavigationGroup>();

  for (const section of sections) {
    const groupId = section.group ? `group:${section.group.id}` : "ungrouped";
    let group = groupsById.get(groupId);
    if (!group) {
      group = {
        id: groupId,
        title: section.group?.title,
        sections: [],
      };
      groupsById.set(groupId, group);
      groups.push(group);
    }
    group.sections.push(section);
  }

  return groups;
}

export function SettingsPanel() {
  const { t, text } = useI18n();
  const registry = useSettingsRegistry();
  const reportError = useExtensionErrorReporter();
  const sections = useSyncExternalStore(
    registry.subscribe,
    registry.getSections,
    () => EMPTY_SECTIONS,
  );
  const allItems = useSyncExternalStore(registry.subscribe, registry.getItems, () => EMPTY_ITEMS);
  const [activeSectionId, setActiveSectionId] = useState<string>();
  const [activatedSectionIds, setActivatedSectionIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const activeSection = sections.find(({ id }) => id === activeSectionId) ?? sections.at(0);
  const navigationGroups = useMemo(() => groupSettingsSections(sections), [sections]);

  useEffect(() => {
    if (activeSection && activeSection.id !== activeSectionId) {
      setActiveSectionId(activeSection.id);
    }
    if (activeSection && !activatedSectionIds.has(activeSection.id)) {
      setActivatedSectionIds((current) => new Set(current).add(activeSection.id));
    }
  }, [activatedSectionIds, activeSection, activeSectionId]);

  const itemsBySection = useMemo(() => {
    const groupedItems = new Map<string, SettingsItemDefinition[]>();
    for (const item of allItems) {
      const items = groupedItems.get(item.sectionId);
      if (items) items.push(item);
      else groupedItems.set(item.sectionId, [item]);
    }
    return groupedItems;
  }, [allItems]);

  return (
    <div
      data-settings-panel=""
      className="grid size-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-transparent sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:grid-rows-1"
    >
      <nav
        aria-label={t("extensions.settings.sections")}
        className="overflow-x-auto p-2 sm:min-h-0 sm:overflow-y-auto sm:p-3"
      >
        <div className="flex gap-1 sm:flex-col sm:gap-0">
          {navigationGroups.map((group, groupIndex) => (
            <div key={group.id} className={cn("contents sm:block", groupIndex > 0 && "sm:mt-4")}>
              {group.title ? (
                <div className="text-muted-foreground mb-1 hidden px-2.5 text-[11px] font-medium tracking-wide sm:block">
                  {text(group.title)}
                </div>
              ) : null}
              <div className="contents sm:flex sm:flex-col sm:gap-1">
                {group.sections.map((section) => {
                  const Icon = section.icon;
                  const active = section.id === activeSection?.id;

                  return (
                    <button
                      key={section.id}
                      type="button"
                      data-workbench-selection-surface=""
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-9 w-auto shrink-0 items-center gap-2 rounded-xl px-2.5 text-left text-sm transition-colors sm:w-full",
                        active
                          ? "bg-background font-medium text-foreground shadow-sm ring-1 ring-foreground/5"
                          : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
                      )}
                      onClick={() => {
                        setActivatedSectionIds((current) => {
                          if (current.has(section.id)) return current;
                          return new Set(current).add(section.id);
                        });
                        setActiveSectionId(section.id);
                      }}
                    >
                      {Icon ? <Icon className="size-4 shrink-0" /> : null}
                      <span className="min-w-0 flex-1 truncate">{text(section.title)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>

      <div className="min-h-0 overflow-y-auto px-5 py-5 sm:px-6">
        {activeSection ? (
          sections
            .filter(
              (section) => section.id === activeSection.id || activatedSectionIds.has(section.id),
            )
            .map((section) => {
              const items = itemsBySection.get(section.id) ?? EMPTY_ITEMS;
              const active = section.id === activeSection.id;
              const HeaderAction = section.headerAction;
              return (
                <section
                  key={section.id}
                  aria-labelledby={`settings-section-${section.id}`}
                  hidden={!active}
                  inert={!active ? true : undefined}
                >
                  <header className="mb-5">
                    <div className="flex items-center justify-between gap-3">
                      <h2
                        id={`settings-section-${section.id}`}
                        className="min-w-0 text-base font-semibold tracking-tight"
                      >
                        {text(section.title)}
                      </h2>
                      {HeaderAction ? (
                        <ExtensionErrorBoundary
                          contributionId={`${section.id}.header-action`}
                          source="setting"
                          onError={reportError}
                          resetKey={HeaderAction}
                        >
                          <HeaderAction sectionId={section.id} />
                        </ExtensionErrorBoundary>
                      ) : null}
                    </div>
                    {section.description ? (
                      <p className="text-muted-foreground mt-1 text-sm leading-5">
                        {text(section.description)}
                      </p>
                    ) : null}
                  </header>

                  {items.length > 0 ? (
                    <div className="divide-y">
                      {items.map((item) => {
                        const Item = item.component;
                        const contributionId = `${item.sectionId}.${item.id}`;

                        return (
                          <div key={contributionId}>
                            <ExtensionErrorBoundary
                              contributionId={contributionId}
                              source="setting"
                              onError={reportError}
                              resetKey={Item}
                            >
                              <Item sectionId={item.sectionId} itemId={item.id} />
                            </ExtensionErrorBoundary>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-muted-foreground rounded-2xl border border-dashed px-4 py-8 text-center text-sm">
                      {t("extensions.settings.emptySection")}
                    </div>
                  )}
                </section>
              );
            })
        ) : (
          <div className="text-muted-foreground flex size-full items-center justify-center text-sm">
            {t("extensions.settings.empty")}
          </div>
        )}
      </div>
    </div>
  );
}
