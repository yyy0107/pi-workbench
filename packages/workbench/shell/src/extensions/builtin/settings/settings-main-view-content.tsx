"use client";

import { memo, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { useI18n } from "../../../i18n";
import { useExtensionErrorReporter, useSettingsRegistry } from "@workbench/extension-host";
import type {
  MainViewProps,
  SettingsItemDefinition,
  SettingsSectionDefinition,
} from "@workbench/extension-sdk";
import { ExtensionErrorBoundary } from "@workbench/extension-host/hosts/extension-error-boundary";

import type { SettingsMainViewParams } from "./settings-main-view";

const EMPTY_SECTIONS = Object.freeze([]) as readonly SettingsSectionDefinition[];
const EMPTY_ITEMS = Object.freeze([]) as readonly SettingsItemDefinition[];

interface SettingsSectionContentProps {
  domScopeId: string;
  section: SettingsSectionDefinition;
  items: readonly SettingsItemDefinition[];
}

// Keep the expensive item tree separate from the visibility shell. Settings items own local drafts
// and initialization Effects, so inactive sections stay mounted while navigation only updates the
// lightweight panel wrapper.
const SettingsSectionContent = memo(function SettingsSectionContent({
  domScopeId,
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
            id={`${domScopeId}-section-${encodeURIComponent(section.id)}`}
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
                data-settings-item-section={item.sectionId}
                data-settings-item-id={item.id}
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
  domScopeId,
  items,
  section,
}: SettingsSectionPanelProps) {
  return (
    <section
      data-settings-section-panel={section.id}
      aria-labelledby={`${domScopeId}-section-${encodeURIComponent(section.id)}`}
      hidden={!active}
      inert={!active ? true : undefined}
    >
      <SettingsSectionContent domScopeId={domScopeId} section={section} items={items} />
    </section>
  );
});

export function SettingsMainViewContent({ view }: MainViewProps<SettingsMainViewParams>) {
  const { t } = useI18n();
  const domScopeId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
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
      const root = rootRef.current;
      if (!root) return;
      const target = Array.from(
        root.querySelectorAll<HTMLElement>("[data-settings-item-section][data-settings-item-id]"),
      ).find(
        (candidate) =>
          candidate.dataset.settingsItemSection === activeSection.id &&
          candidate.dataset.settingsItemId === itemId,
      );
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
    <div className="flex h-full min-h-0 min-w-0">
      <div
        ref={rootRef}
        data-settings-main-view=""
        data-workbench-glass-surface=""
        className="h-full min-h-0 min-w-0 flex-1 overflow-y-auto bg-background px-4 [scrollbar-gutter:stable_both-edges] sm:px-8 lg:px-12"
      >
        <div className="mx-auto w-full max-w-4xl py-6 sm:py-10">
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
                    domScopeId={domScopeId}
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
    </div>
  );
}
