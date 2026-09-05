"use client";

import {
  ChevronDownIcon,
  ChevronRightIcon,
  PackageIcon,
  RefreshCwIcon,
  SearchIcon,
  ToolboxIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Button, StatusBadge } from "@workbench/shell/ui";
import { DropdownMenu, DropdownMenuRadioGroup } from "@workbench/shell/ui";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@workbench/shell/ui";
import {
  SettingsDropdownContent,
  SettingsDropdownRadioItem,
  SettingsDropdownTrigger,
} from "@workbench/shell/ui";
import { Skeleton } from "@workbench/shell/ui";
import { usePiI18n } from "../../i18n";
import { cn } from "@workbench/shell/utils";
import type { MainViewProps } from "@workbench/extension-sdk";
import { usePiWorkspaces } from "@workbench/agent-runtime-pi-client/workspace";
import type {
  PiPackageCatalogFilterType,
  PiPackageCatalogItemView,
  PiPackageCatalogSort,
  PiPackageUpdateView,
} from "@workbench/agent-runtime-pi-protocol/rpc";

import {
  bindCapabilityToCatalogTarget,
  installedPackageSurfaceParams,
  packageSurfaceParams,
  type ToolboxCapabilitySurfaceParams,
  type ToolboxMainViewParams,
} from "./toolbox-capability";
import { ToolboxCapabilityDetails } from "./toolbox-capability-surface";
import { ToolboxInstalledView } from "./toolbox-installed-view";
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
        <div key={index} className="flex w-full items-start gap-3 rounded-(--radius) px-3 py-4">
          <Skeleton className="size-(--button-height-large) shrink-0 rounded-(--radius)" />
          <div className="min-w-0 flex-1">
            <Skeleton className={cn("h-4 max-w-full", row.name)} />
            <Skeleton className="mt-2 h-3 w-full" />
            <Skeleton className="mt-2 h-3 w-3/4" />
            <Skeleton className={cn("mt-3 h-3 max-w-full", row.metadata)} />
            <Skeleton className={cn("mt-3 h-5 max-w-full", row.type)} />
          </div>
          <Skeleton className="size-(--icon-size-sm) shrink-0" />
        </div>
      ))}
    </div>
  );
}

function CatalogPaginationSkeleton() {
  return (
    <div
      className="flex min-h-[calc(var(--button-height-default)+1rem)] shrink-0 items-center justify-between gap-2 border-t border-border px-3 py-2"
      aria-hidden="true"
    >
      <Skeleton className="h-(--button-height-default) w-14 rounded-(--radius)" />
      <Skeleton className="h-3 w-12" />
      <Skeleton className="h-(--button-height-default) w-14 rounded-(--radius)" />
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
      <SettingsDropdownTrigger aria-label={label} className="min-w-32 justify-between">
        <span className="min-w-0 truncate">{selectedLabel}</span>
        <ChevronDownIcon
          aria-hidden="true"
          className="text-muted-foreground size-(--icon-size-sm) shrink-0"
        />
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
  const { number, t } = usePiI18n();

  return (
    <Button
      variant="ghost"
      type="button"
      aria-current={active ? "page" : undefined}
      title={t("extensions.toolbox.openDetails", { name: item.name })}
      className="h-auto w-full min-w-0 items-start justify-start gap-3 px-3 py-4 text-left font-normal whitespace-normal"
      onClick={() => onOpen(item)}
    >
      <span className="bg-muted/40 flex size-(--button-height-large) shrink-0 items-center justify-center rounded-(--radius)">
        <PackageIcon aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm leading-5 font-medium">{item.name}</span>
        <span className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-5">
          {item.description}
        </span>
        <span className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5">
          <span className="min-w-0 truncate">
            {item.author || t("extensions.toolbox.packages.unknownAuthor")}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {t("extensions.toolbox.packages.downloadsPerMonth", {
              count: number(item.monthlyDownloads, {
                notation: "compact",
                maximumFractionDigits: 1,
              }),
            })}
          </span>
        </span>
        <span className="mt-2 flex flex-wrap gap-1">
          {item.types.map((type) => (
            <StatusBadge key={type}>{t(`extensions.toolbox.packages.types.${type}`)}</StatusBadge>
          ))}
        </span>
      </span>
      <ChevronRightIcon
        aria-hidden="true"
        className="text-muted-foreground mt-1 size-(--icon-size-sm) shrink-0"
      />
    </Button>
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
  const { t } = usePiI18n();
  const currentReference =
    item.type === "npm" ? item.currentVersion : item.currentRevision?.slice(0, 12);
  const targetReference =
    item.type === "npm" ? item.targetVersion : item.targetRevision?.slice(0, 12);
  const updateSummary =
    currentReference && targetReference
      ? t("extensions.toolbox.packages.versionChange", {
          current: currentReference,
          target: targetReference,
        })
      : t("extensions.toolbox.packages.updateAvailable");

  return (
    <Button
      variant="ghost"
      type="button"
      aria-current={active ? "page" : undefined}
      title={t("extensions.toolbox.openDetails", { name: item.displayName })}
      className="h-auto w-full min-w-0 items-start justify-start gap-3 px-3 py-4 text-left font-normal whitespace-normal"
      onClick={() => onOpen(item)}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-sm font-medium">{item.displayName}</span>
        <span className="text-muted-foreground mt-1 block truncate text-xs">{item.source}</span>
      </span>
      <span
        className="text-success-foreground max-w-36 shrink-0 font-mono text-xs leading-5 break-words"
        title={updateSummary}
      >
        {updateSummary}
      </span>
      <ChevronRightIcon
        aria-hidden="true"
        className="text-muted-foreground size-(--icon-size-sm) shrink-0"
      />
    </Button>
  );
}

function SearchField({ query, setQuery }: { query: string; setQuery(query: string): void }) {
  const { t } = usePiI18n();

  return (
    <InputGroup className="min-w-0 basis-full [--input-control-height:var(--button-height-large)] @3xl/toolbox-market:basis-64 @3xl/toolbox-market:flex-1">
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
  const { t } = usePiI18n();

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
      {selected ? (
        <ToolboxCapabilityDetails key={selected.capabilityId} params={selected} />
      ) : (
        <div className="flex h-full min-h-64 items-center justify-center p-8">
          <div className="max-w-sm text-center">
            <span className="bg-muted/40 mx-auto flex size-(--button-height-large) items-center justify-center rounded-(--radius)">
              <ToolboxIcon aria-hidden="true" className="size-(--icon-size-lg)" />
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
  const { t } = usePiI18n();
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
      ...(item.currentVersion ? { currentVersion: item.currentVersion } : {}),
      ...(item.targetVersion ? { targetVersion: item.targetVersion } : {}),
      ...(item.currentRevision ? { currentRevision: item.currentRevision } : {}),
      ...(item.targetRevision ? { targetRevision: item.targetRevision } : {}),
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
              className="mt-3"
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
    <section
      aria-label={t("extensions.toolbox.updates")}
      className="@container/toolbox-market flex h-full min-h-0 min-w-0 flex-col overflow-y-auto"
    >
      <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col px-5 py-8 @2xl/toolbox-market:px-10 @2xl/toolbox-market:py-10">
        <div className="mb-7 flex shrink-0 flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-3xl font-medium tracking-tight">
              {t("extensions.toolbox.updates")}
            </h1>
            <p className="text-muted-foreground mt-3 text-base leading-6">
              {t("extensions.toolbox.packages.updateCheckDescription")}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={packageUpdates.loadState === "loading" || packageUpdates.isRefreshing}
            aria-label={t("extensions.toolbox.packages.checkUpdates")}
            title={t("extensions.toolbox.packages.checkUpdates")}

            onClick={() => {
              setSelected(undefined);
              packageUpdates.refresh();
            }}
          >
            <RefreshCwIcon
              aria-hidden="true"
              className={cn(
                (packageUpdates.loadState === "loading" || packageUpdates.isRefreshing) &&
                  "animate-spin motion-reduce:animate-none",
              )}
            />
          </Button>
          {packageUpdates.isRefreshing ? (
            <span className="sr-only" role="status">
              {t("extensions.toolbox.packages.checkingUpdates")}
            </span>
          ) : null}
          {packageUpdates.loadState === "ready" ? (
            <span className="text-muted-foreground text-xs tabular-nums">
              {t("extensions.toolbox.packages.availableUpdatesCount", {
                count: packageUpdates.value.updates.length,
              })}
            </span>
          ) : null}
        </div>

        <div className="grid min-h-[36rem] flex-1 grid-rows-[minmax(12rem,2fr)_minmax(0,3fr)] overflow-hidden rounded-(--radius) border border-border @4xl/toolbox-market:grid-cols-[minmax(16rem,2fr)_minmax(0,3fr)] @4xl/toolbox-market:grid-rows-1">
          <div className="bg-muted/10 min-h-0 min-w-0 overflow-y-auto border-b border-border @4xl/toolbox-market:border-e @4xl/toolbox-market:border-b-0">
            {listContent}
          </div>
          <DetailPane selected={selected} />
        </div>
      </div>
    </section>
  );
}

export function ToolboxMainView({ close, view }: MainViewProps<ToolboxMainViewParams>) {
  const { number, t } = usePiI18n();
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
    enabled: !detailOnly && view.params.section === "packages",
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
      <section
        aria-label={t("extensions.toolbox.title")}
        className="@container/toolbox-market flex h-full min-h-0 min-w-0 flex-col overflow-y-auto"
      >
        <DetailPane selected={view.params.selected} />
      </section>
    );
  }

  if (view.params.section === "updates") return <PackageUpdatesView />;

  if (view.params.section !== "packages") {
    return (
      <ToolboxInstalledView
        key={`${view.revision}:${scope.kind}:${scope.kind === "project" ? scope.workspaceId : ""}`}
        section={view.params.section}
        initialQuery={view.params.query}
      />
    );
  }

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
              className="mt-3"
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
    <section
      aria-label={t("extensions.toolbox.title")}
      className="@container/toolbox-market flex h-full min-h-0 min-w-0 flex-col overflow-y-auto"
    >
      <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col px-5 py-8 @2xl/toolbox-market:px-10 @2xl/toolbox-market:py-10">
        <header className="mb-7 shrink-0">
          <h1 className="text-3xl font-medium tracking-tight">
            {t("extensions.toolbox.packages.title")}
          </h1>
          <p className="text-muted-foreground mt-3 text-base leading-6">
            {t("extensions.toolbox.main.descriptions.packages")}
          </p>
        </header>
        <div className="mb-5 flex shrink-0 flex-wrap items-center gap-3">
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

        <div className="grid min-h-[36rem] flex-1 grid-rows-[minmax(12rem,2fr)_minmax(0,3fr)] overflow-hidden rounded-(--radius) border border-border @4xl/toolbox-market:grid-cols-[minmax(16rem,2fr)_minmax(0,3fr)] @4xl/toolbox-market:grid-rows-1">
          <div className="bg-muted/10 flex min-h-0 min-w-0 flex-col border-b border-border @4xl/toolbox-market:border-e @4xl/toolbox-market:border-b-0">
            <div className="min-h-0 flex-1 overflow-y-auto">{listContent}</div>
            {packageCatalog.loadState === "loading" ? (
              <CatalogPaginationSkeleton />
            ) : packageCatalog.loadState === "ready" && packageCatalog.value.pageCount > 1 ? (
              <nav
                aria-label={t("extensions.toolbox.packages.pagination")}
                className="flex min-h-[calc(var(--button-height-default)+1rem)] shrink-0 items-center justify-between gap-2 border-t border-border px-3 py-2"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={packagePage <= 1}

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
