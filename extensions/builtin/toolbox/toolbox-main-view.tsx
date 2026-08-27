"use client";

import {
  ChevronDownIcon,
  ChevronRightIcon,
  RefreshCwIcon,
  SearchIcon,
  ToolboxIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuRadioGroup } from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  SettingsDropdownContent,
  SettingsDropdownRadioItem,
  SettingsDropdownTrigger,
} from "@/components/ui/settings-control";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { MainViewProps } from "@/platform/extensions";
import { usePiWorkspaces } from "@/runtime/pi/client/runtime/context";
import type {
  PiPackageCatalogFilterType,
  PiPackageCatalogItemView,
  PiPackageCatalogSort,
  PiPackageUpdateView,
} from "@/runtime/pi/contracts/rpc";

import {
  bindCapabilityToCatalogTarget,
  installedPackageSurfaceParams,
  packageSurfaceParams,
  type ToolboxCapabilitySurfaceParams,
  type ToolboxMainViewParams,
} from "./toolbox-capability";
import { ToolboxCapabilityDetails } from "./toolbox-capability-surface";
import { toolboxScopeMatchesCapability, toolboxScopeTarget } from "./toolbox-scope";
import { useToolboxScope } from "./toolbox-scope-store";
import { usePiPackageCatalog } from "./use-pi-package-catalog";
import { usePiPackageUpdates } from "./use-pi-package-updates";

type PackageTypeFilter = "all" | PiPackageCatalogFilterType;

const CATALOG_SKELETON_ROWS = [
  { name: "w-36", metadata: "w-28", type: "w-14" },
  { name: "w-44", metadata: "w-24", type: "w-12" },
  { name: "w-28", metadata: "w-32", type: "w-16" },
  { name: "w-48", metadata: "w-28", type: "w-12" },
  { name: "w-40", metadata: "w-20", type: "w-14" },
  { name: "w-52", metadata: "w-32", type: "w-16" },
  { name: "w-32", metadata: "w-24", type: "w-12" },
  { name: "w-44", metadata: "w-28", type: "w-14" },
  { name: "w-36", metadata: "w-20", type: "w-16" },
  { name: "w-48", metadata: "w-32", type: "w-12" },
] as const;

function CatalogSkeleton() {
  return (
    <div className="space-y-1 p-2" aria-hidden="true">
      {CATALOG_SKELETON_ROWS.map((row, index) => (
        <div key={index} className="flex min-h-16 w-full items-center gap-3 rounded-xl px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <Skeleton className={cn("h-3.5 max-w-full", row.name)} />
            <Skeleton className={cn("mt-1.5 h-3 max-w-full", row.metadata)} />
          </div>
          <Skeleton className={cn("h-3 shrink-0", row.type)} />
          <Skeleton className="size-3.5 shrink-0 rounded-sm" />
        </div>
      ))}
    </div>
  );
}

function CatalogPaginationSkeleton() {
  return (
    <div
      className="flex h-12 shrink-0 items-center justify-between gap-2 border-t px-3"
      aria-hidden="true"
    >
      <Skeleton className="h-7 w-14 rounded-lg" />
      <Skeleton className="h-3 w-12" />
      <Skeleton className="h-7 w-14 rounded-lg" />
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="text-muted-foreground flex min-h-32 items-center justify-center px-6 text-center text-sm leading-6">
      {children}
    </div>
  );
}

interface ToolbarSelectOption<Value extends string> {
  value: Value;
  label: string;
}

function ToolbarSelect<Value extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange(value: Value): void;
  options: readonly ToolbarSelectOption<Value>[];
  value: Value;
}) {
  const selectedLabel = options.find((option) => option.value === value)?.label ?? value;

  return (
    <DropdownMenu>
      <SettingsDropdownTrigger aria-label={label} className="min-w-32 justify-between rounded-lg">
        <span className="min-w-0 truncate">{selectedLabel}</span>
        <ChevronDownIcon className="text-muted-foreground size-3.5 shrink-0" />
      </SettingsDropdownTrigger>
      <SettingsDropdownContent align="end" side="bottom">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(nextValue) => {
            const option = options.find((candidate) => candidate.value === nextValue);
            if (option) onChange(option.value);
          }}
        >
          {options.map((option) => (
            <SettingsDropdownRadioItem key={option.value} value={option.value}>
              {option.label}
            </SettingsDropdownRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </SettingsDropdownContent>
    </DropdownMenu>
  );
}

function MainPackageRow({
  active,
  item,
  onOpen,
}: {
  active: boolean;
  item: PiPackageCatalogItemView;
  onOpen(item: PiPackageCatalogItemView): void;
}) {
  const { number, t } = useI18n();

  return (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      title={t("extensions.toolbox.openDetails", { name: item.name })}
      className={cn(
        "hover:bg-muted/70 focus-visible:ring-ring flex min-h-16 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 active:translate-y-0!",
        active && "bg-muted",
      )}
      onClick={() => onOpen(item)}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-sm font-medium">{item.name}</span>
        <span className="text-muted-foreground mt-1 block truncate text-xs">
          {item.author || t("extensions.toolbox.packages.unknownAuthor")} ·{" "}
          {t("extensions.toolbox.packages.downloadsPerMonth", {
            count: number(item.monthlyDownloads, { notation: "compact", maximumFractionDigits: 1 }),
          })}
        </span>
      </span>
      <span className="text-muted-foreground max-w-28 shrink-0 truncate text-[11px]">
        {item.types.map((type) => t(`extensions.toolbox.packages.types.${type}`)).join(" · ")}
      </span>
      <ChevronRightIcon aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
    </button>
  );
}

function PackageUpdateRow({
  active,
  item,
  onOpen,
}: {
  active: boolean;
  item: PiPackageUpdateView;
  onOpen(item: PiPackageUpdateView): void;
}) {
  const { t } = useI18n();

  return (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      title={t("extensions.toolbox.openDetails", { name: item.displayName })}
      className={cn(
        "hover:bg-muted/70 focus-visible:ring-ring flex min-h-16 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 active:translate-y-0!",
        active && "bg-muted",
      )}
      onClick={() => onOpen(item)}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-sm font-medium">{item.displayName}</span>
        <span className="text-muted-foreground mt-1 block truncate text-xs">{item.source}</span>
      </span>
      <span className="shrink-0 text-[11px] font-medium text-amber-700 dark:text-amber-300">
        {t("extensions.toolbox.packages.updateAvailable")}
      </span>
      <ChevronRightIcon aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
    </button>
  );
}

function SearchField({ query, setQuery }: { query: string; setQuery(query: string): void }) {
  const { t } = useI18n();

  return (
    <InputGroup className="min-w-56 flex-1 sm:max-w-md">
      <InputGroupAddon>
        <SearchIcon aria-hidden="true" />
      </InputGroupAddon>
      <InputGroupInput
        type="search"
        autoComplete="off"
        spellCheck={false}
        value={query}
        aria-label={t("extensions.toolbox.main.search")}
        placeholder={t("extensions.toolbox.main.searchPlaceholder")}
        className="[&::-webkit-search-cancel-button]:hidden"
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
    </InputGroup>
  );
}

function DetailPane({ selected }: { selected?: ToolboxCapabilitySurfaceParams }) {
  const { t } = useI18n();

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
      {selected ? (
        <ToolboxCapabilityDetails key={selected.capabilityId} params={selected} />
      ) : (
        <div className="flex h-full min-h-64 items-center justify-center p-8">
          <div className="max-w-sm text-center">
            <span className="bg-muted mx-auto flex size-12 items-center justify-center rounded-2xl">
              <ToolboxIcon aria-hidden="true" className="size-5" />
            </span>
            <h2 className="mt-4 text-base font-semibold">
              {t("extensions.toolbox.main.selectCapability")}
            </h2>
            <p className="text-muted-foreground mt-2 text-sm leading-6">
              {t("extensions.toolbox.main.selectCapabilityDescription")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function PackageUpdatesView() {
  const { t } = useI18n();
  const scope = useToolboxScope();
  const workspaces = usePiWorkspaces();
  const project =
    scope.kind === "project"
      ? workspaces.find((workspace) => workspace.id === scope.workspaceId)
      : undefined;
  const target = useMemo(
    () => (scope.kind === "user" || project ? toolboxScopeTarget(scope) : undefined),
    [project, scope],
  );
  const packageUpdates = usePiPackageUpdates(target);
  const [selected, setSelected] = useState<ToolboxCapabilitySurfaceParams>();

  useEffect(() => setSelected(undefined), [target]);

  const updateParams = (item: PiPackageUpdateView): ToolboxCapabilitySurfaceParams => {
    const params = {
      ...installedPackageSurfaceParams(item),
      name: item.displayName,
      packageUpdateAvailable: true,
    };
    return target
      ? bindCapabilityToCatalogTarget(
          params,
          item.scope,
          target,
          project ? { id: project.id, name: project.name, path: project.cwd } : undefined,
        )
      : params;
  };
  const selectedId = selected?.capabilityId;
  const listContent = (() => {
    if (!target) return <EmptyState>{t("extensions.toolbox.scopeUnavailable")}</EmptyState>;
    if (packageUpdates.loadState === "loading") {
      return (
        <>
          <span className="sr-only" role="status">
            {t("extensions.toolbox.packages.checkingUpdates")}
          </span>
          <CatalogSkeleton />
        </>
      );
    }
    if (packageUpdates.loadState === "failed") {
      return (
        <EmptyState>
          <div>
            <p>{t("extensions.toolbox.packages.updateCheckFailed")}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3 active:translate-y-0!"
              onClick={packageUpdates.refresh}
            >
              <RefreshCwIcon aria-hidden="true" />
              {t("extensions.toolbox.packages.retry")}
            </Button>
          </div>
        </EmptyState>
      );
    }
    if (packageUpdates.loadState !== "ready") return null;
    if (packageUpdates.value.updates.length === 0) {
      return <EmptyState>{t("extensions.toolbox.packages.upToDate")}</EmptyState>;
    }
    return (
      <div className="space-y-1 p-2">
        {packageUpdates.value.updates.map((item) => {
          const params = updateParams(item);
          return (
            <PackageUpdateRow
              key={`${item.scope}:${item.source}`}
              item={item}
              active={selectedId === params.capabilityId}
              onOpen={(nextItem) => setSelected(updateParams(nextItem))}
            />
          );
        })}
      </div>
    );
  })();

  return (
    <section aria-label={t("extensions.toolbox.updates")} className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col px-12">
        <div className="flex min-h-14 shrink-0 items-center gap-3 border-b px-4 py-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-medium">{t("extensions.toolbox.updates")}</h2>
            <p className="text-muted-foreground truncate text-xs">
              {t("extensions.toolbox.packages.updateCheckDescription")}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={packageUpdates.loadState === "loading"}
            aria-label={t("extensions.toolbox.packages.checkUpdates")}
            title={t("extensions.toolbox.packages.checkUpdates")}
            className="active:translate-y-0!"
            onClick={() => {
              setSelected(undefined);
              packageUpdates.refresh();
            }}
          >
            <RefreshCwIcon
              aria-hidden="true"
              className={cn(packageUpdates.loadState === "loading" && "animate-spin")}
            />
          </Button>
          {packageUpdates.loadState === "ready" ? (
            <span className="text-muted-foreground text-xs tabular-nums">
              {t("extensions.toolbox.packages.availableUpdatesCount", {
                count: packageUpdates.value.updates.length,
              })}
            </span>
          ) : null}
        </div>

        <div className="grid min-h-0 flex-1 grid-rows-[minmax(12rem,2fr)_minmax(0,3fr)] lg:grid-cols-[minmax(18rem,2fr)_minmax(0,3fr)] lg:grid-rows-1">
          <div className="bg-muted/20 min-h-0 overflow-y-auto border-b lg:border-e lg:border-b-0">
            {listContent}
          </div>
          <DetailPane selected={selected} />
        </div>
      </div>
    </section>
  );
}

export function ToolboxMainView({ close, view }: MainViewProps<ToolboxMainViewParams>) {
  const { number, t } = useI18n();
  const scope = useToolboxScope();
  const detailOnly = view.params.detailOnly === true;
  const [selected, setSelected] = useState<ToolboxCapabilitySurfaceParams | undefined>(
    view.params.selected,
  );
  const [query, setQuery] = useState(view.params.query ?? "");
  const [packageType, setPackageType] = useState<PackageTypeFilter>("all");
  const [packageSort, setPackageSort] = useState<PiPackageCatalogSort>("downloads");
  const [packagePage, setPackagePage] = useState(1);
  const packageCatalog = usePiPackageCatalog({
    enabled: !detailOnly && view.params.section !== "updates",
    query,
    ...(packageType === "all" ? {} : { type: packageType }),
    sort: packageSort,
    page: packagePage,
  });

  useEffect(() => {
    setSelected(view.params.selected);
    setQuery(view.params.query ?? "");
    setPackagePage(1);
  }, [view.revision, view.params]);

  useEffect(() => setPackagePage(1), [packageSort, packageType, query]);

  useEffect(() => {
    if (
      detailOnly &&
      view.params.selected &&
      !toolboxScopeMatchesCapability(scope, view.params.selected)
    ) {
      close();
    }
  }, [close, detailOnly, scope, view.params.selected]);

  if (detailOnly) {
    return (
      <section aria-label={t("extensions.toolbox.title")} className="flex h-full min-h-0 flex-col">
        <DetailPane selected={view.params.selected} />
      </section>
    );
  }

  if (view.params.section === "updates") return <PackageUpdatesView />;

  const selectedId = selected?.capabilityId;
  const visibleCount =
    packageCatalog.loadState === "ready" ? packageCatalog.value.filteredTotal : undefined;
  const listContent = (() => {
    if (packageCatalog.loadState === "loading") return <CatalogSkeleton />;
    if (packageCatalog.loadState === "failed") {
      return (
        <EmptyState>
          <div>
            <p>{t("extensions.toolbox.packages.loadFailed")}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3 active:translate-y-0!"
              onClick={packageCatalog.refresh}
            >
              <RefreshCwIcon aria-hidden="true" />
              {t("extensions.toolbox.packages.retry")}
            </Button>
          </div>
        </EmptyState>
      );
    }
    if (packageCatalog.loadState !== "ready") return null;
    if (packageCatalog.value.packages.length === 0) {
      return <EmptyState>{t("extensions.toolbox.packages.browseEmpty")}</EmptyState>;
    }
    return (
      <div className="space-y-1 p-2">
        {packageCatalog.value.packages.map((item) => {
          const params = packageSurfaceParams(item);
          return (
            <MainPackageRow
              key={item.name}
              item={item}
              active={selectedId === params.capabilityId}
              onOpen={(nextItem) => setSelected(packageSurfaceParams(nextItem))}
            />
          );
        })}
      </div>
    );
  })();

  return (
    <section aria-label={t("extensions.toolbox.title")} className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col px-12">
        <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
          <SearchField query={query} setQuery={setQuery} />
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">
              {t("extensions.toolbox.packages.typeFilter")}
            </span>
            <ToolbarSelect<PackageTypeFilter>
              value={packageType}
              label={t("extensions.toolbox.packages.typeFilter")}
              options={(["all", "extension", "skill", "prompt", "theme"] as const).map((type) => ({
                value: type,
                label: t(`extensions.toolbox.packages.filters.${type}`),
              }))}
              onChange={setPackageType}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">
              {t("extensions.toolbox.packages.sortLabel")}
            </span>
            <ToolbarSelect<PiPackageCatalogSort>
              value={packageSort}
              label={t("extensions.toolbox.packages.sortLabel")}
              options={(["downloads", "recent", "name"] as const).map((sort) => ({
                value: sort,
                label: t(`extensions.toolbox.packages.sort.${sort}`),
              }))}
              onChange={setPackageSort}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("extensions.toolbox.packages.refresh")}
            title={t("extensions.toolbox.packages.refresh")}
            className="active:translate-y-0!"
            onClick={packageCatalog.refresh}
          >
            <RefreshCwIcon aria-hidden="true" />
          </Button>
          {visibleCount === undefined ? null : (
            <span className="text-muted-foreground px-2 text-xs tabular-nums">
              {t("extensions.toolbox.main.resultsCount", { count: visibleCount })}
            </span>
          )}
        </div>

        <div className="grid min-h-0 flex-1 grid-rows-[minmax(12rem,2fr)_minmax(0,3fr)] lg:grid-cols-[minmax(18rem,2fr)_minmax(0,3fr)] lg:grid-rows-1">
          <div className="bg-muted/20 flex min-h-0 flex-col border-b lg:border-e lg:border-b-0">
            <div className="min-h-0 flex-1 overflow-y-auto">{listContent}</div>
            {packageCatalog.loadState === "loading" ? (
              <CatalogPaginationSkeleton />
            ) : packageCatalog.loadState === "ready" && packageCatalog.value.pageCount > 1 ? (
              <nav
                aria-label={t("extensions.toolbox.packages.pagination")}
                className="flex h-12 shrink-0 items-center justify-between gap-2 border-t px-3"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={packagePage <= 1}
                  className="active:translate-y-0!"
                  onClick={() => setPackagePage((page) => Math.max(1, page - 1))}
                >
                  {t("extensions.toolbox.packages.previous")}
                </Button>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {t("extensions.toolbox.packages.page", {
                    page: number(packageCatalog.value.page),
                    count: number(packageCatalog.value.pageCount),
                  })}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={packagePage >= packageCatalog.value.pageCount}
                  className="active:translate-y-0!"
                  onClick={() => setPackagePage((page) => page + 1)}
                >
                  {t("extensions.toolbox.packages.next")}
                </Button>
              </nav>
            ) : null}
          </div>

          <DetailPane selected={selected} />
        </div>
      </div>
    </section>
  );
}
