"use client";

import {
  ArrowLeftIcon,
  BoxIcon,
  CheckIcon,
  FileTextIcon,
  Globe2Icon,
  PackageIcon,
  PlugIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState, type MouseEvent, type Ref } from "react";

import { useMainViewService } from "@workbench/extension-host";
import {
  Button,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Skeleton,
  StatusBadge,
} from "@workbench/shell/ui";
import { cn } from "@workbench/shell/utils";

import { definePiMessage, usePiI18n } from "../../i18n";
import {
  browserCapabilityPresentation,
  type ToolboxCapabilitySurfaceParams,
  type ToolboxMainSection,
} from "./toolbox-capability";
import { ToolboxCapabilityDetails } from "./toolbox-capability-surface";
import { useToolboxCatalogs, type ToolboxCapabilityItem } from "./toolbox-catalog";
import { useToolboxScope } from "./toolbox-scope-store";
import { ToolboxResourceGroup } from "./toolbox-resource-group";
import { withTooltip } from "@workbench/shell/ui";

type InstalledSection = Exclude<ToolboxMainSection, "packages" | "updates">;

const CAPABILITY_ICONS = {
  skill: BoxIcon,
  extension: PlugIcon,
  prompt: FileTextIcon,
  package: PackageIcon,
};

export function ToolboxResourceList({
  items,
  query,
  groupBySource = false,
  onOpen,
}: {
  items: readonly ToolboxCapabilityItem[];
  query: string;
  groupBySource?: boolean;
  onOpen(item: ToolboxCapabilityItem, event: MouseEvent<HTMLButtonElement>): void;
}) {
  const { locale, t } = usePiI18n();
  const normalizedQuery = query.trim().toLocaleLowerCase(locale);
  const visibleItems = items.filter((item) =>
    item.searchText.toLocaleLowerCase(locale).includes(normalizedQuery),
  );

  if (visibleItems.length === 0) {
    return (
      <p role="status" className="text-muted-foreground py-12 text-center text-sm">
        {t("extensions.toolbox.noMatches")}
      </p>
    );
  }

  const groups = groupBySource
    ? [
        {
          id: "package",
          title: t("extensions.toolbox.extensions.groups.package"),
          description: t("extensions.toolbox.extensions.groupDescriptions.package"),
          items: visibleItems.filter(
            (item) => !item.params.builtin && item.params.origin === "package",
          ),
        },
        {
          id: "custom",
          title: t("extensions.toolbox.extensions.groups.custom"),
          description: t("extensions.toolbox.extensions.groupDescriptions.custom"),
          items: visibleItems.filter(
            (item) => !item.params.builtin && item.params.origin !== "package",
          ),
        },
        {
          id: "workbench",
          title: t("extensions.toolbox.extensions.groups.workbench"),
          description: t("extensions.toolbox.extensions.groupDescriptions.workbench"),
          items: visibleItems.filter(
            (item) => item.params.builtin && item.params.provenance?.kind === "workbench",
          ),
        },
        {
          id: "builtin",
          title: t("extensions.toolbox.extensions.groups.builtin"),
          description: t("extensions.toolbox.extensions.groupDescriptions.builtin"),
          items: visibleItems.filter(
            (item) => item.params.builtin && item.params.provenance?.kind !== "workbench",
          ),
        },
      ]
    : [{ id: "all", title: undefined, description: undefined, items: visibleItems }];

  return groups
    .filter((group) => group.items.length > 0)
    .map((group) => (
      <Fragment key={group.id}>
        {group.title ? (
          <div className="mt-8 mb-3 border-b border-border px-3 pb-4">
            <h2 className="text-base font-medium">{group.title}</h2>
            <p className="text-muted-foreground mt-1 text-sm leading-5">{group.description}</p>
          </div>
        ) : null}
        <ToolboxResourceGroup
          items={group.items}
          query={query}
          renderItem={(item) => {
            const Icon = browserCapabilityPresentation(item.params, t)
              ? Globe2Icon
              : CAPABILITY_ICONS[item.kind];
            const disabled = item.params.enabled === false;
            const status =
              item.params.builtin && item.params.enabled === undefined
                ? t("extensions.toolbox.status.loaded")
                : item.params.enabled !== undefined
                  ? t(
                      disabled
                        ? "extensions.toolbox.skills.disabledStatus"
                        : "extensions.toolbox.skills.enabledStatus",
                    )
                  : t(
                      item.params.installed
                        ? "extensions.toolbox.status.installed"
                        : "extensions.toolbox.status.available",
                    );
            const description =
              item.description || item.params.source || item.params.invocationName;
            return (
              <li key={item.id} className="min-w-0">
                <Button
                  variant="ghost"
                  size="lg"
                  aria-label={t("extensions.toolbox.openDetails", { name: item.name })}
                  className={cn(
                    "h-auto w-full min-w-0 justify-start gap-3 px-3 py-[calc(var(--control-content-padding-block-default)*1.5)] text-left font-normal whitespace-normal",
                    disabled && "text-muted-foreground",
                  )}
                  onClick={(event) => onOpen(item, event)}
                >
                  <span
                    className={cn(
                      "bg-muted/30 group-hover/button:bg-card flex w-[var(--button-height-large)] shrink-0 items-center justify-center self-stretch rounded-[var(--button-radius)] transition-colors",
                      (item.kind === "skill" || item.kind === "extension") &&
                        !disabled &&
                        "text-info-foreground",
                    )}
                  >
                    <Icon
                      aria-hidden="true"
                      className="[--button-icon-size:calc(var(--icon-size-md)*1.75)]"
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-base leading-5">{item.name}</span>
                      {item.params.builtin ? (
                        <StatusBadge className="shrink-0">
                          {t("extensions.toolbox.status.builtin")}
                        </StatusBadge>
                      ) : null}
                    </span>
                    {description
                      ? withTooltip(
                          <span
                            title={description}
                            className={cn(
                              "text-muted-foreground mt-0.5 text-sm leading-5",
                              item.kind === "extension" ? "line-clamp-3" : "block truncate",
                            )}
                          >
                            {description}
                          </span>,
                        )
                      : null}
                  </span>
                  {disabled || item.params.builtin ? (
                    <span className="text-muted-foreground shrink-0 text-xs">{status}</span>
                  ) : (
                    withTooltip(
                      <span className="text-muted-foreground shrink-0" title={status}>
                        <CheckIcon aria-hidden="true" className="size-[var(--icon-size-md)]" />
                        <span className="sr-only">{status}</span>
                      </span>,
                      0,
                    )
                  )}
                </Button>
              </li>
            );
          }}
        />
      </Fragment>
    ));
}

export function ToolboxInstalledView({
  section,
  initialQuery = "",
}: {
  section: InstalledSection;
  initialQuery?: string;
}) {
  const { t } = usePiI18n();
  const mainViews = useMainViewService();
  const scope = useToolboxScope();
  const kinds = {
    skills: "skill",
    extensions: "extension",
    prompts: "prompt",
    installed: "package",
  } as const;
  const catalogs = useToolboxCatalogs(scope, kinds[section]);
  const [query, setQuery] = useState(initialQuery);
  const [selected, setSelected] = useState<ToolboxCapabilitySurfaceParams>();
  const previousItem = useRef<HTMLButtonElement | null>(null);
  const backButton = useRef<HTMLButtonElement | null>(null);
  const searchInput = useRef<HTMLInputElement | null>(null);
  const { catalog, items } = {
    skills: { catalog: catalogs.skillsCatalog, items: catalogs.skillItems },
    extensions: { catalog: catalogs.extensionsCatalog, items: catalogs.extensionItems },
    prompts: { catalog: catalogs.promptsCatalog, items: catalogs.promptItems },
    installed: { catalog: catalogs.packagesCatalog, items: catalogs.packageItems },
  }[section];
  const title = t(
    section === "installed"
      ? "extensions.toolbox.packages.installedTitle"
      : `extensions.toolbox.${section}.title`,
  );
  const searchLabel = t("extensions.toolbox.main.searchIn", { name: title });
  const empty = t(
    section === "installed"
      ? "extensions.toolbox.packages.empty"
      : `extensions.toolbox.${section}.empty`,
  );

  useEffect(() => {
    if (selected) backButton.current?.focus();
    else if (previousItem.current) {
      const target = previousItem.current.isConnected ? previousItem.current : searchInput.current;
      target?.focus({ preventScroll: true });
    }
  }, [selected]);

  return (
    <section aria-label={title} className="@container flex h-full min-h-0 min-w-0 flex-col">
      <div
        hidden={Boolean(selected)}
        className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]"
      >
        <div className="mx-auto w-full max-w-5xl px-5 py-8 @2xl:px-10 @2xl:py-10">
          <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-foreground text-3xl font-medium tracking-tight">{title}</h1>
              <p className="text-muted-foreground mt-3 text-base leading-6">
                {t(`extensions.toolbox.main.descriptions.${section}`)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                disabled={!catalog.hasTargets || catalog.loadState === "loading"}
                aria-label={t("extensions.toolbox.main.refresh")}
                title={t("extensions.toolbox.main.refresh")}
                onClick={catalog.refresh}
              >
                <RefreshCwIcon aria-hidden="true" />
              </Button>
              <Button
                onClick={() =>
                  mainViews.open({
                    kind: "toolbox",
                    title: definePiMessage("extensions.toolbox.packages.title"),
                    params: { section: "packages" },
                  })
                }
              >
                <PlusIcon aria-hidden="true" />
                {t("extensions.toolbox.addCapability")}
              </Button>
            </div>
          </header>
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              ref={searchInput}
              type="search"
              autoComplete="off"
              spellCheck={false}
              value={query}
              aria-label={searchLabel}
              placeholder={searchLabel}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </InputGroup>
          {section !== "extensions" ? (
            <h2 className="mt-8 mb-3 border-b px-3 pb-4 text-base font-medium">
              {t("extensions.toolbox.status.installed")}
            </h2>
          ) : null}
          {!catalog.hasTargets ? (
            <p role="status" className="text-muted-foreground py-12 text-center text-sm">
              {t("extensions.toolbox.scopeUnavailable")}
            </p>
          ) : catalog.loadState === "loading" || catalog.loadState === "idle" ? (
            <div
              aria-busy="true"
              aria-label={t("extensions.toolbox.main.loading")}
              className="grid grid-cols-1 gap-x-6 gap-y-3 @2xl:grid-cols-2"
            >
              {[0, 1, 2, 3, 4, 5].map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-3 px-3 py-[calc(var(--control-content-padding-block-default)*1.5)]"
                  aria-hidden="true"
                >
                  <Skeleton className="w-[var(--button-height-large)] shrink-0 self-stretch rounded-[var(--button-radius)]" />
                  <div className="min-w-0 flex-1">
                    <Skeleton className="h-5 w-1/2" />
                    <Skeleton className="mt-0.5 h-5 w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : catalog.loadState === "failed" ? (
            <div role="alert" className="text-muted-foreground py-12 text-center text-sm">
              <p>{t("extensions.toolbox.loadFailed")}</p>
              <Button variant="outline" className="mt-3" onClick={catalog.refresh}>
                {t("extensions.toolbox.packages.retry")}
              </Button>
            </div>
          ) : items.length === 0 ? (
            <p role="status" className="text-muted-foreground py-12 text-center text-sm">
              {empty}
            </p>
          ) : (
            <ToolboxResourceList
              items={items}
              query={query}
              groupBySource={section === "extensions"}
              onOpen={(item, event) => {
                previousItem.current = event.currentTarget;
                setSelected(item.params);
              }}
            />
          )}
        </div>
      </div>
      {selected ? (
        <ToolboxDetailView
          params={selected}
          listTitle={title}
          backButtonRef={backButton}
          onBack={() => setSelected(undefined)}
        />
      ) : null}
    </section>
  );
}

export function ToolboxDetailView({
  params,
  listTitle,
  backButtonRef,
  onBack,
}: {
  params: ToolboxCapabilitySurfaceParams;
  listTitle: string;
  backButtonRef: Ref<HTMLButtonElement>;
  onBack(): void;
}) {
  const { t } = usePiI18n();

  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 overflow-y-auto border-b border-border [scrollbar-gutter:stable]">
        <div className="mx-auto w-full max-w-5xl px-5 py-3 @2xl:px-10">
          <Button
            ref={backButtonRef}
            variant="ghost"
            className="justify-start px-0"
            onClick={onBack}
          >
            <ArrowLeftIcon aria-hidden="true" />
            {t("extensions.toolbox.main.backToList", { name: listTitle })}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <ToolboxCapabilityDetails key={params.capabilityId} params={params} />
      </div>
    </div>
  );
}
