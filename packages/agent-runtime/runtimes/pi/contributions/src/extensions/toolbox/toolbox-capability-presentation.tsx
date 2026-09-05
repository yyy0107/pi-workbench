"use client";

import {
  AnchorIcon,
  BoxIcon,
  ChevronRightIcon,
  Code2Icon,
  ExternalLinkIcon,
  EyeIcon,
  FileTextIcon,
  FolderOpenIcon,
  LoaderCircleIcon,
  PaletteIcon,
  PlugIcon,
  TerminalIcon,
  Trash2Icon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { MarkdownTextContent } from "@workbench/shell/chat";
import { Button, StatusBadge, Switch, buttonVariants } from "@workbench/shell/ui";

import { usePiI18n } from "../../i18n";
import type { PiPackageResourceView } from "@workbench/agent-runtime-pi-protocol/rpc";
import type { ToolboxCapabilitySurfaceParams } from "./toolbox-capability";

type DetailsLoadState = "idle" | "loading" | "ready" | "failed";
type ResourceMutationState = "idle" | "updating" | "removing" | "failed" | "removed";

interface PackageDetailsSummary {
  name?: string;
  version?: string;
  author?: string;
  license?: string;
  dependencyCount?: number;
  peerDependencyCount?: number;
  manifestJson?: string;
}

interface PackageUpdateSummary {
  currentVersion?: string;
  targetVersion?: string;
  currentRevision?: string;
  targetRevision?: string;
}

type SkillDocumentMode = "preview" | "source";

function DetailField({
  label,
  children,
  inline = false,
}: {
  label: string;
  children: ReactNode;
  inline?: boolean;
}) {
  return (
    <div
      className={
        inline
          ? "grid min-w-0 grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-baseline gap-x-5 gap-y-1 @lg/toolbox-detail:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]"
          : "grid min-w-0 gap-1"
      }
    >
      <dt
        className={
          inline ? "text-muted-foreground text-sm" : "text-muted-foreground text-xs font-medium"
        }
      >
        {label}
      </dt>
      <dd className="min-w-0 text-sm leading-6 break-words">{children}</dd>
    </div>
  );
}

function DetailExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs whitespace-nowrap underline underline-offset-4 transition-colors"
    >
      {children}
      <ExternalLinkIcon aria-hidden="true" className="size-(--icon-size-sm)" />
    </a>
  );
}

function CapabilityNames({ names, empty }: { names: readonly string[]; empty: string }) {
  if (names.length === 0) return <span className="text-muted-foreground text-sm">{empty}</span>;

  return (
    <div className="flex flex-wrap gap-1.5">
      {names.map((name) => (
        <StatusBadge key={name} className="max-w-full leading-5 break-all">
          {name}
        </StatusBadge>
      ))}
    </div>
  );
}

function ResourceGroup({
  label,
  count,
  children,
}: {
  label: string;
  count?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0">
      <h2 className="mb-1 flex items-baseline gap-2 border-b border-border pb-3 text-base font-semibold">
        {label}
        {count !== undefined ? (
          <span className="text-muted-foreground text-sm font-normal tabular-nums">{count}</span>
        ) : null}
      </h2>
      {children}
    </section>
  );
}

function ResourceRowContent({
  icon: Icon,
  name,
  description,
}: {
  icon: LucideIcon;
  name: string;
  description?: string;
}) {
  return (
    <>
      <span className="bg-muted/40 text-muted-foreground flex size-(--button-height-default) shrink-0 items-center justify-center rounded-(--button-radius)">
        <Icon aria-hidden="true" className="size-(--icon-size-md)" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm leading-5" title={name}>
          {name}
        </span>
        {description ? (
          <span
            className="text-muted-foreground line-clamp-2 text-sm leading-5"
            title={description}
          >
            {description}
          </span>
        ) : null}
      </span>
    </>
  );
}

function ExtensionContributionGroup({
  icon,
  label,
  names,
  getDescription,
}: {
  icon: LucideIcon;
  label: string;
  names: readonly string[];
  getDescription?: (name: string) => string | undefined;
}) {
  const { number } = usePiI18n();
  if (names.length === 0) return null;

  return (
    <ResourceGroup label={label} count={number(names.length)}>
      <ul className="divide-y divide-border">
        {names.map((name) => (
          <li
            key={name}
            className="flex min-w-0 items-center gap-3 py-(--control-content-padding-block-default)"
          >
            <ResourceRowContent icon={icon} name={name} description={getDescription?.(name)} />
          </li>
        ))}
      </ul>
    </ResourceGroup>
  );
}

function ExtensionContributionsPanel({ params }: { params: ToolboxCapabilitySurfaceParams }) {
  const { number, t } = usePiI18n();

  return (
    <section className="min-w-0 space-y-8">
      {![params.eventNames, params.toolNames, params.commandNames].some(
        (names) => names?.length,
      ) ? (
        <ResourceGroup label={t("extensions.toolbox.details.contributions")} count={number(0)}>
          <p className="text-muted-foreground py-4 text-sm">
            {t("extensions.toolbox.details.none")}
          </p>
        </ResourceGroup>
      ) : null}
      <ExtensionContributionGroup
        icon={WrenchIcon}
        getDescription={(name) =>
          params.toolDetails?.find((detail) => detail.name === name)?.description
        }
        label={t("extensions.toolbox.details.tools")}
        names={params.toolNames ?? []}
      />
      <ExtensionContributionGroup
        icon={TerminalIcon}
        getDescription={(name) =>
          params.commandDetails?.find((detail) => detail.name === name)?.description
        }
        label={t("extensions.toolbox.details.commands")}
        names={params.commandNames ?? []}
      />
      <ExtensionContributionGroup
        icon={AnchorIcon}
        label={t("extensions.toolbox.details.events")}
        names={params.eventNames ?? []}
      />
    </section>
  );
}

export function CapabilityMetadataFields({ params }: { params: ToolboxCapabilitySurfaceParams }) {
  const { t } = usePiI18n();
  const isPrompt = params.capabilityKind === "prompt";
  const isInstalledPackage = params.capabilityKind === "package" && params.installed === true;
  const scopeLabel = (scope: "user" | "project" | "temporary") =>
    scope === "project" && params.projectName
      ? t("extensions.toolbox.details.projectScope", { project: params.projectName })
      : t(`extensions.toolbox.scopes.${scope}`);

  if (params.builtin) {
    return (
      <>
        <DetailField label={t("extensions.toolbox.details.origin")}>
          {t("extensions.toolbox.origins.builtin")}
        </DetailField>
        <DetailField label={t("extensions.toolbox.details.scope")}>
          {t("extensions.toolbox.builtins.scope")}
        </DetailField>
      </>
    );
  }

  if (isInstalledPackage) {
    return (
      <>
        <DetailField label={t("extensions.toolbox.details.source")}>
          <code className="text-xs break-all">{params.source}</code>
        </DetailField>
        <DetailField label={t("extensions.toolbox.details.scope")}>
          {params.packageScope
            ? scopeLabel(params.packageScope)
            : t("extensions.toolbox.details.notExposed")}
        </DetailField>
        <DetailField label={t("extensions.toolbox.details.resourceSelection")}>
          {t(
            params.packageFiltered
              ? "extensions.toolbox.packages.filteredResources"
              : "extensions.toolbox.packages.allResources",
          )}
        </DetailField>
      </>
    );
  }

  if (isPrompt) {
    return (
      <>
        <DetailField label={t("extensions.toolbox.details.invocation")}>
          <code className="text-xs">/{params.invocationName}</code>
        </DetailField>
        <DetailField label={t("extensions.toolbox.details.arguments")}>
          {params.argumentHint || t("extensions.toolbox.details.none")}
        </DetailField>
        <DetailField label={t("extensions.toolbox.details.source")}>
          <code className="text-xs break-all">{params.source}</code>
        </DetailField>
        <DetailField label={t("extensions.toolbox.details.scope")}>
          {params.scope ? scopeLabel(params.scope) : t("extensions.toolbox.details.notExposed")}
        </DetailField>
        <DetailField label={t("extensions.toolbox.details.origin")}>
          {params.origin
            ? t(`extensions.toolbox.origins.${params.origin}`)
            : t("extensions.toolbox.details.notExposed")}
        </DetailField>
      </>
    );
  }

  return (
    <>
      <DetailField label={t("extensions.toolbox.details.source")}>
        <code className="text-xs break-all">{params.source}</code>
      </DetailField>
      <DetailField label={t("extensions.toolbox.details.scope")}>
        {params.scope ? scopeLabel(params.scope) : t("extensions.toolbox.details.notExposed")}
      </DetailField>
      <DetailField label={t("extensions.toolbox.details.origin")}>
        {params.origin
          ? t(`extensions.toolbox.origins.${params.origin}`)
          : t("extensions.toolbox.details.notExposed")}
      </DetailField>
    </>
  );
}

export function PackageInstallContents({
  types,
  catalogTypes,
  loadState,
}: {
  types?: ToolboxCapabilitySurfaceParams["packageTypes"];
  catalogTypes?: ToolboxCapabilitySurfaceParams["packageTypes"];
  loadState: DetailsLoadState;
}) {
  const { t } = usePiI18n();

  return (
    <section className="mb-5" aria-live="polite">
      <h2 className="mb-2 text-sm font-semibold">
        {t("extensions.toolbox.packages.installContents")}
      </h2>
      {types ? (
        <>
          <CapabilityNames
            names={types.map((type) => t(`extensions.toolbox.packages.types.${type}`))}
            empty={t("extensions.toolbox.details.none")}
          />
          {catalogTypes?.includes("prompt") && !types.includes("prompt") ? (
            <p className="text-muted-foreground mt-2 text-xs leading-5">
              {t("extensions.toolbox.packages.noBundledPrompts")}
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-muted-foreground text-xs leading-5">
          {t(
            loadState === "failed"
              ? "extensions.toolbox.packages.installContentsUnavailable"
              : "extensions.toolbox.main.loading",
          )}
        </p>
      )}
    </section>
  );
}

const PACKAGE_RESOURCE_GROUPS = [
  { type: "skill", icon: BoxIcon },
  { type: "prompt", icon: FileTextIcon },
  { type: "extension", icon: PlugIcon },
  { type: "theme", icon: PaletteIcon },
] as const;

export function PackageResourceSections({
  types,
  resources,
  installedVersion,
  loadState,
  onRefresh,
}: {
  types: NonNullable<ToolboxCapabilitySurfaceParams["packageTypes"]>;
  resources?: readonly PiPackageResourceView[];
  installedVersion?: string;
  loadState: DetailsLoadState;
  onRefresh(): void;
}) {
  const { number, t } = usePiI18n();
  return (
    <div className="mt-8 space-y-8" aria-live="polite">
      {resources ? (
        <p className="text-muted-foreground text-xs leading-5">
          {installedVersion
            ? t("extensions.toolbox.packages.installedResourceVersion", {
                version: installedVersion,
              })
            : t("extensions.toolbox.packages.installedResources")}
        </p>
      ) : null}
      {PACKAGE_RESOURCE_GROUPS.filter(
        ({ type }) => types.includes(type) || resources?.some((item) => item.type === type),
      ).map(({ type, icon }) => {
        const items = resources?.filter((item) => item.type === type);
        return (
          <ResourceGroup
            key={type}
            label={t(`extensions.toolbox.packages.types.${type}`)}
            count={items ? number(items.length) : undefined}
          >
            {items?.length ? (
              <ul className="divide-y divide-border">
                {items.map((item, index) => (
                  <li key={`${item.name}:${index}`} className="py-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <ResourceRowContent
                        icon={icon}
                        name={item.name}
                        description={
                          item.description ||
                          (item.type === "extension" &&
                          item.eventNames &&
                          item.toolNames &&
                          item.commandNames
                            ? t("extensions.toolbox.extensions.capabilitySummary", {
                                events: item.eventNames.length,
                                tools: item.toolNames.length,
                                commands: item.commandNames.length,
                              })
                            : t("extensions.toolbox.packages.resourceDescriptionUnavailable"))
                        }
                      />
                      {!item.enabled ? (
                        <StatusBadge>{t("extensions.toolbox.skills.disabledStatus")}</StatusBadge>
                      ) : null}
                    </div>
                    {item.type === "extension" ? (
                      <dl className="mt-2 grid gap-2 text-xs leading-5">
                        {(
                          [
                            ["commands", item.commandNames],
                            ["tools", item.toolNames],
                            ["events", item.eventNames],
                          ] as const
                        ).map(([kind, names]) =>
                          names?.length ? (
                            <div key={kind} className="flex flex-wrap gap-x-3">
                              <dt className="text-muted-foreground">
                                {t(`extensions.toolbox.details.${kind}`)}
                              </dt>
                              <dd className="min-w-0 break-words">{names.join(" · ")}</dd>
                            </div>
                          ) : null,
                        )}
                      </dl>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground py-4 text-sm leading-6">
                {items
                  ? t("extensions.toolbox.packages.resourcesEmpty")
                  : loadState === "loading" || loadState === "idle"
                    ? t("extensions.toolbox.main.loading")
                    : loadState === "failed"
                      ? t("extensions.toolbox.packages.resourcesLoadFailed")
                      : t("extensions.toolbox.packages.resourceDetailsUnavailable", {
                          kind: t(`extensions.toolbox.packages.types.${type}`),
                        })}
              </p>
            )}
          </ResourceGroup>
        );
      })}
      {loadState === "failed" ? (
        <Button variant="outline" size="sm" onClick={onRefresh}>
          {t("extensions.toolbox.packages.retry")}
        </Button>
      ) : null}
    </div>
  );
}

export interface PackageOverviewPanelProps {
  associatedPackageName?: string;
  catalogDetailUrl?: string;
  checkedPackageUpdate?: PackageUpdateSummary;
  details: PackageDetailsSummary | undefined;
  detailsLoadState: DetailsLoadState;
  detailsPlaceholder: string;
  isInstalledPackage: boolean;
  monthlyDownloads?: number;
  npmUrl?: string;
  packageSize?: string;
  packageTypes: NonNullable<ToolboxCapabilitySurfaceParams["packageTypes"]>;
  packageUpdateAvailable: boolean;
  params: ToolboxCapabilitySurfaceParams;
  publishedAt?: number;
  refreshDetails: () => void;
  showPackageOverview: boolean;
  weeklyDownloads?: number;
}

export function PackageOverviewPanel({
  associatedPackageName,
  catalogDetailUrl,
  checkedPackageUpdate,
  details,
  detailsLoadState,
  detailsPlaceholder,
  isInstalledPackage,
  monthlyDownloads,
  npmUrl,
  packageSize,
  packageTypes,
  packageUpdateAvailable,
  params,
  publishedAt,
  refreshDetails,
  showPackageOverview,
  weeklyDownloads,
}: PackageOverviewPanelProps) {
  const { date, number, t } = usePiI18n();

  return (
    <div className="mt-8">
      <div className="mb-4 flex min-h-(--button-height-compact) flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <h2 className="text-base font-semibold">{t("extensions.toolbox.details.information")}</h2>
        {showPackageOverview ? (
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1">
            {catalogDetailUrl ? (
              <DetailExternalLink href={catalogDetailUrl}>
                {t("extensions.toolbox.packages.openCatalog")}
              </DetailExternalLink>
            ) : null}
            {npmUrl ? <DetailExternalLink href={npmUrl}>npm</DetailExternalLink> : null}
            {params.repositoryUrl ? (
              <DetailExternalLink href={params.repositoryUrl}>
                {t("extensions.toolbox.packages.repository")}
              </DetailExternalLink>
            ) : null}
          </div>
        ) : null}
      </div>
      <dl className="grid gap-3">
        {showPackageOverview ? (
          <>
            <DetailField inline label={t("extensions.toolbox.packages.packageName")}>
              <code className="text-xs break-all">
                {details?.name ?? associatedPackageName ?? params.source ?? params.name}
              </code>
            </DetailField>
            <DetailField
              inline
              label={t(
                isInstalledPackage
                  ? "extensions.toolbox.packages.installedVersion"
                  : "extensions.toolbox.packages.version",
              )}
            >
              <code className="text-xs">
                {details?.version ??
                  (isInstalledPackage
                    ? (params.currentVersion ?? checkedPackageUpdate?.currentVersion)
                    : params.version) ??
                  detailsPlaceholder}
              </code>
            </DetailField>
            {isInstalledPackage && packageUpdateAvailable ? (
              <>
                {(params.targetVersion ?? checkedPackageUpdate?.targetVersion) ? (
                  <DetailField inline label={t("extensions.toolbox.packages.availableVersion")}>
                    <code className="text-xs font-medium text-success-foreground">
                      {params.targetVersion ?? checkedPackageUpdate?.targetVersion}
                    </code>
                  </DetailField>
                ) : null}
                {(params.currentRevision ?? checkedPackageUpdate?.currentRevision) ? (
                  <DetailField inline label={t("extensions.toolbox.packages.localRevision")}>
                    <code className="text-xs break-all">
                      {params.currentRevision ?? checkedPackageUpdate?.currentRevision}
                    </code>
                  </DetailField>
                ) : null}
                {(params.targetRevision ?? checkedPackageUpdate?.targetRevision) ? (
                  <DetailField inline label={t("extensions.toolbox.packages.remoteRevision")}>
                    <code className="text-xs font-medium break-all text-success-foreground">
                      {params.targetRevision ?? checkedPackageUpdate?.targetRevision}
                    </code>
                  </DetailField>
                ) : null}
              </>
            ) : null}
            {!isInstalledPackage ? (
              <>
                <DetailField inline label={t("extensions.toolbox.packages.published")}>
                  {publishedAt ? date(publishedAt, { dateStyle: "medium" }) : detailsPlaceholder}
                </DetailField>
                <DetailField inline label={t("extensions.toolbox.packages.downloads")}>
                  {monthlyDownloads === undefined
                    ? detailsPlaceholder
                    : weeklyDownloads === undefined
                      ? t("extensions.toolbox.packages.downloadsPerMonth", {
                          count: number(monthlyDownloads, {
                            notation: "compact",
                            maximumFractionDigits: 1,
                          }),
                        })
                      : t("extensions.toolbox.packages.downloadsByPeriod", {
                          monthly: number(monthlyDownloads, {
                            notation: "compact",
                            maximumFractionDigits: 1,
                          }),
                          weekly: number(weeklyDownloads, {
                            notation: "compact",
                            maximumFractionDigits: 1,
                          }),
                        })}
                </DetailField>
              </>
            ) : null}
            <DetailField inline label={t("extensions.toolbox.packages.author")}>
              {details?.author ||
                (isInstalledPackage ? undefined : params.author) ||
                detailsPlaceholder}
            </DetailField>
            <DetailField inline label={t("extensions.toolbox.packages.license")}>
              {details?.license || detailsPlaceholder}
            </DetailField>
            <DetailField inline label={t("extensions.toolbox.packages.resourceTypes")}>
              {details ? (
                <CapabilityNames
                  names={packageTypes.map((type) => t(`extensions.toolbox.packages.types.${type}`))}
                  empty={t("extensions.toolbox.details.none")}
                />
              ) : (
                detailsPlaceholder
              )}
            </DetailField>
            {!isInstalledPackage ? (
              <DetailField inline label={t("extensions.toolbox.packages.size")}>
                {packageSize ?? detailsPlaceholder}
              </DetailField>
            ) : null}
            <DetailField inline label={t("extensions.toolbox.packages.dependencies")}>
              {details?.dependencyCount === undefined || details.peerDependencyCount === undefined
                ? detailsPlaceholder
                : t("extensions.toolbox.packages.dependenciesSummary", {
                    dependencies: details.dependencyCount,
                    peers: details.peerDependencyCount,
                  })}
            </DetailField>
            {details?.manifestJson ? (
              <DetailField inline label={t("extensions.toolbox.packages.manifest")}>
                <details className="group">
                  <summary
                    className={buttonVariants({
                      variant: "ghost",
                      size: "xs",
                      className: "cursor-pointer list-none",
                    })}
                  >
                    <ChevronRightIcon
                      aria-hidden="true"
                      className="text-muted-foreground size-(--icon-size-sm) transition-transform group-open:rotate-90 motion-reduce:transition-none"
                    />
                    {t("extensions.toolbox.packages.manifestShow")}
                  </summary>
                  <pre className="bg-muted/45 mt-1 max-h-40 overflow-auto rounded-(--radius) px-2 py-1.5 font-mono text-xs leading-4">
                    {details.manifestJson}
                  </pre>
                </details>
              </DetailField>
            ) : null}
          </>
        ) : (
          <CapabilityMetadataFields params={params} />
        )}
      </dl>
      {detailsLoadState === "failed" ? (
        <div className="text-muted-foreground mt-3 flex items-center gap-2 text-xs">
          <span>
            {t(
              isInstalledPackage
                ? "extensions.toolbox.packages.installedDetailsLoadFailed"
                : "extensions.toolbox.packages.detailsLoadFailed",
            )}
          </span>
          <Button type="button" variant="ghost" size="xs" onClick={refreshDetails}>
            {t("extensions.toolbox.packages.retry")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function ExtensionCapabilityDetailsPanel({
  params,
}: {
  params: ToolboxCapabilitySurfaceParams;
}) {
  const { t } = usePiI18n();

  return (
    <div className="mt-8">
      <ExtensionContributionsPanel params={params} />
      <section className="mt-8">
        <h2 className="mb-4 border-b border-border pb-3 text-base font-semibold">
          {t("extensions.toolbox.details.capabilityDetails")}
        </h2>
        <dl className="grid gap-x-8 gap-y-4 @lg/toolbox-detail:grid-cols-2 @3xl/toolbox-detail:grid-cols-3">
          <CapabilityMetadataFields params={params} />
        </dl>
      </section>
    </div>
  );
}

export interface ExtensionControlsProps {
  builtin?: boolean;
  canDelete: boolean;
  canOpenDirectory: boolean;
  canToggle: boolean;
  enabled: boolean;
  mutationState: ResourceMutationState;
  name: string;
  openFailed: boolean;
  origin?: ToolboxCapabilitySurfaceParams["origin"];
  removed: boolean;
  onDelete: () => void;
  onOpenDirectory: () => void;
  onToggle: (enabled: boolean) => void;
}

export function ExtensionControls({
  builtin = false,
  canDelete,
  canOpenDirectory,
  canToggle,
  enabled,
  mutationState,
  name,
  openFailed,
  origin,
  removed,
  onDelete,
  onOpenDirectory,
  onToggle,
}: ExtensionControlsProps) {
  const { t } = usePiI18n();

  return (
    <div className="mt-5 shrink-0">
      <div className="flex flex-wrap items-center gap-2">
        <div className="bg-muted/40 flex min-h-(--button-height-default) items-center gap-2 rounded-(--button-radius) px-3">
          <Switch
            size="compact"
            checked={enabled && !removed}
            disabled={!canToggle}
            aria-label={t(
              enabled
                ? "extensions.toolbox.extensions.disableExtension"
                : "extensions.toolbox.extensions.enableExtension",
              { name },
            )}
            aria-busy={mutationState === "updating"}
            title={t(
              enabled
                ? "extensions.toolbox.extensions.disableExtension"
                : "extensions.toolbox.extensions.enableExtension",
              { name },
            )}
            onCheckedChange={onToggle}
          />
          <span className="text-muted-foreground text-xs">
            {t(
              enabled && !removed
                ? "extensions.toolbox.extensions.enabledStatus"
                : "extensions.toolbox.extensions.disabledStatus",
            )}
          </span>
        </div>
        {!builtin ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={!canOpenDirectory}
              aria-label={t("extensions.toolbox.extensions.openFolder", { name })}
              title={t("extensions.toolbox.extensions.openFolder", { name })}
              onClick={onOpenDirectory}
            >
              <FolderOpenIcon aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={!canDelete}
              className="text-destructive hover:text-destructive"
              aria-label={t("extensions.toolbox.extensions.deleteExtension", { name })}
              title={t(
                canDelete
                  ? "extensions.toolbox.extensions.deleteExtension"
                  : "extensions.toolbox.extensions.deleteUnavailable",
                { name },
              )}
              onClick={onDelete}
            >
              <Trash2Icon aria-hidden="true" />
            </Button>
          </>
        ) : null}
      </div>
      {openFailed || mutationState === "failed" ? (
        <p className="text-destructive mt-2 text-xs leading-5" role="alert">
          {t(
            openFailed
              ? "extensions.toolbox.extensions.openFolderFailed"
              : "extensions.toolbox.extensions.actionFailed",
          )}
        </p>
      ) : mutationState === "removed" ? (
        <p className="text-muted-foreground mt-2 text-xs leading-5" role="status">
          {t(
            origin === "package"
              ? "extensions.toolbox.extensions.packageRemoved"
              : "extensions.toolbox.extensions.removed",
          )}
        </p>
      ) : null}
    </div>
  );
}

export interface SkillControlsProps {
  canDelete: boolean;
  canOpenDirectory: boolean;
  canToggle: boolean;
  enabled: boolean;
  mutationState: ResourceMutationState;
  name: string;
  removed: boolean;
  onDelete: () => void;
  onOpenDirectory: () => void;
  onToggle: (enabled: boolean) => void;
}

export function SkillControls({
  canDelete,
  canOpenDirectory,
  canToggle,
  enabled,
  mutationState,
  name,
  removed,
  onDelete,
  onOpenDirectory,
  onToggle,
}: SkillControlsProps) {
  const { t } = usePiI18n();

  return (
    <div className="flex shrink-0 items-center gap-2">
      <div className="flex min-h-(--button-height-default) items-center gap-2 pe-2">
        <Switch
          size="compact"
          checked={enabled && !removed}
          disabled={!canToggle}
          aria-label={t(
            enabled
              ? "extensions.toolbox.skills.disableSkill"
              : "extensions.toolbox.skills.enableSkill",
            { name },
          )}
          aria-busy={mutationState === "updating"}
          title={t(
            enabled
              ? "extensions.toolbox.skills.disableSkill"
              : "extensions.toolbox.skills.enableSkill",
            { name },
          )}
          onCheckedChange={onToggle}
        />
        <span className="text-muted-foreground text-xs">
          {t(
            enabled && !removed
              ? "extensions.toolbox.skills.enabledStatus"
              : "extensions.toolbox.skills.disabledStatus",
          )}
        </span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={!canOpenDirectory}
        aria-label={t("extensions.toolbox.skills.openFolder", { name })}
        title={t("extensions.toolbox.skills.openFolder", { name })}
        onClick={onOpenDirectory}
      >
        <FolderOpenIcon aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={!canDelete}
        className="text-destructive hover:text-destructive"
        aria-label={t("extensions.toolbox.skills.deleteSkill", { name })}
        title={t(
          canDelete
            ? "extensions.toolbox.skills.deleteSkill"
            : "extensions.toolbox.skills.deleteUnavailable",
          { name },
        )}
        onClick={onDelete}
      >
        <Trash2Icon aria-hidden="true" />
      </Button>
    </div>
  );
}

export function skillDocumentBody(content: string): string {
  // Frontmatter is metadata, not Markdown. Keep the original content for source mode.
  return content.replace(/^\uFEFF?---[ \t]*\r?\n(?:[^\n]*\n)*?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/, "");
}

export interface SkillDocumentPanelProps {
  kind?: "skill" | "prompt";
  content?: string;
  documentMode: SkillDocumentMode;
  loadState: DetailsLoadState;
  scopeAvailable: boolean;
  onDocumentModeChange: (mode: SkillDocumentMode) => void;
  onRefresh: () => void;
}

export function SkillDocumentPanel({
  kind = "skill",
  content,
  documentMode,
  loadState,
  scopeAvailable,
  onDocumentModeChange,
  onRefresh,
}: SkillDocumentPanelProps) {
  const { t } = usePiI18n();

  return (
    <div className="mt-6 min-w-0">
      <div className="mb-3 flex min-h-(--button-height-compact) flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <h2 className="text-sm font-semibold">
          {t(
            kind === "prompt"
              ? "extensions.toolbox.prompts.content"
              : "extensions.toolbox.details.skillDocument",
          )}
        </h2>
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label={t(
            kind === "prompt"
              ? "extensions.toolbox.prompts.viewMode"
              : "extensions.toolbox.details.skillDocumentViewMode",
          )}
        >
          {content ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() =>
                onDocumentModeChange(documentMode === "preview" ? "source" : "preview")
              }
            >
              {documentMode === "preview" ? (
                <Code2Icon aria-hidden="true" />
              ) : (
                <EyeIcon aria-hidden="true" />
              )}
              {t(
                documentMode === "preview"
                  ? "extensions.toolbox.details.skillDocumentSource"
                  : "extensions.toolbox.details.skillDocumentPreview",
              )}
            </Button>
          ) : null}
          {loadState === "failed" ? (
            <Button type="button" variant="ghost" size="xs" onClick={onRefresh}>
              {t("extensions.toolbox.details.retry")}
            </Button>
          ) : null}
        </div>
      </div>
      {!scopeAvailable ? (
        <p className="text-muted-foreground text-xs leading-5">
          {t("extensions.toolbox.scopeUnavailable")}
        </p>
      ) : loadState === "loading" ? (
        <p
          className="text-muted-foreground flex items-center gap-2 text-xs leading-5"
          role="status"
        >
          <LoaderCircleIcon
            aria-hidden="true"
            className="size-(--icon-size-sm) animate-spin motion-reduce:animate-none"
          />
          {t(
            kind === "prompt"
              ? "extensions.toolbox.main.loading"
              : "extensions.toolbox.details.skillDocumentLoading",
          )}
        </p>
      ) : loadState === "failed" ? (
        <p className="text-destructive text-xs leading-5" role="alert">
          {t(
            kind === "prompt"
              ? "extensions.toolbox.loadFailed"
              : "extensions.toolbox.details.skillDocumentLoadFailed",
          )}
        </p>
      ) : content ? (
        <div
          aria-label={t(
            kind === "prompt"
              ? "extensions.toolbox.prompts.content"
              : "extensions.toolbox.details.skillDocument",
          )}
          className="w-full min-w-0 overflow-x-auto"
          role="document"
          tabIndex={0}
        >
          {documentMode === "preview" ? (
            <article className="w-full text-sm leading-7 break-words">
              <MarkdownTextContent text={skillDocumentBody(content)} defer={false} mode="static" />
            </article>
          ) : (
            <pre className="w-full rounded-(--radius) border border-border bg-muted/20 p-4 font-mono text-xs leading-6 whitespace-pre-wrap break-words">
              {content}
            </pre>
          )}
        </div>
      ) : loadState === "ready" ? (
        <p className="text-muted-foreground text-xs leading-5">
          {t(
            kind === "prompt"
              ? "extensions.toolbox.prompts.emptyContent"
              : "extensions.toolbox.details.skillDocumentEmpty",
          )}
        </p>
      ) : null}
    </div>
  );
}
