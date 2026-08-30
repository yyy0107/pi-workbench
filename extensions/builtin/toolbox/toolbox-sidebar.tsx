"use client";

import {
  ChevronRightIcon,
  DownloadIcon,
  FileTextIcon,
  PackageIcon,
  PackagePlusIcon,
  PlugIcon,
  StoreIcon,
  WandSparklesIcon,
  type LucideIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { collapsePanel } from "@/components/elements/surfaces";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { defineMessage, useI18n, type LocalizableText } from "@/i18n";
import { cn } from "@/lib/utils";
import { useMainViewService, type SlotPropsMap } from "@/platform/extensions";
import type { PiPackageCatalogItemView } from "@/workbench/runtime-contributions/pi/protocol/rpc";

import {
  packageSurfaceParams,
  sectionForCapability,
  type ToolboxCapabilitySurfaceParams,
  type ToolboxMainSection,
} from "./toolbox-capability";
import { useToolboxCatalogs, type ToolboxCapabilityItem } from "./toolbox-catalog";
import { usePiPackageCatalog } from "./use-pi-package-catalog";
import { usePiPackageUpdates } from "./use-pi-package-updates";
import { toolboxScopeTarget } from "./toolbox-scope";
import { ToolboxScopeSelect } from "./toolbox-scope-select";
import { useToolboxScope } from "./toolbox-scope-store";

const TOOLBOX_SECTION_TITLES = {
  skills: defineMessage("extensions.toolbox.skills.title"),
  "component-extensions": defineMessage("extensions.toolbox.componentExtensions.title"),
  extensions: defineMessage("extensions.toolbox.extensions.title"),
  prompts: defineMessage("extensions.toolbox.prompts.title"),
  packages: defineMessage("extensions.toolbox.packages.title"),
  updates: defineMessage("extensions.toolbox.updates"),
} satisfies Readonly<Record<ToolboxMainSection, LocalizableText>>;

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-muted-foreground flex h-9 shrink-0 items-center px-2 text-sm font-medium">
      {children}
    </h2>
  );
}

function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="text-muted-foreground px-2 py-3 text-xs leading-5" role="status">
      {children}
    </p>
  );
}

function CatalogSkeleton() {
  return (
    <div className="flex flex-col gap-[2px]" aria-hidden="true">
      {[0, 1, 2].map((item) => (
        <div key={item} className="flex h-11 items-center px-1.5">
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-1.5 h-2.5 w-36" />
          </div>
        </div>
      ))}
    </div>
  );
}

function CapabilityCategory({
  children,
  count,
  expanded,
  icon: Icon,
  label,
  onExpandedChange,
}: {
  children: ReactNode;
  count: string;
  expanded: boolean;
  icon: LucideIcon;
  label: string;
  onExpandedChange(expanded: boolean): void;
}) {
  const { t } = useI18n();
  const expansionLabel = t(
    expanded ? "extensions.toolbox.collapseCategory" : "extensions.toolbox.expandCategory",
    { name: label },
  );

  return (
    <Collapsible
      render={<section />}
      open={expanded}
      onOpenChange={onExpandedChange}
      className="flex flex-col gap-0.5"
    >
      <CollapsibleTrigger
        type="button"
        data-workbench-selection-surface=""
        aria-label={expansionLabel}
        title={expansionLabel}
        className="hover:bg-sidebar-accent focus-visible:ring-sidebar-ring flex h-9 w-full items-center gap-1 rounded-lg px-1.5 pt-[var(--button-content-padding-block-start)] pb-[var(--button-content-padding-block-end)] text-left leading-[var(--control-text-line-height)]! outline-none transition-colors focus-visible:ring-2 active:translate-y-0!"
      >
        <span className="flex size-7 shrink-0 items-center justify-center">
          <Icon aria-hidden="true" className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
        <span className="text-muted-foreground text-xs tabular-nums">{count}</span>
        <ChevronRightIcon
          aria-hidden="true"
          className={cn(
            "text-muted-foreground size-4 transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
            expanded && "rotate-90",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className={cn(collapsePanel, "outline-none")}>
        <div className="flex flex-col gap-[2px] ps-8">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function CapabilityRow({
  item,
  onOpen,
}: {
  item: ToolboxCapabilityItem;
  onOpen(item: ToolboxCapabilityItem): void;
}) {
  const { t } = useI18n();

  return (
    <button
      type="button"
      data-workbench-selection-surface=""
      className="hover:bg-sidebar-accent focus-visible:ring-sidebar-ring flex min-h-9 w-full min-w-0 items-center rounded-lg px-1.5 py-1.5 text-left outline-none transition-colors focus-visible:ring-2 active:translate-y-0!"
      title={t("extensions.toolbox.openDetails", { name: item.name })}
      onClick={() => onOpen(item)}
    >
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate font-mono text-xs font-medium">{item.name}</span>
          {item.project ? (
            <span
              className="bg-sidebar-accent text-sidebar-accent-foreground max-w-24 shrink-0 truncate rounded px-1.5 py-0.5 text-[9px] leading-3 font-medium"
              aria-label={t("extensions.toolbox.projectTag", { project: item.project.name })}
              title={item.project.path}
            >
              {item.project.name}
            </span>
          ) : null}
        </span>
        {item.description ? (
          <span className="text-muted-foreground mt-0.5 block truncate text-[11px]">
            {item.description}
          </span>
        ) : null}
      </span>
      {item.status ? (
        <span className="text-muted-foreground me-1 shrink-0 text-[10px]">{item.status}</span>
      ) : null}
    </button>
  );
}

function PackageRow({
  item,
  onOpen,
}: {
  item: PiPackageCatalogItemView;
  onOpen(item: PiPackageCatalogItemView): void;
}) {
  const { number, t } = useI18n();

  return (
    <button
      type="button"
      data-workbench-selection-surface=""
      className="hover:bg-sidebar-accent focus-visible:ring-sidebar-ring flex min-h-11 w-full items-center rounded-lg px-1.5 py-1.5 text-left outline-none transition-colors focus-visible:ring-2 active:translate-y-0!"
      title={t("extensions.toolbox.openDetails", { name: item.name })}
      onClick={() => onOpen(item)}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-xs font-medium">{item.name}</span>
        <span className="text-muted-foreground mt-0.5 block truncate text-[11px]">
          {item.author || t("extensions.toolbox.packages.unknownAuthor")} ·{" "}
          {t("extensions.toolbox.packages.downloadsPerMonth", {
            count: number(item.monthlyDownloads, { notation: "compact", maximumFractionDigits: 1 }),
          })}
        </span>
      </span>
      <ChevronRightIcon aria-hidden="true" className="text-muted-foreground size-3.5 shrink-0" />
    </button>
  );
}

function ManagementRow({
  count,
  countLabel,
  disabled = false,
  emphasized = false,
  icon: Icon,
  label,
  onClick,
  title,
}: {
  count?: string;
  countLabel?: string;
  disabled?: boolean;
  emphasized?: boolean;
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  title?: string;
}) {
  if (disabled) {
    return (
      <div
        aria-disabled="true"
        title={title}
        className="text-muted-foreground flex h-9 items-center gap-1 rounded-lg px-1.5 pt-[var(--button-content-padding-block-start)] pb-[var(--button-content-padding-block-end)] leading-[var(--control-text-line-height)]! opacity-70"
      >
        <span className="flex size-7 shrink-0 items-center justify-center">
          <Icon aria-hidden="true" className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
        <ChevronRightIcon aria-hidden="true" className="size-4 opacity-50" />
      </div>
    );
  }

  return (
    <button
      type="button"
      data-workbench-selection-surface=""
      className={cn(
        "hover:bg-sidebar-accent focus-visible:ring-sidebar-ring flex h-9 w-full items-center gap-1 rounded-lg px-1.5 pt-[var(--button-content-padding-block-start)] pb-[var(--button-content-padding-block-end)] text-left leading-[var(--control-text-line-height)]! outline-none transition-colors focus-visible:ring-2 active:translate-y-0!",
        emphasized && "hover:bg-emerald-500/10",
      )}
      onClick={onClick}
    >
      <span className="flex size-7 shrink-0 items-center justify-center">
        <Icon
          aria-hidden="true"
          className={cn("size-4", emphasized && "text-emerald-600 dark:text-emerald-400")}
        />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      {count ? (
        <span
          aria-label={countLabel}
          className={cn(
            "text-muted-foreground shrink-0 text-xs tabular-nums",
            emphasized &&
              "inline-flex min-w-5 items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[11px] leading-4 font-semibold text-emerald-700 dark:text-emerald-300",
          )}
        >
          {count}
        </span>
      ) : null}
      <ChevronRightIcon aria-hidden="true" className="text-muted-foreground size-4" />
    </button>
  );
}

export function ToolboxSidebar({ searchQuery }: SlotPropsMap["sidebar.toolbox"]) {
  const { locale, number, t } = useI18n();
  const mainViews = useMainViewService();
  useEffect(() => {
    if (mainViews.getSnapshot()?.kind === "toolbox") return;
    mainViews.open({
      kind: "toolbox",
      title: TOOLBOX_SECTION_TITLES.skills,
      params: { section: "skills" },
    });
  }, [mainViews]);
  const scope = useToolboxScope();
  const [expandedSections, setExpandedSections] = useState<ReadonlySet<ToolboxMainSection>>(
    () => new Set(),
  );
  const {
    extensionItems,
    extensionsCatalog,
    packageItems,
    packagesCatalog,
    promptItems,
    promptsCatalog,
    skillItems,
    skillsCatalog,
  } = useToolboxCatalogs(scope);
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase(locale);
  const packageCatalog = usePiPackageCatalog({
    enabled: Boolean(normalizedQuery),
    query: searchQuery,
  });
  const packageUpdateTarget = useMemo(
    () => (packagesCatalog.hasTargets ? toolboxScopeTarget(scope) : undefined),
    [packagesCatalog.hasTargets, scope],
  );
  const packageUpdates = usePiPackageUpdates(packageUpdateTarget);
  const availableUpdateCount = packageUpdates.value.updates.length;
  const packageUpdateCount =
    packageUpdates.loadState === "ready"
      ? number(availableUpdateCount)
      : packageUpdates.loadState === "loading"
        ? "…"
        : "—";
  const packageUpdateCountLabel =
    packageUpdates.loadState === "ready"
      ? t("extensions.toolbox.packages.availableUpdatesCount", {
          count: availableUpdateCount,
        })
      : packageUpdates.loadState === "loading"
        ? t("extensions.toolbox.packages.checkingUpdates")
        : packageUpdates.loadState === "failed"
          ? t("extensions.toolbox.packages.updateCheckFailed")
          : t("extensions.toolbox.scopeUnavailable");
  const allItems = [...skillItems, ...extensionItems, ...promptItems, ...packageItems];
  const visibleItems = normalizedQuery
    ? allItems.filter((item) => item.searchText.toLocaleLowerCase(locale).includes(normalizedQuery))
    : allItems;
  const catalogCount = (loadState: typeof skillsCatalog.loadState, count: number) =>
    loadState === "ready" ? number(count) : loadState === "loading" ? "…" : "—";
  const openMainView = (
    section: ToolboxMainSection,
    selected?: ToolboxCapabilitySurfaceParams,
    detailOnly = false,
  ) => {
    mainViews.open({
      kind: "toolbox",
      title: TOOLBOX_SECTION_TITLES[section],
      params: {
        section,
        ...(detailOnly ? { detailOnly: true } : {}),
        ...(!detailOnly && normalizedQuery ? { query: searchQuery.trim() } : {}),
        ...(selected ? { selected } : {}),
      },
    });
  };
  const openCapability = (item: ToolboxCapabilityItem) =>
    openMainView(sectionForCapability(item.params), item.params, true);
  const openPackage = (item: PiPackageCatalogItemView) => {
    const params = packageSurfaceParams(item);
    openMainView(sectionForCapability(params), params, true);
  };
  const renderCapability = (item: ToolboxCapabilityItem) => (
    <CapabilityRow key={item.id} item={item} onOpen={openCapability} />
  );
  const setSectionExpanded = (section: ToolboxMainSection, expanded: boolean) => {
    setExpandedSections((current) => {
      const next = new Set(current);
      if (expanded) next.add(section);
      else next.delete(section);
      return next;
    });
  };
  const renderCategoryItems = (
    catalog: Pick<typeof skillsCatalog, "hasTargets" | "loadState">,
    items: readonly ToolboxCapabilityItem[],
    empty: string,
  ) => {
    if (!catalog.hasTargets) {
      return <EmptyNote>{t("extensions.toolbox.scopeUnavailable")}</EmptyNote>;
    }
    if (catalog.loadState === "loading") {
      return <CatalogSkeleton />;
    }
    if (catalog.loadState === "failed") {
      return <EmptyNote>{t("extensions.toolbox.loadFailed")}</EmptyNote>;
    }
    if (items.length === 0) return <EmptyNote>{empty}</EmptyNote>;
    return items.map((item) => renderCapability(item));
  };

  return (
    <section aria-label={t("extensions.toolbox.title")} className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto py-1 ps-3 pe-[2px] [scrollbar-gutter:stable]">
        <section className="mb-1 flex h-10 items-center gap-2 px-2">
          <span className="text-muted-foreground shrink-0 text-sm font-medium">
            {t("extensions.toolbox.scope.label")}
          </span>
          <div className="min-w-0 flex-1">
            <ToolboxScopeSelect className="h-7" />
          </div>
        </section>
        {normalizedQuery ? (
          <section className="flex flex-col gap-[2px]">
            <SectionLabel>{t("extensions.toolbox.searchResults")}</SectionLabel>
            {visibleItems.map((item) => renderCapability(item))}
            {packageCatalog.loadState === "ready"
              ? packageCatalog.value.packages.map((item) => (
                  <PackageRow key={item.name} item={item} onOpen={openPackage} />
                ))
              : null}
            {skillsCatalog.loadState === "loading" ||
            extensionsCatalog.loadState === "loading" ||
            promptsCatalog.loadState === "loading" ||
            packagesCatalog.loadState === "loading" ||
            packageCatalog.loadState === "loading" ? (
              <CatalogSkeleton />
            ) : visibleItems.length === 0 &&
              (packageCatalog.loadState !== "ready" ||
                packageCatalog.value.packages.length === 0) ? (
              <EmptyNote>{t("extensions.toolbox.noMatches")}</EmptyNote>
            ) : null}
          </section>
        ) : (
          <>
            <section className="mb-1 flex flex-col gap-[2px]">
              <SectionLabel>{t("extensions.toolbox.capabilities")}</SectionLabel>
              <CapabilityCategory
                icon={WandSparklesIcon}
                label={t("extensions.toolbox.skills.title")}
                count={catalogCount(skillsCatalog.loadState, skillItems.length)}
                expanded={expandedSections.has("skills")}
                onExpandedChange={(expanded) => setSectionExpanded("skills", expanded)}
              >
                {renderCategoryItems(
                  skillsCatalog,
                  skillItems,
                  t("extensions.toolbox.skills.empty"),
                )}
              </CapabilityCategory>
              <CapabilityCategory
                icon={PlugIcon}
                label={t("extensions.toolbox.extensions.title")}
                count={catalogCount(extensionsCatalog.loadState, extensionItems.length)}
                expanded={expandedSections.has("extensions")}
                onExpandedChange={(expanded) => setSectionExpanded("extensions", expanded)}
              >
                {renderCategoryItems(
                  extensionsCatalog,
                  extensionItems,
                  t("extensions.toolbox.extensions.empty"),
                )}
              </CapabilityCategory>
              <CapabilityCategory
                icon={FileTextIcon}
                label={t("extensions.toolbox.prompts.title")}
                count={catalogCount(promptsCatalog.loadState, promptItems.length)}
                expanded={expandedSections.has("prompts")}
                onExpandedChange={(expanded) => setSectionExpanded("prompts", expanded)}
              >
                {renderCategoryItems(
                  promptsCatalog,
                  promptItems,
                  t("extensions.toolbox.prompts.empty"),
                )}
              </CapabilityCategory>
            </section>

            <section className="flex flex-col gap-[2px]">
              <SectionLabel>{t("extensions.toolbox.manage")}</SectionLabel>
              <CapabilityCategory
                icon={PackageIcon}
                label={t("extensions.toolbox.packages.installedTitle")}
                count={catalogCount(packagesCatalog.loadState, packageItems.length)}
                expanded={expandedSections.has("packages")}
                onExpandedChange={(expanded) => setSectionExpanded("packages", expanded)}
              >
                {renderCategoryItems(
                  packagesCatalog,
                  packageItems,
                  t("extensions.toolbox.packages.empty"),
                )}
              </CapabilityCategory>
              <ManagementRow
                icon={StoreIcon}
                label={t("extensions.toolbox.browsePiPackages")}
                onClick={() => openMainView("packages")}
              />
              <ManagementRow
                count={packageUpdateCount}
                countLabel={packageUpdateCountLabel}
                emphasized={packageUpdates.loadState === "ready" && availableUpdateCount > 0}
                icon={DownloadIcon}
                label={t("extensions.toolbox.updates")}
                onClick={() => openMainView("updates")}
              />
              <ManagementRow
                disabled
                icon={PackagePlusIcon}
                label={t("extensions.toolbox.installLocal")}
                title={t("extensions.toolbox.managementUnavailable")}
              />
            </section>
          </>
        )}
      </div>
    </section>
  );
}
