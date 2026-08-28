"use client";

import { memo, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { useI18n } from "@/i18n";
import { useExtensionErrorReporter, useSettingsRegistry } from "@/platform/extensions";
import type {
  MainViewProps,
  SettingsItemDefinition,
  SettingsSectionDefinition,
} from "@/platform/extensions/authoring";
import { ExtensionErrorBoundary } from "@/platform/extensions/hosts/extension-error-boundary";

import { settingsItemDomId, type SettingsMainViewParams } from "./settings-main-view";

const EMPTY_SECTIONS = Object.freeze([]) as readonly SettingsSectionDefinition[];
const EMPTY_ITEMS = Object.freeze([]) as readonly SettingsItemDefinition[];

interface SettingsSectionContentProps {
  section: SettingsSectionDefinition;
  items: readonly SettingsItemDefinition[];
}

// Keep the expensive item tree separate from the visibility shell. Settings items own local drafts
// and initialization Effects, so inactive sections stay mounted while navigation only updates the
// lightweight panel wrapper.
const SettingsSectionContent = memo(function SettingsSectionContent({
  section,
  items,
}: SettingsSectionContentProps) {
  const { t, text } = useI18n();
  const reportError = useExtensionErrorReporter();
  const HeaderAction = section.headerAction;

  return (
    <>
      <header className="mb-7">
        <div className="flex items-center justify-between gap-3">
          <h1
            id={`settings-section-${section.id}`}
            className="min-w-0 text-xl font-semibold tracking-tight sm:text-2xl"
          >
            {text(section.title)}
          </h1>
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
          <p className="text-muted-foreground mt-2 max-w-3xl text-sm leading-6">
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
              <div
                key={contributionId}
                id={settingsItemDomId(item.sectionId, item.id)}
                role="group"
                aria-label={text(item.title)}
                tabIndex={-1}
                className="scroll-mt-6 outline-none"
              >
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
    </>
  );
});

interface SettingsSectionPanelProps extends SettingsSectionContentProps {
  active: boolean;
}

const SettingsSectionPanel = memo(function SettingsSectionPanel({
  active,
  items,
  section,
}: SettingsSectionPanelProps) {
  return (
    <section
      data-settings-section-panel={section.id}
      aria-labelledby={`settings-section-${section.id}`}
      hidden={!active}
      inert={!active ? true : undefined}
    >
      <SettingsSectionContent section={section} items={items} />
    </section>
  );
});

export function SettingsMainViewContent({ view }: MainViewProps<SettingsMainViewParams>) {
  const { t } = useI18n();
  const registry = useSettingsRegistry();
  const sections = useSyncExternalStore(
    registry.subscribe,
    registry.getSections,
    () => EMPTY_SECTIONS,
  );
  const allItems = useSyncExternalStore(registry.subscribe, registry.getItems, () => EMPTY_ITEMS);
  const [activatedSectionIds, setActivatedSectionIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const activeSection = sections.find(({ id }) => id === view.params.sectionId) ?? sections.at(0);

  useEffect(() => {
    if (!activeSection) return;
    setActivatedSectionIds((current) => {
      if (current.has(activeSection.id)) return current;
      return new Set(current).add(activeSection.id);
    });
  }, [activeSection]);

  useEffect(() => {
    const itemId = view.params.itemId;
    if (!activeSection || !itemId) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(settingsItemDomId(activeSection.id, itemId));
      if (!target) return;
      target.scrollIntoView({ block: "start" });
      target.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeSection, view.params.itemId, view.revision]);

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
      data-settings-main-view=""
      className="h-full min-h-0 overflow-y-auto bg-background px-4 py-6 sm:px-8 sm:py-10 lg:px-12"
    >
      <div className="mx-auto w-full max-w-4xl">
        {activeSection ? (
          sections
            .filter(
              (section) => section.id === activeSection.id || activatedSectionIds.has(section.id),
            )
            .map((section) => {
              const items = itemsBySection.get(section.id) ?? EMPTY_ITEMS;
              const active = section.id === activeSection.id;
              return (
                <SettingsSectionPanel
                  key={section.id}
                  active={active}
                  items={items}
                  section={section}
                />
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
