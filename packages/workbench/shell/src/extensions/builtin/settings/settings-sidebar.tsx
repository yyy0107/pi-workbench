"use client";

import { ArrowLeftIcon, SearchIcon } from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";

import { Button, Input } from "../../../ui";
import { useI18n, type LocalizableText } from "../../../i18n";
import { cn } from "../../../utils";
import { useMainViewService, useSettingsRegistry } from "@workbench/extension-host";
import type {
  MainViewSidebarProps,
  SettingsItemDefinition,
  SettingsSectionDefinition,
  SettingsSectionGroupDefinition,
} from "@workbench/extension-sdk";

import { createSettingsMainViewRequest, type SettingsMainViewParams } from "./settings-main-view";

const EMPTY_SECTIONS = Object.freeze([]) as readonly SettingsSectionDefinition[];
const EMPTY_ITEMS = Object.freeze([]) as readonly SettingsItemDefinition[];

interface SettingsNavigationGroup {
  id: string;
  title?: SettingsSectionGroupDefinition["title"];
  sections: SettingsSectionDefinition[];
}

interface SettingsSearchResultGroup {
  section: SettingsSectionDefinition;
  results: SettingsSearchResult[];
}

interface SettingsSearchResult {
  item: SettingsItemDefinition;
  title: LocalizableText;
  description?: LocalizableText;
}

interface SettingsSearchCandidate extends SettingsSearchResult {
  section: SettingsSectionDefinition;
  primary: boolean;
}

function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, "");
}

function matchesSearchText(
  value: LocalizableText | undefined,
  query: string,
  resolve: (message: LocalizableText) => string,
): boolean {
  return value !== undefined && normalizeSearchText(resolve(value)).includes(query);
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

export function SettingsSidebar({
  close,
  onNavigate,
  view,
}: MainViewSidebarProps<SettingsMainViewParams>) {
  const { t, text } = useI18n();
  const mainViews = useMainViewService();
  const registry = useSettingsRegistry();
  const sections = useSyncExternalStore(
    registry.subscribe,
    registry.getSections,
    () => EMPTY_SECTIONS,
  );
  const items = useSyncExternalStore(registry.subscribe, registry.getItems, () => EMPTY_ITEMS);
  const [searchQuery, setSearchQuery] = useState("");
  const activeSection = sections.find(({ id }) => id === view.params.sectionId) ?? sections.at(0);
  const navigationGroups = useMemo(() => groupSettingsSections(sections), [sections]);
  const normalizedQuery = normalizeSearchText(searchQuery);
  const searchResultGroups = useMemo<SettingsSearchResultGroup[]>(() => {
    if (!normalizedQuery) return [];

    const candidates = sections.flatMap<SettingsSearchCandidate>((section) => {
      const parentMatches =
        matchesSearchText(section.title, normalizedQuery, text) ||
        matchesSearchText(section.group?.title, normalizedQuery, text);
      return items.flatMap<SettingsSearchCandidate>((item) => {
        if (item.sectionId !== section.id) return [];
        if (matchesSearchText(item.title, normalizedQuery, text)) {
          return [
            {
              section,
              item,
              title: item.title,
              description: item.description,
              primary: true,
            },
          ];
        }

        const keywordMatches = (item.keywords ?? [])
          .filter((keyword) => matchesSearchText(keyword, normalizedQuery, text))
          .map((keyword) => ({ section, item, title: keyword, primary: true }));
        if (keywordMatches.length > 0) return keywordMatches;

        if (parentMatches) {
          return [
            {
              section,
              item,
              title: item.title,
              description: item.description,
              primary: true,
            },
          ];
        }
        if (matchesSearchText(item.description, normalizedQuery, text)) {
          return [
            {
              section,
              item,
              title: item.title,
              description: item.description,
              primary: false,
            },
          ];
        }
        return [];
      });
    });
    const visibleCandidates = candidates.some(({ primary }) => primary)
      ? candidates.filter(({ primary }) => primary)
      : candidates;

    return sections.flatMap((section) => {
      const results = visibleCandidates
        .filter((candidate) => candidate.section.id === section.id)
        .map(({ item, title, description }) => ({ item, title, description }));
      return results.length > 0 ? [{ section, results }] : [];
    });
  }, [items, normalizedQuery, sections, text]);

  return (
    <nav
      data-settings-sidebar=""
      aria-label={t("extensions.settings.sections")}
      className="bg-sidebar text-sidebar-foreground flex h-full min-h-0 flex-col overflow-hidden"
    >
      <div className="bg-sidebar sticky top-0 z-10 flex shrink-0 flex-col gap-2 px-3 pt-2 pb-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-[var(--sidebar-row-height)] min-h-[var(--sidebar-row-height)] w-full shrink-0 justify-start gap-2 px-2.5"
          onClick={() => {
            close();
            onNavigate?.();
          }}
        >
          <ArrowLeftIcon aria-hidden="true" className="size-4" />
          {t("extensions.settings.backToApp")}
        </Button>
        <div className="relative">
          <SearchIcon
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-[var(--input-control-icon-size)] -translate-y-1/2"
          />
          <Input
            type="search"
            autoComplete="off"
            value={searchQuery}
            aria-label={t("extensions.settings.searchLabel")}
            placeholder={t("extensions.settings.searchPlaceholder")}
            className="ps-9 shadow-none"
            onChange={(event) => setSearchQuery(event.currentTarget.value)}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-6">
        {normalizedQuery ? (
          <div className="flex min-w-0 flex-col gap-5">
            {searchResultGroups.map(({ section, results }) => {
              const Icon = section.icon;
              return (
                <div key={section.id}>
                  <div className="text-muted-foreground mb-1.5 px-2.5 text-xs font-medium">
                    {text(section.title)}
                  </div>
                  <div className="flex flex-col gap-1">
                    {results.map((result, resultIndex) => {
                      const { item } = result;
                      return (
                        <button
                          key={`${item.sectionId}.${item.id}.${resultIndex}`}
                          type="button"
                          data-workbench-selection-surface=""
                          className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex min-h-11 w-full items-start gap-2 rounded-[var(--button-radius)] px-2.5 py-2 text-left transition-colors"
                          onClick={() => {
                            mainViews.open(createSettingsMainViewRequest(section.id, item.id));
                            onNavigate?.();
                          }}
                        >
                          {Icon ? (
                            <Icon
                              aria-hidden="true"
                              className="text-muted-foreground mt-0.5 size-[var(--icon-size-md)] shrink-0"
                            />
                          ) : null}
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium">{text(result.title)}</span>
                            {result.description ? (
                              <span className="text-muted-foreground mt-0.5 line-clamp-2 block text-xs leading-4">
                                {text(result.description)}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-0">
            {navigationGroups.map((group, groupIndex) => (
              <div key={group.id} className={cn(groupIndex > 0 && "mt-5")}>
                {group.title ? (
                  <div className="text-muted-foreground mb-1.5 px-2.5 text-xs font-medium">
                    {text(group.title)}
                  </div>
                ) : null}
                <div className="flex flex-col gap-1">
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
                          "flex h-[var(--sidebar-row-height)] w-full shrink-0 items-center gap-2 rounded-[var(--button-radius)] px-2.5 text-left text-sm transition-colors",
                          active
                            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                            : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                        )}
                        onClick={() => {
                          mainViews.open(createSettingsMainViewRequest(section.id));
                          onNavigate?.();
                        }}
                      >
                        {Icon ? (
                          <Icon
                            aria-hidden="true"
                            className="size-[var(--icon-size-md)] shrink-0"
                          />
                        ) : null}
                        <span className="min-w-0 flex-1 truncate">{text(section.title)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        {normalizedQuery && searchResultGroups.length === 0 ? (
          <p role="status" className="text-muted-foreground px-2.5 py-3 text-sm leading-5">
            {t("extensions.settings.noSearchResults")}
          </p>
        ) : null}
      </div>
    </nav>
  );
}
