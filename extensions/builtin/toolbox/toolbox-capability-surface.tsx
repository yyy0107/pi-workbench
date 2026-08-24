"use client";

import {
  BoxesIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardIcon,
  ExternalLinkIcon,
  FolderIcon,
  LoaderCircleIcon,
  MessageSquareTextIcon,
  PackageIcon,
  PackagePlusIcon,
  PinIcon,
  SettingsIcon,
  SparklesIcon,
  UserRoundIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { useCommandService } from "@/platform/extensions";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n";
import {
  usePiActiveSessionId,
  usePiHostDescription,
  usePiWorkspaces,
} from "@/runtime/pi/client/runtime/context";
import { installPiPackage, PiApiError } from "@/runtime/pi/client/transport/api";

import type { ToolboxCapabilitySurfaceParams } from "./toolbox-capability";
import { notifyToolboxPackagesChanged } from "./toolbox-catalog";
import { toggleToolboxPin, useToolboxPins } from "./toolbox-pins";
import { usePiPackageDetails } from "./use-pi-package-details";

type PackageInstallChoice =
  | { scope: "user" }
  | { scope: "project"; workspaceId: string; workspaceName: string };

type PackageInstallFeedback =
  | { status: "idle" }
  | { status: "installing"; target: PackageInstallChoice }
  | { status: "installed"; target: PackageInstallChoice }
  | { status: "failed"; target: PackageInstallChoice; errorCode?: string };

function installChoiceKey(choice: PackageInstallChoice): string {
  return choice.scope === "user" ? "user" : `project:${choice.workspaceId}`;
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
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs whitespace-nowrap underline underline-offset-4 transition-colors focus-visible:outline-none"
    >
      {children}
      <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
    </a>
  );
}

function CapabilityNames({ names, empty }: { names: readonly string[]; empty: string }) {
  if (names.length === 0) return <span className="text-muted-foreground text-sm">{empty}</span>;

  return (
    <div className="flex flex-wrap gap-1.5">
      {names.map((name) => (
        <code key={name} className="bg-muted rounded-md px-2 py-1 text-[11px] break-all">
          {name}
        </code>
      ))}
    </div>
  );
}

export function ToolboxCapabilityDetails({ params }: { params: ToolboxCapabilitySurfaceParams }) {
  const { date, number, t } = useI18n();
  const commands = useCommandService();
  const sessionId = usePiActiveSessionId();
  const userPackageDir = usePiHostDescription()?.userPackageDir;
  const workspaces = usePiWorkspaces();
  const pins = useToolboxPins();
  const pinned = pins.includes(params.capabilityId);
  const isSkill = params.capabilityKind === "skill";
  const isPrompt = params.capabilityKind === "prompt";
  const isPackage = params.capabilityKind === "package";
  const isInstalledPackage = isPackage && params.installed === true;
  const isCatalogPackage = isPackage && !isInstalledPackage;
  const isPromptPackage = isCatalogPackage && params.packageTypes?.includes("prompt");
  const packageDetails = usePiPackageDetails(params.name, isCatalogPackage);
  const officialDetails = packageDetails.value;
  const Icon =
    isPrompt || isPromptPackage
      ? MessageSquareTextIcon
      : isPackage
        ? PackageIcon
        : isSkill
          ? SparklesIcon
          : BoxesIcon;
  const pinLabel = t(pinned ? "extensions.toolbox.unpin" : "extensions.toolbox.pin");
  const [copied, setCopied] = useState(false);
  const [installFeedback, setInstallFeedback] = useState<PackageInstallFeedback>({
    status: "idle",
  });
  const [installedTargets, setInstalledTargets] = useState(() => new Set<string>());
  const detailsPlaceholder = packageDetails.loadState === "loading" ? "…" : "—";
  const publishedAt = params.publishedAt ?? officialDetails?.publishedAt;
  const monthlyDownloads = officialDetails?.monthlyDownloads ?? params.monthlyDownloads;
  const weeklyDownloads = officialDetails?.weeklyDownloads;
  const packageTypes = officialDetails?.types ?? params.packageTypes ?? [];
  const catalogDetailUrl = (() => {
    if (!params.catalogUrl) return undefined;
    try {
      const url = new URL(params.catalogUrl);
      if (url.origin !== "https://pi.dev" || !url.pathname.startsWith("/packages/"))
        return undefined;
      const primaryType = packageTypes.find((type) => type !== "package");
      if (primaryType) url.searchParams.set("type", primaryType);
      return url.toString();
    } catch {
      return undefined;
    }
  })();
  const packageSizeBytes = officialDetails?.packageSizeBytes;
  const packageSize =
    packageSizeBytes === undefined
      ? undefined
      : packageSizeBytes >= 1_000_000
        ? `${number(packageSizeBytes / 1_000_000, { maximumFractionDigits: 1 })} MB`
        : packageSizeBytes >= 1_000
          ? `${number(packageSizeBytes / 1_000, { maximumFractionDigits: 1 })} KB`
          : `${number(packageSizeBytes)} B`;

  const openSettings = () => {
    void commands.execute("settings.open").catch((error) => console.error(error));
  };

  const copyInstallCommand = () => {
    if (!params.installCommand || !navigator.clipboard) return;
    void navigator.clipboard.writeText(params.installCommand).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => setCopied(false),
    );
  };

  const installPackage = (target: PackageInstallChoice) => {
    if (
      installFeedback.status === "installing" ||
      installedTargets.has(installChoiceKey(target)) ||
      (target.scope === "user" && !sessionId)
    ) {
      return;
    }
    const rpcTarget =
      target.scope === "user"
        ? sessionId
          ? { scope: "user" as const, sessionId }
          : undefined
        : { scope: "project" as const, workspaceId: target.workspaceId };
    if (!rpcTarget) return;
    setInstallFeedback({ status: "installing", target });
    void installPiPackage({
      name: params.name,
      target: rpcTarget,
    }).then(
      () => {
        setInstalledTargets((current) => {
          const next = new Set(current);
          next.add(installChoiceKey(target));
          return next;
        });
        setInstallFeedback({ status: "installed", target });
        notifyToolboxPackagesChanged();
      },
      (error: unknown) =>
        setInstallFeedback({
          status: "failed",
          target,
          ...(error instanceof PiApiError ? { errorCode: error.code } : {}),
        }),
    );
  };

  const installing = installFeedback.status === "installing";
  const installed = installFeedback.status === "installed";
  const installTargetLabel = (target: PackageInstallChoice): string =>
    target.scope === "user"
      ? t("extensions.toolbox.packages.installLocationUser")
      : target.workspaceName;
  const installStatusMessage = (() => {
    if (installFeedback.status === "idle") {
      return t("extensions.toolbox.packages.installChooseLocation");
    }
    if (installFeedback.status === "installing") {
      return t("extensions.toolbox.packages.installingAt", {
        target: installTargetLabel(installFeedback.target),
      });
    }
    if (installFeedback.status === "installed") {
      return installFeedback.target.scope === "user"
        ? t("extensions.toolbox.packages.installSuccess")
        : t("extensions.toolbox.packages.installProjectSuccess", {
            project: installFeedback.target.workspaceName,
          });
    }
    if (installFeedback.errorCode === "project-untrusted") {
      return t("extensions.toolbox.packages.installProjectUntrusted");
    }
    if (installFeedback.errorCode === "workspace-not-found") {
      return t("extensions.toolbox.packages.installWorkspaceMissing");
    }
    return t("extensions.toolbox.packages.installFailed");
  })();

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <header className="flex items-start gap-2.5">
          <span className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-xl">
            <Icon aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-muted-foreground text-xs font-medium">
              {t(
                isPrompt
                  ? "extensions.toolbox.capabilityKinds.prompt"
                  : isPackage
                    ? isPromptPackage
                      ? "extensions.toolbox.capabilityKinds.prompt"
                      : "extensions.toolbox.capabilityKinds.package"
                    : isSkill
                      ? "extensions.toolbox.capabilityKinds.skill"
                      : "extensions.toolbox.capabilityKinds.extension",
              )}
            </p>
            <h1 className="mt-0.5 font-mono text-lg font-semibold break-all">{params.name}</h1>
          </div>
          <span className="bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
            {t(
              isCatalogPackage
                ? "extensions.toolbox.status.officialCatalog"
                : isInstalledPackage
                  ? "extensions.toolbox.status.installed"
                  : isSkill
                    ? "extensions.toolbox.status.available"
                    : isPrompt
                      ? "extensions.toolbox.status.available"
                      : "extensions.toolbox.status.loaded",
            )}
          </span>
        </header>

        <p className="text-muted-foreground mt-3 text-sm leading-5">
          {params.description || t("extensions.toolbox.details.descriptionUnavailable")}
        </p>

        <div className="mt-4 border-t pt-4">
          <div className="mb-3 flex min-h-7 items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">{t("extensions.toolbox.details.overview")}</h2>
            {isCatalogPackage ? (
              <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1">
                {catalogDetailUrl ? (
                  <DetailExternalLink href={catalogDetailUrl}>
                    {t("extensions.toolbox.packages.openCatalog")}
                  </DetailExternalLink>
                ) : null}
                {params.npmUrl ? (
                  <DetailExternalLink href={params.npmUrl}>npm</DetailExternalLink>
                ) : null}
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
              isCatalogPackage ? "grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2" : "grid gap-3"
            }
          >
            {isCatalogPackage ? (
              <>
                <PackageDetailRow label={t("extensions.toolbox.packages.packageName")}>
                  <code className="text-xs break-all">{params.name}</code>
                </PackageDetailRow>
                <PackageDetailRow label={t("extensions.toolbox.packages.version")}>
                  <code className="text-xs">
                    {officialDetails?.version ?? params.version ?? detailsPlaceholder}
                  </code>
                </PackageDetailRow>
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
                <PackageDetailRow label={t("extensions.toolbox.packages.author")}>
                  {officialDetails?.author || params.author || detailsPlaceholder}
                </PackageDetailRow>
                <PackageDetailRow label={t("extensions.toolbox.packages.license")}>
                  {officialDetails?.license || detailsPlaceholder}
                </PackageDetailRow>
                <PackageDetailRow label={t("extensions.toolbox.packages.resourceTypes")}>
                  <CapabilityNames
                    names={packageTypes.map((type) =>
                      t(`extensions.toolbox.packages.types.${type}`),
                    )}
                    empty={t("extensions.toolbox.details.none")}
                  />
                </PackageDetailRow>
                <PackageDetailRow label={t("extensions.toolbox.packages.size")}>
                  {packageSize ?? detailsPlaceholder}
                </PackageDetailRow>
                <PackageDetailRow label={t("extensions.toolbox.packages.dependencies")}>
                  {officialDetails?.dependencyCount === undefined ||
                  officialDetails.peerDependencyCount === undefined
                    ? detailsPlaceholder
                    : t("extensions.toolbox.packages.dependenciesSummary", {
                        dependencies: officialDetails.dependencyCount,
                        peers: officialDetails.peerDependencyCount,
                      })}
                </PackageDetailRow>
                {officialDetails?.manifestJson ? (
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
                        {officialDetails.manifestJson}
                      </pre>
                    </details>
                  </PackageDetailRow>
                ) : null}
              </>
            ) : isInstalledPackage ? (
              <>
                <DetailField label={t("extensions.toolbox.details.source")}>
                  <code className="text-xs break-all">{params.source}</code>
                </DetailField>
                <DetailField label={t("extensions.toolbox.details.scope")}>
                  {params.packageScope
                    ? t(`extensions.toolbox.scopes.${params.packageScope}`)
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
            ) : isSkill ? (
              <>
                <DetailField label={t("extensions.toolbox.details.modelAccess")}>
                  {t(
                    params.modelInvocable
                      ? "extensions.toolbox.status.modelInvocable"
                      : "extensions.toolbox.status.manualOnly",
                  )}
                </DetailField>
                {params.whenToUse ? (
                  <DetailField label={t("extensions.toolbox.details.whenToUse")}>
                    {params.whenToUse}
                  </DetailField>
                ) : null}
                <DetailField label={t("extensions.toolbox.details.sourceAndScope")}>
                  <span className="text-muted-foreground">
                    {t("extensions.toolbox.details.notExposed")}
                  </span>
                </DetailField>
              </>
            ) : isPrompt ? (
              <>
                <DetailField label={t("extensions.toolbox.details.invocation")}>
                  <code className="text-xs">/{params.invocationName}</code>
                </DetailField>
                <DetailField label={t("extensions.toolbox.details.arguments")}>
                  {params.argumentHint || t("extensions.toolbox.details.none")}
                </DetailField>
              </>
            ) : (
              <>
                <DetailField label={t("extensions.toolbox.details.source")}>
                  <code className="text-xs break-all">{params.source}</code>
                </DetailField>
                <DetailField label={t("extensions.toolbox.details.scope")}>
                  {params.scope
                    ? t(`extensions.toolbox.scopes.${params.scope}`)
                    : t("extensions.toolbox.details.notExposed")}
                </DetailField>
                <DetailField label={t("extensions.toolbox.details.origin")}>
                  {params.origin
                    ? t(`extensions.toolbox.origins.${params.origin}`)
                    : t("extensions.toolbox.details.notExposed")}
                </DetailField>
              </>
            )}
          </dl>
          {packageDetails.loadState === "failed" ? (
            <div className="text-muted-foreground mt-3 flex items-center gap-2 text-xs">
              <span>{t("extensions.toolbox.packages.detailsLoadFailed")}</span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="active:translate-y-0!"
                onClick={packageDetails.refresh}
              >
                {t("extensions.toolbox.packages.retry")}
              </Button>
            </div>
          ) : null}
        </div>

        {isCatalogPackage ? (
          <div className="mt-4 border-t pt-4">
            <h2 className="mb-3 text-sm font-semibold">
              {t("extensions.toolbox.packages.install")}
            </h2>
            <div className="bg-muted inline-flex max-w-full items-center gap-1.5 rounded-lg p-1 ps-2.5">
              <code className="min-w-0 overflow-x-auto text-xs leading-5 whitespace-nowrap">
                {params.installCommand}
              </code>
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="shrink-0 active:translate-y-0!"
                onClick={copyInstallCommand}
              >
                {copied ? <CheckIcon aria-hidden="true" /> : <ClipboardIcon aria-hidden="true" />}
                {t(
                  copied
                    ? "extensions.toolbox.packages.copied"
                    : "extensions.toolbox.packages.copyCommand",
                )}
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2" aria-live="polite">
              <DropdownMenu>
                <DropdownMenuTrigger
                  type="button"
                  openOnHover
                  delay={80}
                  closeDelay={180}
                  disabled={installing}
                  aria-label={t("extensions.toolbox.packages.chooseInstallLocation")}
                  className={buttonVariants({ className: "active:translate-y-0!" })}
                >
                  {installing ? (
                    <LoaderCircleIcon
                      aria-hidden="true"
                      className="animate-spin motion-reduce:animate-none"
                    />
                  ) : installed ? (
                    <CheckIcon aria-hidden="true" />
                  ) : (
                    <PackagePlusIcon aria-hidden="true" />
                  )}
                  {t(
                    installing
                      ? "extensions.toolbox.packages.installing"
                      : installed
                        ? "extensions.toolbox.packages.installed"
                        : "extensions.toolbox.packages.installNow",
                  )}
                  <ChevronDownIcon aria-hidden="true" className="size-3.5 opacity-70" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="bottom" className="w-72">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>
                      {t("extensions.toolbox.packages.installLocation")}
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                      disabled={!sessionId || installedTargets.has("user")}
                      className="items-start py-2"
                      onClick={() => installPackage({ scope: "user" })}
                    >
                      <UserRoundIcon aria-hidden="true" className="mt-0.5" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">
                          {t("extensions.toolbox.packages.installLocationUser")}
                        </span>
                        <span
                          className="text-muted-foreground mt-0.5 block truncate text-xs"
                          title={userPackageDir}
                        >
                          {userPackageDir ?? "…"}
                        </span>
                        {!sessionId ? (
                          <span className="text-muted-foreground mt-0.5 block text-xs leading-4 whitespace-normal">
                            {t("extensions.toolbox.packages.installSessionRequired")}
                          </span>
                        ) : null}
                      </span>
                      {installedTargets.has("user") ? (
                        <CheckIcon aria-hidden="true" className="mt-0.5 text-emerald-600" />
                      ) : null}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>
                      {t("extensions.toolbox.packages.installLocationProjects")}
                    </DropdownMenuLabel>
                    {workspaces.length > 0 ? (
                      workspaces.map((workspace) => {
                        const targetKey = `project:${workspace.id}`;
                        const targetInstalled = installedTargets.has(targetKey);
                        return (
                          <DropdownMenuItem
                            key={workspace.id}
                            disabled={targetInstalled}
                            className="items-start py-2"
                            onClick={() =>
                              installPackage({
                                scope: "project",
                                workspaceId: workspace.id,
                                workspaceName: workspace.name,
                              })
                            }
                          >
                            <FolderIcon aria-hidden="true" className="mt-0.5" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium" title={workspace.name}>
                                {workspace.name}
                              </span>
                              <span
                                className="text-muted-foreground mt-0.5 block truncate text-xs"
                                title={workspace.cwd}
                              >
                                {workspace.cwd}
                              </span>
                            </span>
                            {targetInstalled ? (
                              <CheckIcon aria-hidden="true" className="mt-0.5 text-emerald-600" />
                            ) : null}
                          </DropdownMenuItem>
                        );
                      })
                    ) : (
                      <p className="text-muted-foreground px-1.5 py-2 text-xs leading-4">
                        {t("extensions.toolbox.packages.installProjectsEmpty")}
                      </p>
                    )}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <p
                className={
                  installFeedback.status === "failed"
                    ? "text-destructive text-xs"
                    : installFeedback.status === "installed"
                      ? "text-emerald-700 text-xs dark:text-emerald-300"
                      : "text-muted-foreground text-xs"
                }
                role={installFeedback.status === "failed" ? "alert" : "status"}
              >
                {installStatusMessage}
              </p>
            </div>
          </div>
        ) : params.capabilityKind === "extension" ? (
          <div className="mt-4 border-t pt-4">
            <h2 className="mb-3 text-sm font-semibold">
              {t("extensions.toolbox.details.contributions")}
            </h2>
            <dl className="grid gap-3">
              <DetailField label={t("extensions.toolbox.details.events")}>
                <CapabilityNames
                  names={params.eventNames ?? []}
                  empty={t("extensions.toolbox.details.none")}
                />
              </DetailField>
              <DetailField label={t("extensions.toolbox.details.tools")}>
                <CapabilityNames
                  names={params.toolNames ?? []}
                  empty={t("extensions.toolbox.details.none")}
                />
              </DetailField>
              <DetailField label={t("extensions.toolbox.details.commands")}>
                <CapabilityNames
                  names={params.commandNames ?? []}
                  empty={t("extensions.toolbox.details.none")}
                />
              </DetailField>
            </dl>
          </div>
        ) : null}

        {!isPackage ? (
          <aside className="bg-muted/45 text-muted-foreground mt-4 rounded-xl px-3.5 py-3 text-xs leading-5">
            {t(
              isSkill
                ? "extensions.toolbox.details.skillProtocolLimit"
                : isPrompt
                  ? "extensions.toolbox.details.promptProtocolLimit"
                  : "extensions.toolbox.details.extensionProtocolLimit",
            )}
          </aside>
        ) : null}
      </div>

      {!isCatalogPackage ? (
        <footer className="flex shrink-0 items-center gap-2 border-t p-3">
          <Button
            type="button"
            variant="outline"
            aria-pressed={pinned}
            className="active:translate-y-0!"
            onClick={() => toggleToolboxPin(params.capabilityId)}
          >
            <PinIcon aria-hidden="true" className={pinned ? "fill-current" : undefined} />
            {pinLabel}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="active:translate-y-0!"
            onClick={openSettings}
          >
            <SettingsIcon aria-hidden="true" />
            {t("extensions.toolbox.openSettings")}
          </Button>
        </footer>
      ) : null}
    </section>
  );
}
