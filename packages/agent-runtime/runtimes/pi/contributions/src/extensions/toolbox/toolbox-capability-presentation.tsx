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

import { MarkdownTextContent } from "@workbench/shell/chat";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  StatusBadge,
  Switch,
  buttonVariants,
} from "@workbench/shell/ui";

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

function CapabilityNames({
  names,
  empty,
  getSelectionLabel,
  onSelect,
}: {
  names: readonly string[];
  empty: string;
  getSelectionLabel?: (name: string) => string;
  onSelect?: (name: string) => void;
}) {
  if (names.length === 0) return <span className="text-muted-foreground text-sm">{empty}</span>;

  return (
    <div className="flex flex-wrap gap-1.5">
      {names.map((name) => {
        return onSelect ? (
          <DialogTrigger
            render={
              <Button
                variant="ghost"
                size="xs"
                className="h-auto max-w-full py-1 font-mono text-xs leading-5 whitespace-normal break-all"
              />
            }
            key={name}
            aria-label={getSelectionLabel?.(name)}
            onClick={() => onSelect(name)}
          >
            {name}
          </DialogTrigger>
        ) : (
          <StatusBadge key={name} className="max-w-full leading-5 break-all">
            {name}
          </StatusBadge>
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
}: {
  className?: string;
  empty: string;
  kindLabel: string;
  label: string;
  names: readonly string[];
  onSelect: (name: string) => void;
}) {
  const { number, t } = usePiI18n();

  return (
    <section
      className={`min-w-0 rounded-(--radius) border border-border bg-muted/20 p-4 ${className}`}
    >
      <header className="mb-2.5 flex items-center gap-2">
        <h3 className="text-xs font-medium">{label}</h3>
        <StatusBadge className="tabular-nums">{number(names.length)}</StatusBadge>
      </header>
      <CapabilityNames
        names={names}
        empty={empty}
        onSelect={onSelect}
        getSelectionLabel={(name) =>
          t("extensions.toolbox.details.viewContributionDetail", { kind: kindLabel, name })
        }
      />
    </section>
  );
}

function ExtensionContributionDetail({
  params,
  selection,
}: {
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
    <DialogContent
      closeLabel={t("extensions.toolbox.details.closeContributionDetail")}
      className="@container/toolbox-detail max-h-[80vh] overflow-y-auto sm:max-w-2xl"
    >
      <DialogHeader className="min-w-0 pe-8">
        <p className="text-muted-foreground text-xs font-medium">
          {t("extensions.toolbox.details.contributionDetail")} · {kindLabel}
        </p>
        <DialogTitle className="font-mono text-base leading-6 font-semibold break-all">
          {selection.name}
        </DialogTitle>
      </DialogHeader>

      <dl className="grid gap-x-6 gap-y-4 @lg/toolbox-detail:grid-cols-2">
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
        <div className="min-w-0 border-t border-border pt-4">
          <h4 className="text-xs font-medium">{t("extensions.toolbox.details.parameterSchema")}</h4>
          {toolDetail?.parameterSchemaJson ? (
            <pre className="bg-muted/35 mt-2 max-h-72 overflow-auto rounded-(--radius) px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap break-words">
              {toolDetail.parameterSchemaJson}
            </pre>
          ) : (
            <p className="text-muted-foreground mt-2 text-xs">
              {t("extensions.toolbox.details.notExposed")}
            </p>
          )}
        </div>
      ) : null}

      <DialogDescription className="text-xs leading-5">{detailLimit}</DialogDescription>
    </DialogContent>
  );
}

function ExtensionContributionsPanel({ params }: { params: ToolboxCapabilitySurfaceParams }) {
  const { t } = usePiI18n();
  const [selection, setSelection] = useState<ExtensionContributionSelection | null>(null);
  const currentSelection = selection?.capabilityId === params.capabilityId ? selection : null;
  const selectContribution = (kind: ExtensionContributionKind, name: string) => {
    setSelection({ capabilityId: params.capabilityId, kind, name });
  };

  return (
    <Dialog
      key={params.capabilityId}
      onOpenChangeComplete={(open) => {
        if (!open) setSelection(null);
      }}
    >
      <section className="min-w-0">
        <h2 className="text-sm font-semibold">{t("extensions.toolbox.details.contributions")}</h2>
        <div className="mt-4 grid gap-x-6 gap-y-5 @lg/toolbox-detail:grid-cols-2">
          <ExtensionContributionGroup
            className="@lg/toolbox-detail:col-span-2"
            kindLabel={t("extensions.toolbox.details.eventKind")}
            label={t("extensions.toolbox.details.events")}
            names={params.eventNames ?? []}
            empty={t("extensions.toolbox.details.none")}
            onSelect={(name) => selectContribution("event", name)}
          />
          <ExtensionContributionGroup
            kindLabel={t("extensions.toolbox.details.toolKind")}
            label={t("extensions.toolbox.details.tools")}
            names={params.toolNames ?? []}
            empty={t("extensions.toolbox.details.none")}
            onSelect={(name) => selectContribution("tool", name)}
          />
          <ExtensionContributionGroup
            kindLabel={t("extensions.toolbox.details.commandKind")}
            label={t("extensions.toolbox.details.commands")}
            names={params.commandNames ?? []}
            empty={t("extensions.toolbox.details.none")}
            onSelect={(name) => selectContribution("command", name)}
          />
        </div>
        {currentSelection ? (
          <ExtensionContributionDetail params={params} selection={currentSelection} />
        ) : null}
      </section>
    </Dialog>
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
    <div className="mt-6 border-t border-border pt-6">
      <div className="mb-4 flex min-h-(--button-height-compact) flex-wrap items-center justify-between gap-3">
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
      <dl className="grid gap-x-6 gap-y-5 @lg/toolbox-detail:grid-cols-2 @3xl/toolbox-detail:grid-cols-3">
        {showPackageOverview ? (
          <>
            <DetailField label={t("extensions.toolbox.packages.packageName")}>
              <code className="text-xs break-all">
                {details?.name ?? associatedPackageName ?? params.source ?? params.name}
              </code>
            </DetailField>
            <DetailField
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
                  <DetailField label={t("extensions.toolbox.packages.availableVersion")}>
                    <code className="text-xs font-medium text-success-foreground">
                      {params.targetVersion ?? checkedPackageUpdate?.targetVersion}
                    </code>
                  </DetailField>
                ) : null}
                {(params.currentRevision ?? checkedPackageUpdate?.currentRevision) ? (
                  <DetailField label={t("extensions.toolbox.packages.localRevision")}>
                    <code className="text-xs break-all">
                      {params.currentRevision ?? checkedPackageUpdate?.currentRevision}
                    </code>
                  </DetailField>
                ) : null}
                {(params.targetRevision ?? checkedPackageUpdate?.targetRevision) ? (
                  <DetailField label={t("extensions.toolbox.packages.remoteRevision")}>
                    <code className="text-xs font-medium break-all text-success-foreground">
                      {params.targetRevision ?? checkedPackageUpdate?.targetRevision}
                    </code>
                  </DetailField>
                ) : null}
              </>
            ) : null}
            {!isInstalledPackage ? (
              <>
                <DetailField label={t("extensions.toolbox.packages.published")}>
                  {publishedAt ? date(publishedAt, { dateStyle: "medium" }) : detailsPlaceholder}
                </DetailField>
                <DetailField label={t("extensions.toolbox.packages.downloads")}>
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
            <DetailField label={t("extensions.toolbox.packages.author")}>
              {details?.author ||
                (isInstalledPackage ? undefined : params.author) ||
                detailsPlaceholder}
            </DetailField>
            <DetailField label={t("extensions.toolbox.packages.license")}>
              {details?.license || detailsPlaceholder}
            </DetailField>
            <DetailField label={t("extensions.toolbox.packages.resourceTypes")}>
              <CapabilityNames
                names={packageTypes.map((type) => t(`extensions.toolbox.packages.types.${type}`))}
                empty={t("extensions.toolbox.details.none")}
              />
            </DetailField>
            {!isInstalledPackage ? (
              <DetailField label={t("extensions.toolbox.packages.size")}>
                {packageSize ?? detailsPlaceholder}
              </DetailField>
            ) : null}
            <DetailField label={t("extensions.toolbox.packages.dependencies")}>
              {details?.dependencyCount === undefined || details.peerDependencyCount === undefined
                ? detailsPlaceholder
                : t("extensions.toolbox.packages.dependenciesSummary", {
                    dependencies: details.dependencyCount,
                    peers: details.peerDependencyCount,
                  })}
            </DetailField>
            {details?.manifestJson ? (
              <DetailField label={t("extensions.toolbox.packages.manifest")}>
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
    <div className="mt-6 border-t border-border pt-6">
      <section>
        <h2 className="mb-3 text-sm font-semibold">
          {t("extensions.toolbox.details.capabilityDetails")}
        </h2>
        <dl className="grid gap-x-8 gap-y-4 @lg/toolbox-detail:grid-cols-2 @3xl/toolbox-detail:grid-cols-3">
          <CapabilityMetadataFields params={params} />
        </dl>
      </section>
      <div className="mt-6 min-w-0 border-t border-border pt-6">
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
  content?: string;
  documentMode: SkillDocumentMode;
  loadState: DetailsLoadState;
  scopeAvailable: boolean;
  onDocumentModeChange: (mode: SkillDocumentMode) => void;
  onRefresh: () => void;
}

export function SkillDocumentPanel({
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
        <h2 className="text-sm font-semibold">{t("extensions.toolbox.details.skillDocument")}</h2>
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label={t("extensions.toolbox.details.skillDocumentViewMode")}
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
          {t("extensions.toolbox.details.skillDocumentLoading")}
        </p>
      ) : loadState === "failed" ? (
        <p className="text-destructive text-xs leading-5" role="alert">
          {t("extensions.toolbox.details.skillDocumentLoadFailed")}
        </p>
      ) : content ? (
        <div
          aria-label={t("extensions.toolbox.details.skillDocument")}
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
          {t("extensions.toolbox.details.skillDocumentEmpty")}
        </p>
      ) : null}
    </div>
  );
}
