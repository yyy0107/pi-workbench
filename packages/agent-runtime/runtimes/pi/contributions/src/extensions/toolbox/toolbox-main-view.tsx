"use client";

import {
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LoaderCircleIcon,
  PackageIcon,
  RefreshCwIcon,
  SearchIcon,
  ToolboxIcon,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from "react";

import { Button, Progress, StatusBadge, TooltipIconButton } from "@workbench/shell/ui";
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
import { usePiResourceClient } from "@workbench/agent-runtime-pi-client/resources";
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
import { ToolboxPromptsView } from "./toolbox-prompts-view";
import { ToolboxDetailView, ToolboxInstalledView } from "./toolbox-installed-view";
import { toolboxScopeKey, toolboxScopeMatchesCapability } from "./toolbox-scope";
import { useToolboxScope } from "./toolbox-scope-store";
import { usePiPackageCatalog } from "./use-pi-package-catalog";
import { usePiPackageUpdates } from "./use-pi-package-updates";
import {
  packageUpdateErrorMessageKey,
  updatePackageWithFeedback,
  type PackageUpdateFeedback,
} from "./package-update-feedback";

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

function CatalogSkeleton({ className = "space-y-1 p-2" }: { className?: string }) {
  return (
    <div className={className} aria-hidden="true">
      {CATALOG_SKELETON_ROWS.map((row, index) => (
        <div key={index} className="flex w-full items-start gap-3 rounded-(--radius) px-3 py-4">
          <Skeleton className="size-(--button-height-large) shrink-0 rounded-(--radius)" />
          <div className="min-w-0 flex-1">
            <Skeleton className={cn("h-4 max-w-full", row.name)} />
            <Skeleton className="mt-2 h-3 w-full" />
            <Skeleton className="mt-2 h-3 w-3/4" />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Skeleton className={cn("h-3 max-w-full", row.metadata)} />
              <Skeleton className={cn("h-5 max-w-full", row.type)} />
            </div>
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
      className="grid min-h-[calc(var(--button-height-default)+1rem)] shrink-0 grid-cols-1 items-center gap-2 px-3 py-2 @md/toolbox-market:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]"
      aria-hidden="true"
    >
      <Skeleton className="h-3 w-20 justify-self-center @md/toolbox-market:col-start-2" />
      <div className="flex items-center gap-2 justify-self-end @md/toolbox-market:col-start-3">
        <Skeleton className="size-(--icon-frame-size-default) rounded-(--button-radius)" />
        <Skeleton className="h-3 w-12" />
        <Skeleton className="size-(--icon-frame-size-default) rounded-(--button-radius)" />
      </div>
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
  item,
  onOpen,
}: {
  item: PiPackageCatalogItemView;
  onOpen(item: PiPackageCatalogItemView, event: MouseEvent<HTMLButtonElement>): void;
}) {
  const { number, t } = usePiI18n();

  return (
    <Button
      variant="ghost"
      type="button"
      aria-label={t("extensions.toolbox.openDetails", { name: item.name })}
      className="h-auto w-full min-w-0 items-start justify-start gap-3 px-3 py-[calc(var(--control-content-padding-block-default)*1.5)] text-left font-normal whitespace-normal"
      onClick={(event) => onOpen(item, event)}
    >
      <span className="bg-muted/30 group-hover/button:bg-background flex size-(--button-height-large) shrink-0 items-center justify-center rounded-(--button-radius) transition-colors">
        <PackageIcon
          aria-hidden="true"
          className="[--button-icon-size:calc(var(--icon-size-md)*1.75)]"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base leading-5 font-medium">{item.name}</span>
        <span className="text-muted-foreground mt-1 line-clamp-2 text-sm leading-5">
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
          {item.types.map((type) => (
            <StatusBadge key={type}>
              {t(
                type === "package"
                  ? "extensions.toolbox.packages.types.package"
                  : `extensions.toolbox.packages.filters.${type}`,
              )}
            </StatusBadge>
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

function packageUpdateRowKey(item: PiPackageUpdateView): string {
  return JSON.stringify([
    item.scope,
    item.source,
    item.currentVersion ?? item.currentRevision,
    item.targetVersion ?? item.targetRevision,
  ]);
}

export function PackageUpdateRow({
  item,
  feedback,
  onOpen,
  onUpdate,
}: {
  item: PiPackageUpdateView;
  feedback?: PackageUpdateFeedback;
  onOpen(item: PiPackageUpdateView, event: MouseEvent<HTMLButtonElement>): void;
  onUpdate(item: PiPackageUpdateView): void;
}) {
  const { t } = usePiI18n();
  const updating = feedback?.status === "updating";
  const updated = feedback?.status === "updated";
  const failed = feedback?.status === "failed";
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
    <li className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <Button
        variant="ghost"
        type="button"
        disabled={updating || updated}
        aria-label={t("extensions.toolbox.openDetails", { name: item.displayName })}
        className="h-auto min-w-0 flex-1 justify-start gap-3 px-3 py-[calc(var(--control-content-padding-block-default)*1.5)] text-left font-normal whitespace-normal"
        onClick={(event) => onOpen(item, event)}
      >
        <span className="bg-muted/30 group-hover/button:bg-background flex size-(--button-height-large) shrink-0 items-center justify-center rounded-(--button-radius) transition-colors">
          <PackageIcon
            aria-hidden="true"
            className="[--button-icon-size:calc(var(--icon-size-md)*1.75)]"
          />
        </span>
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-6 gap-y-2">
          <span className="min-w-0 flex-1 basis-48">
            <span className="block truncate text-base leading-5">{item.displayName}</span>
            {item.source !== item.displayName ? (
              <span className="text-muted-foreground mt-1 block truncate text-xs leading-5">
                {item.source}
              </span>
            ) : null}
          </span>
          <span className="text-muted-foreground text-xs leading-5 break-all">
            {currentReference && targetReference ? (
              <span className="font-mono">
                {currentReference} →{" "}
                <span className="text-success-foreground">{targetReference}</span>
              </span>
            ) : (
              updateSummary
            )}
          </span>
        </span>
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={updating || updated}
        aria-busy={updating}
        aria-label={t(
          failed
            ? "extensions.toolbox.packages.retryUpdateNamed"
            : "extensions.toolbox.packages.updateNamed",
          { name: item.displayName },
        )}
        onClick={() => onUpdate(item)}
      >
        {updating ? (
          <LoaderCircleIcon
            aria-hidden="true"
            className="animate-spin motion-reduce:animate-none"
          />
        ) : updated ? (
          <CheckIcon aria-hidden="true" />
        ) : null}
        {t(
          updating
            ? "extensions.toolbox.packages.updating"
            : updated
              ? "extensions.toolbox.packages.updated"
              : failed
                ? "extensions.toolbox.packages.retry"
                : "extensions.toolbox.packages.update",
        )}
      </Button>
      {updating ? (
        <Progress
          value={null}
          aria-label={t("extensions.toolbox.packages.updateNamed", { name: item.displayName })}
          className="basis-full px-3"
        />
      ) : null}
      {failed ? (
        <p role="alert" className="text-destructive basis-full px-3 text-xs leading-5">
          {t(packageUpdateErrorMessageKey(feedback.errorCode))}
        </p>
      ) : updated ? (
        <p role="status" className="text-success-foreground basis-full px-3 text-xs leading-5">
          {t("extensions.toolbox.packages.updateSuccess")}
        </p>
      ) : null}
    </li>
  );
}

function SearchField({
  query,
  setQuery,
  inputRef,
}: {
  query: string;
  setQuery(query: string): void;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const { t } = usePiI18n();

  return (
    <InputGroup className="min-w-0 basis-full @3xl/toolbox-market:basis-64 @3xl/toolbox-market:flex-1">
      <InputGroupAddon>
        <SearchIcon aria-hidden="true" />
      </InputGroupAddon>
      <InputGroupInput
        ref={inputRef}
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
  const resourceClient = usePiResourceClient();
  const scope = useToolboxScope();
  const workspaces = usePiWorkspaces();
  const project =
    scope.kind === "project"
      ? workspaces.find((workspace) => workspace.id === scope.workspaceId)
      : undefined;
  const workspaceId = project?.id;
  const target = useMemo(
    () =>
      scope.kind === "user"
        ? { scope: "user" as const }
        : workspaceId
          ? { scope: "project" as const, workspaceId }
          : undefined,
    [scope.kind, workspaceId],
  );
  const packageUpdates = usePiPackageUpdates(target);
  const [selected, setSelected] = useState<ToolboxCapabilitySurfaceParams>();
  const [feedback, setFeedback] = useState<Record<string, PackageUpdateFeedback>>({});
  const inFlight = useRef(new Set<string>());
  const previousItem = useRef<HTMLButtonElement | null>(null);
  const backButton = useRef<HTMLButtonElement | null>(null);
  const refreshButton = useRef<HTMLButtonElement | null>(null);
  const checking = packageUpdates.loadState === "loading" || packageUpdates.isRefreshing;
  const availableCount = packageUpdates.value.updates.filter(
    (item) => feedback[packageUpdateRowKey(item)]?.status !== "updated",
  ).length;

  useEffect(() => setSelected(undefined), [target]);
  useEffect(() => {
    if (selected) backButton.current?.focus();
    else if (previousItem.current) {
      const destination = previousItem.current.isConnected
        ? previousItem.current
        : refreshButton.current;
      destination?.focus({ preventScroll: true });
    }
  }, [selected]);

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
  const updatePackage = (item: PiPackageUpdateView) => {
    const key = packageUpdateRowKey(item);
    const sourceKey = `${item.scope}:${item.source}`;
    if (
      !target ||
      item.scope !== target.scope ||
      inFlight.current.has(sourceKey) ||
      feedback[key]?.status === "updated"
    )
      return;
    inFlight.current.add(sourceKey);
    void updatePackageWithFeedback(
      resourceClient,
      { source: item.source, target },
      (nextFeedback) => setFeedback((current) => ({ ...current, [key]: nextFeedback })),
    ).then(() => inFlight.current.delete(sourceKey));
  };

  const listContent = (() => {
    if (!target) return <EmptyState>{t("extensions.toolbox.scopeUnavailable")}</EmptyState>;
    if (packageUpdates.loadState === "loading") {
      return (
        <ul
          aria-busy="true"
          aria-label={t("extensions.toolbox.packages.checkingUpdates")}
          className="divide-y divide-border"
        >
          {[0, 1, 2, 3, 4].map((item) => (
            <li key={item} aria-hidden="true" className="flex items-center gap-3 px-3 py-4">
              <Skeleton className="size-(--button-height-large) shrink-0 rounded-(--button-radius)" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="mt-2 h-3 w-1/3" />
              </div>
              <Skeleton className="h-(--button-height-default) w-16 rounded-(--button-radius)" />
            </li>
          ))}
        </ul>
      );
    }
    if (packageUpdates.loadState === "failed") {
      return (
        <EmptyState>
          <div role="alert">
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
      return (
        <EmptyState>
          <div role="status">
            <CheckIcon
              aria-hidden="true"
              className="text-success-foreground mx-auto mb-3 size-(--icon-size-lg)"
            />
            <p>{t("extensions.toolbox.packages.upToDate")}</p>
          </div>
        </EmptyState>
      );
    }
    return (
      <ul className="divide-y divide-border">
        {packageUpdates.value.updates.map((item) => (
          <PackageUpdateRow
            key={packageUpdateRowKey(item)}
            item={item}
            feedback={feedback[packageUpdateRowKey(item)]}
            onUpdate={updatePackage}
            onOpen={(nextItem, event) => {
              previousItem.current = event.currentTarget;
              setSelected(updateParams(nextItem));
            }}
          />
        ))}
      </ul>
    );
  })();

  return (
    <section
      aria-label={t("extensions.toolbox.updates")}
      className="@container/toolbox-market flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
    >
      <div hidden={Boolean(selected)} className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col px-5 py-8 @2xl/toolbox-market:px-10 @2xl/toolbox-market:py-10">
          <header className="mb-7 flex shrink-0 flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-medium tracking-tight">
                  {t("extensions.toolbox.updates")}
                </h1>
                {packageUpdates.loadState === "ready" ? (
                  <span role="status" className="text-muted-foreground text-sm tabular-nums">
                    {t("extensions.toolbox.packages.availableUpdatesCount", {
                      count: availableCount,
                    })}
                  </span>
                ) : null}
              </div>
              <p className="text-muted-foreground mt-3 text-base leading-6">
                {t("extensions.toolbox.packages.updateCheckDescription")}
              </p>
            </div>
            <Button
              ref={refreshButton}
              type="button"
              variant="outline"
              size="sm"
              disabled={!target || checking}
              aria-busy={checking}
              aria-label={t("extensions.toolbox.packages.checkUpdates")}
              onClick={packageUpdates.refresh}
            >
              <RefreshCwIcon
                aria-hidden="true"
                className={cn(checking && "animate-spin motion-reduce:animate-none")}
              />
              {t("extensions.toolbox.packages.checkUpdatesAction")}
            </Button>
            {checking ? (
              <span className="sr-only" role="status">
                {t("extensions.toolbox.packages.checkingUpdates")}
              </span>
            ) : null}
          </header>
          {packageUpdates.refreshFailed ? (
            <p role="alert" className="text-destructive mb-3 shrink-0 text-xs leading-5">
              {t("extensions.toolbox.packages.updateCheckFailed")}
            </p>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-border [scrollbar-gutter:stable]">
            {listContent}
          </div>
        </div>
      </div>
      {selected ? (
        <ToolboxDetailView
          params={selected}
          listTitle={t("extensions.toolbox.updates")}
          backButtonRef={backButton}
          onBack={() => setSelected(undefined)}
        />
      ) : null}
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
  const previousItem = useRef<HTMLButtonElement | null>(null);
  const backButton = useRef<HTMLButtonElement | null>(null);
  const searchInput = useRef<HTMLInputElement | null>(null);
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
    if (detailOnly || view.params.section !== "packages") return;
    if (selected) backButton.current?.focus();
    else if (previousItem.current) {
      const target = previousItem.current.isConnected ? previousItem.current : searchInput.current;
      target?.focus({ preventScroll: true });
    }
  }, [detailOnly, selected, view.params.section]);

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

  if (view.params.section === "updates") return <PackageUpdatesView key={toolboxScopeKey(scope)} />;

  if (view.params.section === "prompts")
    return (
      <ToolboxPromptsView
        key={`${view.revision}:${toolboxScopeKey(scope)}`}
        initialQuery={view.params.query}
      />
    );

  if (view.params.section !== "packages") {
    return (
      <ToolboxInstalledView
        key={`${view.revision}:${scope.kind}:${scope.kind === "project" ? scope.workspaceId : ""}`}
        section={view.params.section}
        initialQuery={view.params.query}
      />
    );
  }

  const listContent = (() => {
    if (packageCatalog.loadState === "loading") {
      return (
        <CatalogSkeleton className="grid grid-cols-1 gap-x-6 gap-y-3 @2xl/toolbox-market:grid-cols-2" />
      );
    }
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
      <ul className="grid grid-cols-1 gap-x-6 gap-y-3 @2xl/toolbox-market:grid-cols-2">
        {packageCatalog.value.packages.map((item) => (
          <li key={item.name} className="min-w-0">
            <MainPackageRow
              item={item}
              onOpen={(nextItem, event) => {
                previousItem.current = event.currentTarget;
                setSelected(packageSurfaceParams(nextItem));
              }}
            />
          </li>
        ))}
      </ul>
    );
  })();

  return (
    <section
      aria-label={t("extensions.toolbox.title")}
      className="@container/toolbox-market flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
    >
      <div hidden={Boolean(selected)} className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col px-5 py-8 @2xl/toolbox-market:px-10 @2xl/toolbox-market:py-10">
          <header className="mb-7 shrink-0">
            <h1 className="text-3xl font-medium tracking-tight">
              {t("extensions.toolbox.packages.title")}
            </h1>
            <p className="text-muted-foreground mt-3 text-base leading-6">
              {t("extensions.toolbox.main.descriptions.packages")}
            </p>
          </header>
          <div className="mb-5 flex shrink-0 flex-wrap items-center gap-3">
            <SearchField query={query} setQuery={setQuery} inputRef={searchInput} />
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs">
                {t("extensions.toolbox.packages.typeFilter")}
              </span>
              <ToolbarSelect<PackageTypeFilter>
                value={packageType}
                label={t("extensions.toolbox.packages.typeFilter")}
                options={(["all", "extension", "skill", "prompt", "theme"] as const).map(
                  (type) => ({
                    value: type,
                    label: t(`extensions.toolbox.packages.filters.${type}`),
                  }),
                )}
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
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            {packageCatalog.loadState === "loading" && !packageCatalog.hasValue ? (
              <CatalogPaginationSkeleton />
            ) : packageCatalog.hasValue ? (
              <nav
                aria-label={t("extensions.toolbox.packages.pagination")}
                aria-busy={packageCatalog.loadState === "loading"}
                className="grid min-h-[calc(var(--button-height-default)+1rem)] shrink-0 grid-cols-1 items-center gap-2 px-3 py-2 @md/toolbox-market:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]"
              >
                <span className="text-muted-foreground justify-self-center text-xs tabular-nums @md/toolbox-market:col-start-2">
                  {t("extensions.toolbox.main.resultsCount", {
                    count: packageCatalog.value.filteredTotal,
                  })}
                </span>
                {packageCatalog.value.pageCount > 1 ? (
                  <div className="flex items-center gap-2 justify-self-end @md/toolbox-market:col-start-3">
                    <TooltipIconButton
                      type="button"
                      size="icon"
                      tooltip={t("extensions.toolbox.packages.previous")}
                      disabled={packageCatalog.loadState !== "ready" || packagePage <= 1}
                      onClick={() => setPackagePage((page) => Math.max(1, page - 1))}
                    >
                      <ChevronLeftIcon aria-hidden="true" />
                    </TooltipIconButton>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {t("extensions.toolbox.packages.page", {
                        page: number(packageCatalog.value.page),
                        count: number(packageCatalog.value.pageCount),
                      })}
                    </span>
                    <TooltipIconButton
                      type="button"
                      size="icon"
                      tooltip={t("extensions.toolbox.packages.next")}
                      disabled={
                        packageCatalog.loadState !== "ready" ||
                        packagePage >= packageCatalog.value.pageCount
                      }
                      onClick={() => setPackagePage((page) => page + 1)}
                    >
                      <ChevronRightIcon aria-hidden="true" />
                    </TooltipIconButton>
                  </div>
                ) : null}
              </nav>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-border pt-3 [scrollbar-gutter:stable]">
              {listContent}
            </div>
          </div>
        </div>
      </div>
      {selected ? (
        <ToolboxDetailView
          params={selected}
          listTitle={t("extensions.toolbox.packages.title")}
          backButtonRef={backButton}
          onBack={() => setSelected(undefined)}
        />
      ) : null}
    </section>
  );
}
