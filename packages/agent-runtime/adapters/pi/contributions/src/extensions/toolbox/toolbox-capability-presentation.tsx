"use client";

import {
  ChevronRightIcon,
  Code2Icon,
  ExternalLinkIcon,
  EyeIcon,
  FolderOpenIcon,
  LoaderCircleIcon,
  Trash2Icon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { MarkdownTextContent } from "@workbench/shell/assistant-ui";
import { Button, Switch } from "@workbench/shell/ui";

import { usePiI18n } from "../../i18n";
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
type ExtensionContributionKind = "command" | "event" | "tool";

interface ExtensionContributionSelection {
  capabilityId: string;
  kind: ExtensionContributionKind;
  name: string;
}

function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1">
      <dt className="text-muted-foreground text-xs font-medium">{label}</dt>
      <dd className="text-sm leading-5 break-words">{children}</dd>
    </div>
  );
}

function PackageDetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="text-muted-foreground text-xs font-medium">{label}</dt>
      <dd className="min-w-0 text-sm leading-5 break-words">{children}</dd>
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
      <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
    </a>
  );
}

function CapabilityNames({
  names,
  empty,
  getSelectionLabel,
  onSelect,
  selectedName,
}: {
  names: readonly string[];
  empty: string;
  getSelectionLabel?: (name: string) => string;
  onSelect?: (name: string) => void;
  selectedName?: string;
}) {
  if (names.length === 0) return <span className="text-muted-foreground text-sm">{empty}</span>;

  return (
    <div className="flex flex-wrap gap-1.5">
      {names.map((name) => {
        const selected = selectedName === name;
        return onSelect ? (
          <button
            key={name}
            type="button"
            aria-label={getSelectionLabel?.(name)}
            aria-pressed={selected}
            className={
              selected
                ? "bg-foreground text-background focus-visible:ring-ring cursor-pointer rounded-md px-2 py-1 font-mono text-[11px] leading-4 break-all outline-none focus-visible:ring-2"
                : "bg-muted/70 hover:bg-muted focus-visible:ring-ring cursor-pointer rounded-md px-2 py-1 font-mono text-[11px] leading-4 break-all outline-none transition-colors focus-visible:ring-2"
            }
            onClick={() => onSelect(name)}
          >
            {name}
          </button>
        ) : (
          <span
            key={name}
            className="bg-muted/70 rounded-md px-2 py-1 font-mono text-[11px] leading-4 break-all"
          >
            {name}
          </span>
        );
      })}
    </div>
  );
}

function ExtensionContributionGroup({
  className = "",
  empty,
  kindLabel,
  label,
  names,
  onSelect,
  selectedName,
}: {
  className?: string;
  empty: string;
  kindLabel: string;
  label: string;
  names: readonly string[];
  onSelect: (name: string) => void;
  selectedName?: string;
}) {
  const { number, t } = usePiI18n();

  return (
    <section className={`min-w-0 ${className}`}>
      <header className="mb-2.5 flex items-center gap-2">
        <h3 className="text-xs font-medium">{label}</h3>
        <span className="bg-muted/60 text-muted-foreground inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] leading-4 tabular-nums">
          {number(names.length)}
        </span>
      </header>
      <CapabilityNames
        names={names}
        empty={empty}
        selectedName={selectedName}
        onSelect={onSelect}
        getSelectionLabel={(name) =>
          t("extensions.toolbox.details.viewContributionDetail", { kind: kindLabel, name })
        }
      />
    </section>
  );
}

function ExtensionContributionDetail({
  onClose,
  params,
  selection,
}: {
  onClose: () => void;
  params: ToolboxCapabilitySurfaceParams;
  selection: ExtensionContributionSelection;
}) {
  const { number, t } = usePiI18n();
  const eventDetail =
    selection.kind === "event"
      ? params.eventDetails?.find((detail) => detail.name === selection.name)
      : undefined;
  const toolDetail =
    selection.kind === "tool"
      ? params.toolDetails?.find((detail) => detail.name === selection.name)
      : undefined;
  const commandDetail =
    selection.kind === "command"
      ? params.commandDetails?.find((detail) => detail.name === selection.name)
      : undefined;
  const kindLabel = t(
    selection.kind === "event"
      ? "extensions.toolbox.details.eventKind"
      : selection.kind === "tool"
        ? "extensions.toolbox.details.toolKind"
        : "extensions.toolbox.details.commandKind",
  );
  const detailLimit = t(
    selection.kind === "event"
      ? "extensions.toolbox.details.eventDetailLimit"
      : selection.kind === "tool"
        ? "extensions.toolbox.details.toolDetailLimit"
        : "extensions.toolbox.details.commandDetailLimit",
  );

  return (
    <section className="mt-5 border-t pt-4" aria-live="polite">
      <header className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs font-medium">
            {t("extensions.toolbox.details.contributionDetail")} · {kindLabel}
          </p>
          <h3 className="mt-1 font-mono text-base leading-6 font-semibold break-all">
            {selection.name}
          </h3>
        </div>
        <Button type="button" variant="ghost" size="xs" className="shrink-0" onClick={onClose}>
          {t("extensions.toolbox.details.closeContributionDetail")}
        </Button>
      </header>

      <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
        <DetailField label={t("extensions.toolbox.details.contributionName")}>
          <span className="font-mono break-all">{selection.name}</span>
        </DetailField>
        {selection.kind === "event" ? (
          <DetailField label={t("extensions.toolbox.details.registeredHandlers")}>
            {eventDetail
              ? number(eventDetail.handlerCount)
              : t("extensions.toolbox.details.notExposed")}
          </DetailField>
        ) : selection.kind === "tool" ? (
          <>
            <DetailField label={t("extensions.toolbox.details.toolLabel")}>
              {toolDetail?.label || t("extensions.toolbox.details.notExposed")}
            </DetailField>
            <DetailField label={t("extensions.toolbox.details.description")}>
              {toolDetail?.description || t("extensions.toolbox.details.descriptionUnavailable")}
            </DetailField>
          </>
        ) : (
          <>
            <DetailField label={t("extensions.toolbox.details.description")}>
              {commandDetail?.description || t("extensions.toolbox.details.descriptionUnavailable")}
            </DetailField>
            <DetailField label={t("extensions.toolbox.details.argumentCompletions")}>
              {commandDetail
                ? t(
                    commandDetail.hasArgumentCompletions
                      ? "extensions.toolbox.details.available"
                      : "extensions.toolbox.details.unavailable",
                  )
                : t("extensions.toolbox.details.notExposed")}
            </DetailField>
          </>
        )}
      </dl>

      {selection.kind === "tool" ? (
        <div className="mt-4 border-t pt-4">
          <h4 className="text-xs font-medium">{t("extensions.toolbox.details.parameterSchema")}</h4>
          {toolDetail?.parameterSchemaJson ? (
            <pre className="bg-muted/35 mt-2 max-h-72 overflow-auto rounded-md px-3 py-2 font-mono text-[11px]! leading-5 whitespace-pre-wrap break-words">
              {toolDetail.parameterSchemaJson}
            </pre>
          ) : (
            <p className="text-muted-foreground mt-2 text-xs">
              {t("extensions.toolbox.details.notExposed")}
            </p>
          )}
        </div>
      ) : null}

      <p className="text-muted-foreground mt-4 text-xs leading-5">{detailLimit}</p>
    </section>
  );
}

function ExtensionContributionsPanel({ params }: { params: ToolboxCapabilitySurfaceParams }) {
  const { t } = usePiI18n();
  const [selection, setSelection] = useState<ExtensionContributionSelection | null>(null);
  const currentSelection = selection?.capabilityId === params.capabilityId ? selection : null;
  const selectContribution = (kind: ExtensionContributionKind, name: string) => {
    setSelection((current) =>
      current?.capabilityId === params.capabilityId &&
      current.kind === kind &&
      current.name === name
        ? null
        : { capabilityId: params.capabilityId, kind, name },
    );
  };

  return (
    <section className="min-w-0">
      <h2 className="text-sm font-semibold">{t("extensions.toolbox.details.contributions")}</h2>
      <div className="mt-4 grid gap-x-6 gap-y-5 sm:grid-cols-2">
        <ExtensionContributionGroup
          className="sm:col-span-2"
          kindLabel={t("extensions.toolbox.details.eventKind")}
          label={t("extensions.toolbox.details.events")}
          names={params.eventNames ?? []}
          empty={t("extensions.toolbox.details.none")}
          selectedName={currentSelection?.kind === "event" ? currentSelection.name : undefined}
          onSelect={(name) => selectContribution("event", name)}
        />
        <ExtensionContributionGroup
          kindLabel={t("extensions.toolbox.details.toolKind")}
          label={t("extensions.toolbox.details.tools")}
          names={params.toolNames ?? []}
          empty={t("extensions.toolbox.details.none")}
          selectedName={currentSelection?.kind === "tool" ? currentSelection.name : undefined}
          onSelect={(name) => selectContribution("tool", name)}
        />
        <ExtensionContributionGroup
          kindLabel={t("extensions.toolbox.details.commandKind")}
          label={t("extensions.toolbox.details.commands")}
          names={params.commandNames ?? []}
          empty={t("extensions.toolbox.details.none")}
          selectedName={currentSelection?.kind === "command" ? currentSelection.name : undefined}
          onSelect={(name) => selectContribution("command", name)}
        />
      </div>
      {currentSelection ? (
        <ExtensionContributionDetail
          params={params}
          selection={currentSelection}
          onClose={() => setSelection(null)}
        />
      ) : null}
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

export interface PackageOverviewPanelProps {
  associatedPackageName?: string;
  catalogDetailUrl?: string;
  checkedPackageUpdate?: PackageUpdateSummary;
  details: PackageDetailsSummary | undefined;
  detailsLoadState: DetailsLoadState;
  detailsPlaceholder: string;
  isExtension: boolean;
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
  isExtension,
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
    <div className={isExtension ? "mt-4" : "mt-4 border-t pt-4"}>
      <div className="mb-3 flex min-h-7 items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{t("extensions.toolbox.details.overview")}</h2>
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
      <dl
        className={
          isExtension
            ? "grid gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5"
            : "grid grid-cols-2 gap-x-8 gap-y-3"
        }
      >
        {showPackageOverview ? (
          <>
            <PackageDetailRow label={t("extensions.toolbox.packages.packageName")}>
              <code className="text-xs break-all">
                {details?.name ?? associatedPackageName ?? params.source ?? params.name}
              </code>
            </PackageDetailRow>
            <PackageDetailRow
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
            </PackageDetailRow>
            {isInstalledPackage && packageUpdateAvailable ? (
              <>
                {(params.targetVersion ?? checkedPackageUpdate?.targetVersion) ? (
                  <PackageDetailRow label={t("extensions.toolbox.packages.availableVersion")}>
                    <code className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                      {params.targetVersion ?? checkedPackageUpdate?.targetVersion}
                    </code>
                  </PackageDetailRow>
                ) : null}
                {(params.currentRevision ?? checkedPackageUpdate?.currentRevision) ? (
                  <PackageDetailRow label={t("extensions.toolbox.packages.localRevision")}>
                    <code className="text-xs break-all">
                      {params.currentRevision ?? checkedPackageUpdate?.currentRevision}
                    </code>
                  </PackageDetailRow>
                ) : null}
                {(params.targetRevision ?? checkedPackageUpdate?.targetRevision) ? (
                  <PackageDetailRow label={t("extensions.toolbox.packages.remoteRevision")}>
                    <code className="text-xs font-medium break-all text-emerald-700 dark:text-emerald-300">
                      {params.targetRevision ?? checkedPackageUpdate?.targetRevision}
                    </code>
                  </PackageDetailRow>
                ) : null}
              </>
            ) : null}
            {!isInstalledPackage ? (
              <>
                <PackageDetailRow label={t("extensions.toolbox.packages.published")}>
                  {publishedAt ? date(publishedAt, { dateStyle: "medium" }) : detailsPlaceholder}
                </PackageDetailRow>
                <PackageDetailRow label={t("extensions.toolbox.packages.downloads")}>
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
                </PackageDetailRow>
              </>
            ) : null}
            <PackageDetailRow label={t("extensions.toolbox.packages.author")}>
              {details?.author ||
                (isInstalledPackage ? undefined : params.author) ||
                detailsPlaceholder}
            </PackageDetailRow>
            <PackageDetailRow label={t("extensions.toolbox.packages.license")}>
              {details?.license || detailsPlaceholder}
            </PackageDetailRow>
            <PackageDetailRow label={t("extensions.toolbox.packages.resourceTypes")}>
              <CapabilityNames
                names={packageTypes.map((type) => t(`extensions.toolbox.packages.types.${type}`))}
                empty={t("extensions.toolbox.details.none")}
              />
            </PackageDetailRow>
            {!isInstalledPackage ? (
              <PackageDetailRow label={t("extensions.toolbox.packages.size")}>
                {packageSize ?? detailsPlaceholder}
              </PackageDetailRow>
            ) : null}
            <PackageDetailRow label={t("extensions.toolbox.packages.dependencies")}>
              {details?.dependencyCount === undefined || details.peerDependencyCount === undefined
                ? detailsPlaceholder
                : t("extensions.toolbox.packages.dependenciesSummary", {
                    dependencies: details.dependencyCount,
                    peers: details.peerDependencyCount,
                  })}
            </PackageDetailRow>
            {details?.manifestJson ? (
              <PackageDetailRow label={t("extensions.toolbox.packages.manifest")}>
                <details className="group">
                  <summary className="hover:bg-muted/70 focus-visible:ring-ring inline-flex h-6 cursor-pointer list-none items-center gap-1.5 rounded-md px-1.5 text-xs font-medium outline-none focus-visible:ring-2">
                    <ChevronRightIcon
                      aria-hidden="true"
                      className="text-muted-foreground size-3.5 transition-transform group-open:rotate-90"
                    />
                    {t("extensions.toolbox.packages.manifestShow")}
                  </summary>
                  <pre className="bg-muted/45 mt-1 max-h-40 overflow-auto rounded-lg px-2 py-1.5 font-mono text-[11px] leading-4">
                    {details.manifestJson}
                  </pre>
                </details>
              </PackageDetailRow>
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
    <div className="mt-5 border-t pt-5">
      <section>
        <h2 className="mb-3 text-sm font-semibold">
          {t("extensions.toolbox.details.capabilityDetails")}
        </h2>
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
          <CapabilityMetadataFields params={params} />
        </dl>
      </section>
      <div className="mt-5 min-w-0 border-t pt-5">
        <ExtensionContributionsPanel params={params} />
      </div>
    </div>
  );
}

export interface ExtensionControlsProps {
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
    <div className="mt-4 shrink-0 border-t pt-4">
      <div className="flex items-center gap-1">
        <div className="bg-muted/30 dark:bg-foreground/8 flex h-7 items-center gap-1 rounded-lg px-1.5">
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

export interface SkillDocumentPanelProps {
  canDelete: boolean;
  canOpenDirectory: boolean;
  canToggle: boolean;
  content?: string;
  documentMode: SkillDocumentMode;
  enabled: boolean;
  loadState: DetailsLoadState;
  mutationState: ResourceMutationState;
  name: string;
  removed: boolean;
  scopeAvailable: boolean;
  onDelete: () => void;
  onDocumentModeChange: (mode: SkillDocumentMode) => void;
  onOpenDirectory: () => void;
  onRefresh: () => void;
  onToggle: (enabled: boolean) => void;
}

export function SkillDocumentPanel({
  canDelete,
  canOpenDirectory,
  canToggle,
  content,
  documentMode,
  enabled,
  loadState,
  mutationState,
  name,
  removed,
  scopeAvailable,
  onDelete,
  onDocumentModeChange,
  onOpenDirectory,
  onRefresh,
  onToggle,
}: SkillDocumentPanelProps) {
  const { t } = usePiI18n();

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden border-t pt-4">
      <div className="mb-4 flex shrink-0 items-center gap-1">
        <div className="bg-muted/30 dark:bg-foreground/8 flex h-7 items-center gap-1 rounded-lg px-1.5">
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
      <div className="mb-3 flex min-h-7 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="text-sm font-semibold">{t("extensions.toolbox.details.skillDocument")}</h2>
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label={t("extensions.toolbox.details.skillDocumentViewMode")}
        >
          {content ? (
            <>
              <Button
                type="button"
                variant={documentMode === "preview" ? "secondary" : "ghost"}
                size="xs"
                aria-pressed={documentMode === "preview"}
                title={t("extensions.toolbox.details.skillDocumentPreview")}
                onClick={() => onDocumentModeChange("preview")}
              >
                <EyeIcon aria-hidden="true" />
                {t("extensions.toolbox.details.skillDocumentPreview")}
              </Button>
              <Button
                type="button"
                variant={documentMode === "source" ? "secondary" : "ghost"}
                size="xs"
                aria-pressed={documentMode === "source"}
                title={t("extensions.toolbox.details.skillDocumentSource")}
                onClick={() => onDocumentModeChange("source")}
              >
                <Code2Icon aria-hidden="true" />
                {t("extensions.toolbox.details.skillDocumentSource")}
              </Button>
            </>
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
            className="size-3.5 animate-spin motion-reduce:animate-none"
          />
          {t("extensions.toolbox.details.skillDocumentLoading")}
        </p>
      ) : loadState === "failed" ? (
        <p className="text-destructive text-xs leading-5" role="alert">
          {t("extensions.toolbox.details.skillDocumentLoadFailed")}
        </p>
      ) : content ? (
        <div
          aria-label={t("extensions.toolbox.details.skillDocument")}
          className="focus-visible:ring-ring min-h-0 w-full flex-1 overflow-auto rounded-lg border bg-transparent outline-none focus-visible:ring-2"
          role="document"
          tabIndex={0}
        >
          {documentMode === "preview" ? (
            <article className="w-full px-6 py-5 text-sm leading-7 break-words">
              <MarkdownTextContent text={content} defer={false} mode="static" />
            </article>
          ) : (
            <pre className="min-h-full w-full p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-words">
              {content}
            </pre>
          )}
        </div>
      ) : loadState === "ready" ? (
        <p className="text-muted-foreground text-xs leading-5">
          {t("extensions.toolbox.details.skillDocumentEmpty")}
        </p>
      ) : null}
    </div>
  );
}
