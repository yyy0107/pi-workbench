"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { useI18n } from "@/i18n";
import {
  ExtensionErrorBoundary,
  useExtensionEnvironment,
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
  const { reportError } = useExtensionEnvironment();
  const sections = useSyncExternalStore(
    registry.subscribe,
    registry.getSections,
    () => EMPTY_SECTIONS,
  );
  const allItems = useSyncExternalStore(registry.subscribe, registry.getItems, () => EMPTY_ITEMS);
  const [activeSectionId, setActiveSectionId] = useState<string>();
  const activeSection = sections.find(({ id }) => id === activeSectionId) ?? sections.at(0);
  const navigationGroups = useMemo(() => groupSettingsSections(sections), [sections]);

  useEffect(() => {
    if (activeSection && activeSection.id !== activeSectionId) {
      setActiveSectionId(activeSection.id);
    }
  }, [activeSection, activeSectionId]);

  const items = useMemo(
    () => allItems.filter(({ sectionId }) => sectionId === activeSection?.id),
    [activeSection?.id, allItems],
  );

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
                      onClick={() => setActiveSectionId(section.id)}
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
          <section aria-labelledby={`settings-section-${activeSection.id}`}>
            <header className="mb-5">
              <h2
                id={`settings-section-${activeSection.id}`}
                className="text-base font-semibold tracking-tight"
              >
                {text(activeSection.title)}
              </h2>
              {activeSection.description ? (
                <p className="text-muted-foreground mt-1 text-sm leading-5">
                  {text(activeSection.description)}
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
        ) : (
          <div className="text-muted-foreground flex size-full items-center justify-center text-sm">
            {t("extensions.settings.empty")}
          </div>
        )}
      </div>
    </div>
  );
}
