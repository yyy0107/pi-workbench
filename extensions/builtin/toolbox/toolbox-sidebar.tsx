"use client";

import {
  BoxesIcon,
  ChevronRightIcon,
  DownloadIcon,
  MessageSquareTextIcon,
  PackageIcon,
  PackagePlusIcon,
  PinIcon,
  PlusIcon,
  SettingsIcon,
  SparklesIcon,
  StoreIcon,
  type LucideIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { collapsePanel } from "@/components/elements/surfaces";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { defineMessage, useI18n, type LocalizableText } from "@/i18n";
import { cn } from "@/lib/utils";
import { useCommandService, useMainViewService, type SlotPropsMap } from "@/platform/extensions";
import type { PiPackageCatalogItemView } from "@/runtime/pi/rpc-contracts";

import {
  packageSurfaceParams,
  sectionForCapability,
  type ToolboxCapabilitySurfaceParams,
  type ToolboxMainSection,
} from "./toolbox-capability";
import { useToolboxSessionCatalogs, type ToolboxCapabilityItem } from "./toolbox-catalog";
import { toggleToolboxPin, useToolboxPins } from "./toolbox-pins";
import { usePiPackageCatalog } from "./use-pi-package-catalog";

const TOOLBOX_SECTION_TITLES = {
  skills: defineMessage("extensions.toolbox.skills.title"),
  extensions: defineMessage("extensions.toolbox.extensions.title"),
  prompts: defineMessage("extensions.toolbox.prompts.title"),
  packages: defineMessage("extensions.toolbox.packages.title"),
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
        <div key={item} className="flex h-11 items-center gap-2 px-1.5">
          <Skeleton className="size-7 rounded-lg" />
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
        className="hover:bg-sidebar-accent focus-visible:ring-sidebar-ring flex h-9 w-full items-center gap-1 rounded-lg px-1.5 text-left outline-none transition-colors focus-visible:ring-2 active:translate-y-0!"
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
        <div className="flex flex-col gap-[2px] ps-6">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function CapabilityRow({
  item,
  nested = false,
  onOpen,
  onTogglePin,
  pinned,
}: {
  item: ToolboxCapabilityItem;
  nested?: boolean;
  onOpen(item: ToolboxCapabilityItem): void;
  onTogglePin(item: ToolboxCapabilityItem): void;
  pinned: boolean;
}) {
  const { t } = useI18n();
  const Icon =
    item.kind === "skill"
      ? SparklesIcon
      : item.kind === "extension"
        ? BoxesIcon
        : item.kind === "prompt"
          ? MessageSquareTextIcon
          : PackageIcon;
  const pinLabel = t(pinned ? "extensions.toolbox.unpin" : "extensions.toolbox.pin");

  return (
    <div
      data-workbench-selection-surface=""
      className={cn(
        "group/capability hover:bg-sidebar-accent focus-within:bg-sidebar-accent flex min-h-11 items-center rounded-lg transition-colors",
        nested && "-ms-6",
      )}
    >
      <button
        type="button"
        className="focus-visible:ring-sidebar-ring flex min-w-0 flex-1 items-center gap-1 rounded-lg px-1.5 py-1.5 text-left outline-none focus-visible:ring-2 active:translate-y-0!"
        title={t("extensions.toolbox.openDetails", { name: item.name })}
        onClick={() => onOpen(item)}
      >
        <span className="flex size-7 shrink-0 items-center justify-center">
          <Icon aria-hidden="true" className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-xs font-medium">{item.name}</span>
          <span className="text-muted-foreground mt-0.5 block truncate text-[11px]">
            {item.secondary}
          </span>
        </span>
      </button>
      <button
        type="button"
        aria-label={`${pinLabel}: ${item.name}`}
        title={`${pinLabel}: ${item.name}`}
        aria-pressed={pinned}
        className={cn(
          "text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-sidebar-ring me-1 flex size-7 shrink-0 items-center justify-center rounded-lg outline-none transition-colors focus-visible:ring-2 active:translate-y-0!",
          pinned
            ? "text-foreground"
            : "opacity-0 group-hover/capability:opacity-100 group-focus-within/capability:opacity-100",
        )}
        onClick={() => onTogglePin(item)}
      >
        <PinIcon aria-hidden="true" className={cn("size-3.5", pinned && "fill-current")} />
      </button>
    </div>
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
  const Icon = item.types.includes("prompt")
    ? MessageSquareTextIcon
    : item.types.includes("skill")
      ? SparklesIcon
      : item.types.includes("extension")
        ? BoxesIcon
        : PackageIcon;

  return (
    <button
      type="button"
      data-workbench-selection-surface=""
      className="hover:bg-sidebar-accent focus-visible:ring-sidebar-ring flex min-h-11 w-full items-center gap-1 rounded-lg px-1.5 py-1.5 text-left outline-none transition-colors focus-visible:ring-2 active:translate-y-0!"
      title={t("extensions.toolbox.openDetails", { name: item.name })}
      onClick={() => onOpen(item)}
    >
      <span className="flex size-7 shrink-0 items-center justify-center">
        <Icon aria-hidden="true" className="size-4" />
      </span>
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
  disabled = false,
  icon: Icon,
  label,
  onClick,
  title,
}: {
  disabled?: boolean;
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
        className="text-muted-foreground flex h-9 items-center gap-1 rounded-lg px-1.5 opacity-70"
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
      className="hover:bg-sidebar-accent focus-visible:ring-sidebar-ring flex h-9 w-full items-center gap-1 rounded-lg px-1.5 text-left outline-none transition-colors focus-visible:ring-2 active:translate-y-0!"
      onClick={onClick}
    >
      <span className="flex size-7 shrink-0 items-center justify-center">
        <Icon aria-hidden="true" className="size-4" />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      <ChevronRightIcon aria-hidden="true" className="text-muted-foreground size-4" />
    </button>
  );
}

export function ToolboxSidebar({ searchQuery }: SlotPropsMap["sidebar.toolbox"]) {
  const { locale, number, t } = useI18n();
  const commands = useCommandService();
  const mainViews = useMainViewService();
  const pins = useToolboxPins();
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
  } = useToolboxSessionCatalogs();
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase(locale);
  const packageCatalog = usePiPackageCatalog({
    enabled: Boolean(normalizedQuery),
    query: searchQuery,
  });
  const allItems = [...skillItems, ...extensionItems, ...promptItems, ...packageItems];
  const visibleItems = normalizedQuery
    ? allItems.filter((item) => item.searchText.toLocaleLowerCase(locale).includes(normalizedQuery))
    : allItems;
  const visiblePinnedItems = visibleItems.filter((item) => pins.includes(item.id));
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
  const openSettings = () => {
    void commands.execute("settings.open").catch((error) => console.error(error));
  };
  const renderCapability = (item: ToolboxCapabilityItem, nested = false) => (
    <CapabilityRow
      key={item.id}
      item={item}
      nested={nested}
      pinned={pins.includes(item.id)}
      onOpen={openCapability}
      onTogglePin={(capability) => toggleToolboxPin(capability.id)}
    />
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
    catalog: Pick<typeof skillsCatalog, "loadState" | "sessionId" | "sessionUnavailable">,
    items: readonly ToolboxCapabilityItem[],
    empty: string,
  ) => {
    if (!catalog.sessionId) return <EmptyNote>{t("extensions.toolbox.noSession")}</EmptyNote>;
    if (catalog.loadState === "loading") return <CatalogSkeleton />;
    if (catalog.loadState === "failed") {
      return (
        <EmptyNote>
          {t(
            catalog.sessionUnavailable
              ? "extensions.toolbox.sessionUnavailable"
              : "extensions.toolbox.loadFailed",
          )}
        </EmptyNote>
      );
    }
    if (items.length === 0) return <EmptyNote>{empty}</EmptyNote>;
    return items.map((item) => renderCapability(item, true));
  };

  return (
    <section aria-label={t("extensions.toolbox.title")} className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto py-1 ps-3 pe-[2px] [scrollbar-gutter:stable]">
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
            {visiblePinnedItems.length > 0 ? (
              <section className="mb-1 flex flex-col gap-[2px]">
                <SectionLabel>{t("extensions.toolbox.pinned")}</SectionLabel>
                {visiblePinnedItems.map((item) => renderCapability(item))}
              </section>
            ) : null}

            <section className="mb-1 flex flex-col gap-[2px]">
              <SectionLabel>{t("extensions.toolbox.capabilities")}</SectionLabel>
              <CapabilityCategory
                icon={SparklesIcon}
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
                icon={BoxesIcon}
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
                icon={MessageSquareTextIcon}
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
              <CapabilityCategory
                icon={PackageIcon}
                label={t("extensions.toolbox.packages.title")}
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
            </section>

            <section className="flex flex-col gap-[2px]">
              <SectionLabel>{t("extensions.toolbox.manage")}</SectionLabel>
              <ManagementRow
                icon={StoreIcon}
                label={t("extensions.toolbox.browsePiPackages")}
                onClick={() => openMainView("packages")}
              />
              <ManagementRow
                disabled
                icon={DownloadIcon}
                label={t("extensions.toolbox.updates")}
                title={t("extensions.toolbox.managementUnavailable")}
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

      <footer className="flex min-h-12 shrink-0 items-center gap-2 px-4 pt-2 pb-1">
        <Button
          type="button"
          variant="ghost"
          size="lg"
          className="min-w-0 flex-1 justify-start active:translate-y-0!"
          onClick={() => openMainView("packages")}
        >
          <PlusIcon aria-hidden="true" />
          <span className="truncate">{t("extensions.toolbox.addCapability")}</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("extensions.toolbox.openSettings")}
          title={t("extensions.toolbox.openSettings")}
          className="active:translate-y-0!"
          onClick={openSettings}
        >
          <SettingsIcon aria-hidden="true" />
        </Button>
      </footer>
    </section>
  );
}
