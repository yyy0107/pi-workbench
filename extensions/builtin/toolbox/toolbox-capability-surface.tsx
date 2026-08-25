"use client";

import {
  BoxesIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardIcon,
  Code2Icon,
  ComponentIcon,
  ExternalLinkIcon,
  EyeIcon,
  FolderIcon,
  FolderOpenIcon,
  LoaderCircleIcon,
  MapPinIcon,
  MessageSquareTextIcon,
  PackageIcon,
  PackagePlusIcon,
  SparklesIcon,
  SquareTerminalIcon,
  Trash2Icon,
  UserRoundIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { MarkdownTextContent } from "@/components/assistant-ui/markdown-text";
import { useOpenerService, useWorkspaceContext } from "@/components/right-workspace";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  setComponentExtensionInstalled,
  useInstallableComponentExtensions,
} from "@/extensions/component-extension-installation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/i18n";
import { useExtensionErrorReporter, type ExtensionErrorSource } from "@/platform/extensions";
import type { ComponentExtensionContributionKind } from "@/platform/extensions/authoring";
import { ExtensionErrorBoundary } from "@/platform/extensions/hosts/extension-error-boundary";
import {
  usePiActiveSessionId,
  usePiHostDescription,
  usePiThreadListItemState,
  usePiWorkspaces,
} from "@/runtime/pi/client/runtime/context";
import {
  installPiPackage,
  listInstalledPiPackages,
  PiApiError,
  removePiExtension,
  removePiPackage,
  removePiSkill,
  setPiExtensionEnabled,
  setPiSkillEnabled,
} from "@/runtime/pi/client/transport/api";
import { fileWorkspaceTargetService } from "@/services/file-workspace-target-service";

import {
  toolboxDirectoryResource,
  type ToolboxCapabilitySurfaceParams,
  type ToolboxComponentContribution,
} from "./toolbox-capability";
import { ComponentPlacementPreview } from "./component-placement-preview";
import {
  notifyToolboxExtensionsChanged,
  notifyToolboxPackagesChanged,
  notifyToolboxSkillsChanged,
} from "./toolbox-catalog";
import { usePiPackageDetails } from "./use-pi-package-details";
import { usePiSkillDetails } from "./use-pi-skill-details";

type PackageInstallChoice =
  | { scope: "user" }
  | { scope: "project"; workspaceId: string; workspaceName: string };

type PackageInstallFeedback =
  | { status: "idle" }
  | { status: "installing"; target: PackageInstallChoice }
  | { status: "installed"; target: PackageInstallChoice }
  | { status: "failed"; target: PackageInstallChoice; errorCode?: string };

type PackageRemoveFeedback =
  | { status: "idle" }
  | { status: "removing"; target: PackageInstallChoice }
  | { status: "removed"; target: PackageInstallChoice }
  | { status: "failed"; target: PackageInstallChoice; errorCode?: string };

type SkillMutationState = "idle" | "updating" | "removing" | "failed" | "removed";
type ExtensionMutationState = "idle" | "updating" | "removing" | "failed" | "removed";
type SkillDocumentMode = "preview" | "source";
type ExtensionContributionKind = "command" | "event" | "tool";

interface ExtensionContributionSelection {
  capabilityId: string;
  kind: ExtensionContributionKind;
  name: string;
}

const COMPONENT_CONTRIBUTION_KIND_KEYS = {
  slot: "extensions.toolbox.componentContributionKinds.slot",
  panel: "extensions.toolbox.componentContributionKinds.panel",
  "message-renderer": "extensions.toolbox.componentContributionKinds.messageRenderer",
  "message-part-renderer": "extensions.toolbox.componentContributionKinds.messagePartRenderer",
  "tool-renderer": "extensions.toolbox.componentContributionKinds.toolRenderer",
  "data-renderer": "extensions.toolbox.componentContributionKinds.dataRenderer",
  "settings-section": "extensions.toolbox.componentContributionKinds.settingsSection",
  "settings-item": "extensions.toolbox.componentContributionKinds.settingsItem",
  "main-view": "extensions.toolbox.componentContributionKinds.mainView",
  "workspace-surface": "extensions.toolbox.componentContributionKinds.workspaceSurface",
} as const satisfies Readonly<Record<ComponentExtensionContributionKind, string>>;

const COMPONENT_CONTRIBUTION_ERROR_SOURCES = {
  slot: "slot",
  panel: "panel",
  "message-renderer": "renderer",
  "message-part-renderer": "renderer",
  "tool-renderer": "renderer",
  "data-renderer": "renderer",
  "settings-section": "setting",
  "settings-item": "setting",
  "main-view": "main-view",
  "workspace-surface": "workspace",
} as const satisfies Readonly<Record<ComponentExtensionContributionKind, ExtensionErrorSource>>;

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

function abbreviateUserHomePath(filePath: string): string {
  const posixPath = filePath.replace(/^(?:\/home\/[^/]+|\/Users\/[^/]+|\/root)(?=\/|$)/, "~");
  if (posixPath !== filePath) return posixPath;

  return filePath.replace(/^[a-z]:\\Users\\[^\\]+(?=\\|$)/i, "~");
}

function parentDirectoryPath(filePath: string): string {
  const separatorIndex = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return separatorIndex > 0 ? filePath.slice(0, separatorIndex) : filePath;
}

function CopyableSourcePath({ path }: { path: string }) {
  const { t } = useI18n();
  const [copyState, setCopyState] = useState<"copied" | "failed" | "idle">("idle");
  const copyLabel = t(
    copyState === "copied"
      ? "extensions.toolbox.details.sourcePathCopied"
      : copyState === "failed"
        ? "extensions.toolbox.details.sourcePathCopyFailed"
        : "extensions.toolbox.details.copySourcePath",
  );

  const copyPath = () => {
    if (!navigator.clipboard) {
      setCopyState("failed");
      return;
    }

    void navigator.clipboard.writeText(path).then(
      () => setCopyState("copied"),
      () => setCopyState("failed"),
    );
  };

  return (
    <div className="bg-muted/55 flex min-w-0 items-center gap-2 rounded-lg border p-1.5 ps-2.5">
      <code className="min-w-0 flex-1 text-xs break-all" title={path}>
        {path}
      </code>
      <Button
        type="button"
        variant="outline"
        size="xs"
        className="active:translate-y-0!"
        aria-label={`${copyLabel}: ${path}`}
        title={copyLabel}
        onClick={copyPath}
      >
        {copyState === "copied" ? (
          <CheckIcon aria-hidden="true" />
        ) : (
          <ClipboardIcon aria-hidden="true" />
        )}
        {copyLabel}
      </Button>
    </div>
  );
}

function SourceFileList({ paths }: { paths: readonly string[] }) {
  return (
    <div className="grid gap-1.5">
      {paths.map((path) => (
        <CopyableSourcePath key={path} path={path} />
      ))}
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
  const { number, t } = useI18n();

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
  const { number, t } = useI18n();
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
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="shrink-0 active:translate-y-0!"
          onClick={onClose}
        >
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
  const { t } = useI18n();
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

function ComponentContributionDetails({
  capabilityId,
  contribution,
}: {
  capabilityId: string;
  contribution: ToolboxComponentContribution;
}) {
  const { t } = useI18n();
  const reportExtensionError = useExtensionErrorReporter();
  const Preview = contribution.preview;

  return (
    <article className="rounded-xl border p-3 sm:p-4">
      <header className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="bg-muted rounded-md px-2 py-1 text-[11px] font-medium">
          {t(COMPONENT_CONTRIBUTION_KIND_KEYS[contribution.kind])}
        </span>
        <code
          className="text-muted-foreground min-w-0 truncate text-[11px]"
          title={contribution.id}
        >
          {contribution.id}
        </code>
      </header>

      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        <DetailField label={t("extensions.toolbox.details.insertionPosition")}>
          {contribution.surface}
        </DetailField>
        <DetailField label={t("extensions.toolbox.details.extensionPoint")}>
          <code className="text-xs break-all">{contribution.target}</code>
        </DetailField>
        {contribution.host ? (
          <DetailField label={t("extensions.toolbox.details.renderMountPoint")}>
            <code className="text-xs break-all">{contribution.host}</code>
          </DetailField>
        ) : null}
        {contribution.description ? (
          <DetailField label={t("extensions.toolbox.details.mountBehavior")}>
            {contribution.description}
          </DetailField>
        ) : null}
        <div className="sm:col-span-2">
          <DetailField label={t("extensions.toolbox.details.componentSourceFiles")}>
            <SourceFileList paths={contribution.sourceFiles} />
          </DetailField>
        </div>
      </dl>

      <div className="mt-4 border-t pt-4">
        <h3 className="text-xs font-semibold">{t("extensions.toolbox.details.projectPreview")}</h3>
        <p className="text-muted-foreground mt-1 text-xs leading-5">
          {t("extensions.toolbox.details.projectPreviewDescription")}
        </p>
        <div className="bg-muted/30 mt-3 rounded-xl border p-3 sm:p-4">
          <ComponentPlacementPreview contribution={contribution} />
        </div>
      </div>

      <div className="mt-4 border-t pt-4">
        <h3 className="text-xs font-semibold">{t("extensions.toolbox.details.stylePreview")}</h3>
        <p className="text-muted-foreground mt-1 text-xs leading-5">
          {t("extensions.toolbox.details.stylePreviewDescription")}
        </p>
        <div
          className="bg-muted/30 mt-3 rounded-xl border p-3 sm:p-4"
          aria-label={t("extensions.toolbox.details.stylePreview")}
        >
          <div className="text-muted-foreground mb-3 flex min-w-0 items-center gap-2 text-xs">
            <span className="bg-background flex size-7 shrink-0 items-center justify-center rounded-lg border">
              <ComponentIcon aria-hidden="true" className="size-3.5" />
            </span>
            <span className="truncate">{contribution.surface}</span>
          </div>
          <div className="bg-background rounded-lg border p-3 shadow-sm sm:p-4">
            <ExtensionErrorBoundary
              contributionId={`${capabilityId}:${contribution.id}:preview`}
              source={COMPONENT_CONTRIBUTION_ERROR_SOURCES[contribution.kind]}
              onError={reportExtensionError}
              resetKey={Preview}
              fallback={
                <p className="text-destructive text-xs" role="alert">
                  {t("extensions.toolbox.details.stylePreviewError")}
                </p>
              }
            >
              <Preview />
            </ExtensionErrorBoundary>
          </div>
        </div>
      </div>
    </article>
  );
}

function officialPackageUrl(name: string, kind: "catalog" | "npm"): string {
  const encodedName = name.split("/").map(encodeURIComponent).join("/");
  return kind === "catalog"
    ? `https://pi.dev/packages/${encodedName}`
    : `https://www.npmjs.com/package/${encodedName}`;
}

function CapabilityMetadataFields({ params }: { params: ToolboxCapabilitySurfaceParams }) {
  const { t } = useI18n();
  const isPrompt = params.capabilityKind === "prompt";
  const isInstalledPackage = params.capabilityKind === "package" && params.installed === true;
  const isComponentExtension = params.capabilityKind === "component-extension";
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
      {isComponentExtension && params.entryFile ? (
        <DetailField label={t("extensions.toolbox.details.extensionEntryFile")}>
          <CopyableSourcePath path={params.entryFile} />
        </DetailField>
      ) : null}
      <DetailField label={t("extensions.toolbox.details.scope")}>
        {isComponentExtension
          ? t("extensions.toolbox.scopes.application")
          : params.scope
            ? scopeLabel(params.scope)
            : t("extensions.toolbox.details.notExposed")}
      </DetailField>
      <DetailField label={t("extensions.toolbox.details.origin")}>
        {isComponentExtension
          ? t(
              params.componentExtensionDistribution === "installable"
                ? "extensions.toolbox.origins.installedComponent"
                : "extensions.toolbox.origins.builtinComponent",
            )
          : params.origin
            ? t(`extensions.toolbox.origins.${params.origin}`)
            : t("extensions.toolbox.details.notExposed")}
      </DetailField>
    </>
  );
}

export function ToolboxCapabilityDetails({ params }: { params: ToolboxCapabilitySurfaceParams }) {
  const { date, number, t } = useI18n();
  const opener = useOpenerService();
  const workspaceContext = useWorkspaceContext();
  const activeSessionId = usePiActiveSessionId();
  const sessionId = params.catalogSessionId ?? activeSessionId;
  const catalogSessionState = usePiThreadListItemState(sessionId ?? "");
  const sessionRunning = catalogSessionState.metadata.running;
  const userPackageDir = usePiHostDescription()?.userPackageDir;
  const workspaces = usePiWorkspaces();
  const isSkill = params.capabilityKind === "skill";
  const isPrompt = params.capabilityKind === "prompt";
  const isPackage = params.capabilityKind === "package";
  const isExtension = params.capabilityKind === "extension";
  const isComponentExtension = params.capabilityKind === "component-extension";
  const installableComponentExtensions = useInstallableComponentExtensions();
  const installableComponentExtension = installableComponentExtensions.find(
    ({ extension }) => extension.id === params.componentExtensionId,
  );
  const componentExtensionInstalled =
    installableComponentExtension?.installed ?? params.installed !== false;
  const componentExtensionCanUninstall = installableComponentExtension !== undefined;
  const componentContributions = params.componentContributions ?? [];
  const isInstalledPackage = isPackage && params.installed === true;
  const isCatalogPackage = isPackage && !isInstalledPackage;
  const associatedPackageName = params.packageName;
  const hasPackageOverview = Boolean(associatedPackageName);
  const showPackageOverview = hasPackageOverview && !isSkill;
  const isPromptPackage = isCatalogPackage && params.packageTypes?.includes("prompt");
  const packageDetails = usePiPackageDetails(associatedPackageName ?? "", showPackageOverview);
  const skillDetails = usePiSkillDetails(
    sessionId ?? "",
    params.name,
    isSkill && Boolean(sessionId),
  );
  const displayedSkillFilePath = skillDetails.value?.filePath
    ? abbreviateUserHomePath(skillDetails.value.filePath)
    : undefined;
  const displayedExtensionFilePath = params.filePath
    ? abbreviateUserHomePath(params.filePath)
    : undefined;
  const displayedHeaderFilePath = isSkill
    ? displayedSkillFilePath
    : isExtension
      ? displayedExtensionFilePath
      : undefined;
  const headerFilePathTitle = isSkill ? skillDetails.value?.filePath : params.filePath;
  const skillDirectoryPath = skillDetails.value?.filePath
    ? parentDirectoryPath(skillDetails.value.filePath)
    : undefined;
  const extensionDirectoryPath = params.filePath ? parentDirectoryPath(params.filePath) : undefined;
  const skillPackageSource = params.packageName ?? params.source;
  const skillSourceLabel = isSkill
    ? params.origin === "package"
      ? skillPackageSource
        ? t("extensions.toolbox.details.skillSourcePackage", {
            source: skillPackageSource,
          })
        : t("extensions.toolbox.details.skillSourcePackageUnknown")
      : params.origin === "top-level"
        ? t("extensions.toolbox.details.skillSourceIndependent")
        : t("extensions.toolbox.details.notExposed")
    : undefined;
  const officialDetails = packageDetails.value;
  const Icon =
    isPrompt || isPromptPackage
      ? MessageSquareTextIcon
      : isPackage
        ? PackageIcon
        : isSkill
          ? SparklesIcon
          : isComponentExtension
            ? ComponentIcon
            : BoxesIcon;
  const [copied, setCopied] = useState(false);
  const [installFeedback, setInstallFeedback] = useState<PackageInstallFeedback>({
    status: "idle",
  });
  const [selectedInstallTarget, setSelectedInstallTarget] = useState<PackageInstallChoice | null>(
    null,
  );
  const [installedTargets, setInstalledTargets] = useState(() => new Set<string>());
  const [terminalLaunchFailed, setTerminalLaunchFailed] = useState(false);
  const [removeFeedback, setRemoveFeedback] = useState<PackageRemoveFeedback>({ status: "idle" });
  const [installedPackageRemoved, setInstalledPackageRemoved] = useState(false);
  const [skillEnabled, setSkillEnabled] = useState(params.enabled !== false);
  const [skillMutationState, setSkillMutationState] = useState<SkillMutationState>("idle");
  const [skillDocumentMode, setSkillDocumentMode] = useState<SkillDocumentMode>("preview");
  const [skillDeleteDialogOpen, setSkillDeleteDialogOpen] = useState(false);
  const [skillRemoved, setSkillRemoved] = useState(false);
  const [extensionEnabled, setExtensionEnabled] = useState(params.enabled !== false);
  const [extensionMutationState, setExtensionMutationState] =
    useState<ExtensionMutationState>("idle");
  const [extensionDeleteDialogOpen, setExtensionDeleteDialogOpen] = useState(false);
  const [extensionRemoved, setExtensionRemoved] = useState(false);
  const [extensionOpenFailed, setExtensionOpenFailed] = useState(false);
  const directoryResource = useMemo(
    () =>
      (isSkill && skillRemoved) || (isExtension && extensionRemoved)
        ? undefined
        : toolboxDirectoryResource(params, sessionId),
    [extensionRemoved, isExtension, isSkill, params, sessionId, skillRemoved],
  );
  const capabilityUninstalled =
    installedPackageRemoved ||
    (isComponentExtension && componentExtensionCanUninstall && !componentExtensionInstalled);
  const capabilityInactive =
    capabilityUninstalled || (isExtension && (!extensionEnabled || extensionRemoved));
  const activeWorkspaceId =
    params.projectId ?? catalogSessionState.metadata.workspace?.id ?? workspaceContext.projectId;
  const skillPackageRemovalTarget =
    params.origin === "package" && params.scope === "user" && sessionId
      ? { scope: "user" as const, sessionId }
      : params.origin === "package" && params.scope === "project" && activeWorkspaceId
        ? { scope: "project" as const, workspaceId: activeWorkspaceId }
        : undefined;
  const extensionPackageRemovalTarget =
    params.origin === "package" && params.scope === "user" && sessionId
      ? { scope: "user" as const, sessionId }
      : params.origin === "package" && params.scope === "project" && activeWorkspaceId
        ? { scope: "project" as const, workspaceId: activeWorkspaceId }
        : undefined;
  const skillMutationPending =
    skillMutationState === "updating" || skillMutationState === "removing";
  const canToggleSkill =
    isSkill &&
    Boolean(sessionId) &&
    !sessionRunning &&
    !skillRemoved &&
    !skillMutationPending &&
    params.scope !== "temporary" &&
    (params.origin !== "package" || Boolean(params.source));
  const canDeleteSkill =
    isSkill &&
    Boolean(sessionId) &&
    !sessionRunning &&
    !skillRemoved &&
    !skillMutationPending &&
    ((params.origin === "package" &&
      Boolean(params.source) &&
      Boolean(skillPackageRemovalTarget)) ||
      (params.origin === "top-level" &&
        params.source === "auto" &&
        params.scope !== "temporary" &&
        Boolean(skillDirectoryPath)));
  const extensionMutationPending =
    extensionMutationState === "updating" || extensionMutationState === "removing";
  const extensionIdentity =
    isExtension &&
    sessionId &&
    params.extensionName &&
    params.filePath &&
    params.source &&
    params.scope &&
    params.origin
      ? {
          sessionId,
          name: params.extensionName,
          filePath: params.filePath,
          source: params.source,
          scope: params.scope,
          origin: params.origin,
        }
      : undefined;
  const canToggleExtension =
    Boolean(extensionIdentity) &&
    !sessionRunning &&
    !extensionRemoved &&
    !extensionMutationPending &&
    params.scope !== "temporary";
  const canDeleteExtension =
    Boolean(extensionIdentity) &&
    !sessionRunning &&
    !extensionRemoved &&
    !extensionMutationPending &&
    ((params.origin === "package" &&
      Boolean(params.source) &&
      Boolean(extensionPackageRemovalTarget)) ||
      (params.origin === "top-level" &&
        params.source === "auto" &&
        params.scope !== "temporary" &&
        Boolean(extensionDirectoryPath)));
  const selectedInstallCommand =
    params.installCommand && selectedInstallTarget?.scope === "project"
      ? `${params.installCommand} --local`
      : params.installCommand;
  const selectedInstallProject =
    selectedInstallTarget?.scope === "project"
      ? workspaces.find((workspace) => workspace.id === selectedInstallTarget.workspaceId)
      : undefined;
  const selectedInstallPath =
    selectedInstallTarget?.scope === "user" ? userPackageDir : selectedInstallProject?.cwd;

  useEffect(() => {
    setSkillEnabled(params.enabled !== false);
    setSkillMutationState("idle");
    setSkillDocumentMode("preview");
    setSkillDeleteDialogOpen(false);
    setSkillRemoved(false);
  }, [params.capabilityId, params.enabled]);

  useEffect(() => {
    setExtensionEnabled(params.enabled !== false);
    setExtensionMutationState("idle");
    setExtensionDeleteDialogOpen(false);
    setExtensionRemoved(false);
    setExtensionOpenFailed(false);
  }, [params.capabilityId, params.enabled]);

  useEffect(() => {
    if (!directoryResource) return;
    return fileWorkspaceTargetService.activate(directoryResource);
  }, [directoryResource]);

  useEffect(() => {
    if (!isCatalogPackage || !sessionId) return;
    let active = true;
    const source = `npm:${params.name}`;
    void listInstalledPiPackages({ sessionId }).then(
      ({ packages }) => {
        if (!active) return;
        const discovered = new Set<string>();
        for (const installedPackage of packages) {
          if (installedPackage.source !== source) continue;
          if (installedPackage.scope === "user") discovered.add("user");
          else if (activeWorkspaceId) discovered.add(`project:${activeWorkspaceId}`);
        }
        if (discovered.size === 0) return;
        setInstalledTargets((current) => new Set([...current, ...discovered]));
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [activeWorkspaceId, isCatalogPackage, params.name, sessionId]);
  const detailsPlaceholder = packageDetails.loadState === "loading" ? "…" : "—";
  const publishedAt = params.publishedAt ?? officialDetails?.publishedAt;
  const monthlyDownloads = officialDetails?.monthlyDownloads ?? params.monthlyDownloads;
  const weeklyDownloads = officialDetails?.weeklyDownloads;
  const packageTypes = officialDetails?.types ?? params.packageTypes ?? [];
  const catalogDetailUrl = (() => {
    if (!associatedPackageName) return undefined;
    try {
      const url = new URL(
        params.catalogUrl ?? officialPackageUrl(associatedPackageName, "catalog"),
      );
      if (url.origin !== "https://pi.dev" || !url.pathname.startsWith("/packages/"))
        return undefined;
      const primaryType = packageTypes.find((type) => type !== "package");
      if (primaryType) url.searchParams.set("type", primaryType);
      return url.toString();
    } catch {
      return undefined;
    }
  })();
  const npmUrl =
    params.npmUrl ??
    (associatedPackageName ? officialPackageUrl(associatedPackageName, "npm") : undefined);
  const packageSizeBytes = officialDetails?.packageSizeBytes;
  const packageSize =
    packageSizeBytes === undefined
      ? undefined
      : packageSizeBytes >= 1_000_000
        ? `${number(packageSizeBytes / 1_000_000, { maximumFractionDigits: 1 })} MB`
        : packageSizeBytes >= 1_000
          ? `${number(packageSizeBytes / 1_000, { maximumFractionDigits: 1 })} KB`
          : `${number(packageSizeBytes)} B`;
  const displayedDescription =
    params.description ||
    (isExtension
      ? t("extensions.toolbox.extensions.capabilitySummary", {
          events: params.eventNames?.length ?? 0,
          tools: params.toolNames?.length ?? 0,
          commands: params.commandNames?.length ?? 0,
        })
      : t("extensions.toolbox.details.descriptionUnavailable"));

  const copyInstallCommand = () => {
    if (!selectedInstallCommand || !navigator.clipboard) return;
    void navigator.clipboard.writeText(selectedInstallCommand).then(
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
      removeFeedback.status === "removing" ||
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
    setRemoveFeedback({ status: "idle" });
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
  const selectedInstallKey = selectedInstallTarget
    ? installChoiceKey(selectedInstallTarget)
    : undefined;
  const selectedTargetInstalled = selectedInstallKey
    ? installedTargets.has(selectedInstallKey)
    : false;
  const activeWorkspace = activeWorkspaceId
    ? workspaces.find((workspace) => workspace.id === activeWorkspaceId)
    : undefined;
  const installedPackageTarget: PackageInstallChoice | null =
    isInstalledPackage && params.packageScope === "user"
      ? { scope: "user" }
      : isInstalledPackage && params.packageScope === "project" && activeWorkspaceId
        ? {
            scope: "project",
            workspaceId: activeWorkspaceId,
            workspaceName:
              params.projectName ??
              activeWorkspace?.name ??
              catalogSessionState.metadata.workspace?.name ??
              t("extensions.toolbox.packages.installLocationProjects"),
          }
        : null;
  const installedPackagePresent = isInstalledPackage && !installedPackageRemoved;
  const installationPresent = installedPackagePresent || selectedTargetInstalled;
  const uninstallTarget = isInstalledPackage ? installedPackageTarget : selectedInstallTarget;
  const uninstallSource = params.source ?? (isCatalogPackage ? `npm:${params.name}` : undefined);
  const removing = removeFeedback.status === "removing";
  const mutating = installing || removing;
  const showUninstallRow = installationPresent || removeFeedback.status !== "idle";
  const installTargetLabel = (target: PackageInstallChoice): string =>
    target.scope === "user"
      ? t("extensions.toolbox.packages.installLocationUser")
      : target.workspaceName;
  const selectInstallTarget = (target: PackageInstallChoice) => {
    setSelectedInstallTarget(target);
    setInstallFeedback({ status: "idle" });
    setRemoveFeedback({ status: "idle" });
    setTerminalLaunchFailed(false);
    setCopied(false);
  };
  const installInTerminal = () => {
    if (!selectedInstallTarget || !params.installCommand) return;
    if (selectedInstallTarget.scope === "project" && !selectedInstallProject) {
      setTerminalLaunchFailed(true);
      return;
    }

    const source = `npm:${params.name}`;
    const quotedSource = `'${source.replaceAll("'", `'\\''`)}'`;
    const command = `pi install ${quotedSource}${
      selectedInstallTarget.scope === "project" ? " --local" : ""
    }`;
    const cwd = selectedInstallProject?.cwd ?? workspaceContext.rootPath;
    const workspaceId =
      selectedInstallTarget.scope === "project"
        ? selectedInstallTarget.workspaceId
        : (workspaceContext.projectId ?? "application");

    setTerminalLaunchFailed(false);
    void opener
      .open({
        resource: {
          scheme: "terminal-command",
          path: command,
          label: t("extensions.toolbox.packages.terminalInstallTitle", { name: params.name }),
          metadata: {
            workspaceId,
            ...(cwd ? { cwd } : {}),
          },
        },
        context: workspaceContext,
        scope: { type: "application", key: workspaceContext.applicationId },
        policy: "force-focus",
      })
      .catch((error: unknown) => {
        console.error(error);
        setTerminalLaunchFailed(true);
      });
  };
  const uninstallPackage = () => {
    if (!installationPresent || !uninstallTarget || !uninstallSource || installing || removing) {
      return;
    }
    const rpcTarget =
      uninstallTarget.scope === "user"
        ? sessionId
          ? { scope: "user" as const, sessionId }
          : undefined
        : { scope: "project" as const, workspaceId: uninstallTarget.workspaceId };
    if (!rpcTarget) return;

    setRemoveFeedback({ status: "removing", target: uninstallTarget });
    void removePiPackage({ source: uninstallSource, target: rpcTarget }).then(
      () => {
        setInstalledTargets((current) => {
          const next = new Set(current);
          next.delete(installChoiceKey(uninstallTarget));
          return next;
        });
        if (isInstalledPackage) setInstalledPackageRemoved(true);
        setInstallFeedback({ status: "idle" });
        setRemoveFeedback({ status: "removed", target: uninstallTarget });
        notifyToolboxPackagesChanged();
      },
      (error: unknown) =>
        setRemoveFeedback({
          status: "failed",
          target: uninstallTarget,
          ...(error instanceof PiApiError ? { errorCode: error.code } : {}),
        }),
    );
  };
  const updateSkillEnabled = (enabled: boolean) => {
    if (!sessionId || !canToggleSkill || enabled === skillEnabled) return;
    setSkillMutationState("updating");
    void setPiSkillEnabled({ sessionId, name: params.name, enabled }).then(
      (value) => {
        setSkillEnabled(value.enabled);
        setSkillMutationState("idle");
        notifyToolboxSkillsChanged();
      },
      () => setSkillMutationState("failed"),
    );
  };
  const openSkillDirectory = () => {
    if (directoryResource?.scheme !== "skill-directory") return;
    void opener
      .open({
        resource: directoryResource,
        context: workspaceContext,
        policy: "force-focus",
      })
      .catch((error: unknown) => {
        console.error(error);
      });
  };
  const deleteSkill = () => {
    if (!sessionId || !canDeleteSkill) return;
    setSkillMutationState("removing");
    const operation =
      params.origin === "package" && params.source && skillPackageRemovalTarget
        ? removePiPackage({ source: params.source, target: skillPackageRemovalTarget })
        : removePiSkill({ sessionId, name: params.name });
    void operation.then(
      () => {
        setSkillEnabled(false);
        setSkillRemoved(true);
        setSkillMutationState("removed");
        setSkillDeleteDialogOpen(false);
        notifyToolboxSkillsChanged();
        if (params.origin === "package") notifyToolboxPackagesChanged();
      },
      () => setSkillMutationState("failed"),
    );
  };
  const updateExtensionEnabled = (enabled: boolean) => {
    if (!extensionIdentity || !canToggleExtension || enabled === extensionEnabled) return;
    setExtensionMutationState("updating");
    void setPiExtensionEnabled({ ...extensionIdentity, enabled }).then(
      (value) => {
        setExtensionEnabled(value.enabled);
        setExtensionMutationState("idle");
        notifyToolboxExtensionsChanged();
      },
      () => setExtensionMutationState("failed"),
    );
  };
  const openExtensionDirectory = () => {
    if (directoryResource?.scheme !== "extension-directory") return;
    setExtensionOpenFailed(false);
    void opener
      .open({
        resource: directoryResource,
        context: workspaceContext,
        policy: "force-focus",
      })
      .catch(() => setExtensionOpenFailed(true));
  };
  const deleteExtension = () => {
    if (!extensionIdentity || !canDeleteExtension) return;
    setExtensionMutationState("removing");
    const operation =
      params.origin === "package" && params.source && extensionPackageRemovalTarget
        ? removePiPackage({ source: params.source, target: extensionPackageRemovalTarget })
        : removePiExtension(extensionIdentity);
    void operation.then(
      () => {
        setExtensionEnabled(false);
        setExtensionRemoved(true);
        setExtensionMutationState("removed");
        setExtensionDeleteDialogOpen(false);
        notifyToolboxExtensionsChanged();
        if (params.origin === "package") notifyToolboxPackagesChanged();
      },
      () => setExtensionMutationState("failed"),
    );
  };
  const installStatusMessage = (() => {
    if (installFeedback.status === "idle") return "";
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
    if (installFeedback.errorCode === "session-busy") {
      return t("extensions.toolbox.packages.mutationSessionBusy");
    }
    return t("extensions.toolbox.packages.installFailed");
  })();
  const removeStatusMessage = (() => {
    if (removeFeedback.status === "idle") return "";
    if (removeFeedback.status === "removing") {
      return t("extensions.toolbox.packages.removingAt", {
        target: installTargetLabel(removeFeedback.target),
      });
    }
    if (removeFeedback.status === "removed") {
      return removeFeedback.target.scope === "user"
        ? t("extensions.toolbox.packages.removeSuccess")
        : t("extensions.toolbox.packages.removeProjectSuccess", {
            project: removeFeedback.target.workspaceName,
          });
    }
    if (removeFeedback.errorCode === "project-untrusted") {
      return t("extensions.toolbox.packages.removeProjectUntrusted");
    }
    if (removeFeedback.errorCode === "workspace-not-found") {
      return t("extensions.toolbox.packages.removeWorkspaceMissing");
    }
    if (removeFeedback.errorCode === "package-not-installed") {
      return t("extensions.toolbox.packages.removeAlreadyMissing");
    }
    if (removeFeedback.errorCode === "session-not-found") {
      return t("extensions.toolbox.packages.removeSessionMissing");
    }
    if (removeFeedback.errorCode === "session-busy") {
      return t("extensions.toolbox.packages.mutationSessionBusy");
    }
    return t("extensions.toolbox.packages.removeFailed");
  })();

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div
        className={
          isSkill
            ? "flex min-h-0 flex-1 flex-col overflow-hidden px-12 py-4"
            : isExtension
              ? "min-h-0 flex-1 overflow-y-auto px-12 pt-4 pb-6"
              : "min-h-0 flex-1 overflow-y-auto px-12 py-4"
        }
      >
        <header className="flex shrink-0 items-start gap-2.5">
          {!isSkill && !isExtension ? (
            <span className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-xl">
              <Icon aria-hidden="true" className="size-4" />
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            {!isSkill && !isExtension ? (
              <p className="text-muted-foreground text-xs font-medium">
                {t(
                  isPrompt
                    ? "extensions.toolbox.capabilityKinds.prompt"
                    : isPackage
                      ? isPromptPackage
                        ? "extensions.toolbox.capabilityKinds.prompt"
                        : "extensions.toolbox.capabilityKinds.package"
                      : isComponentExtension
                        ? "extensions.toolbox.capabilityKinds.componentExtension"
                        : "extensions.toolbox.capabilityKinds.extension",
                )}
              </p>
            ) : null}
            {isSkill ? (
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                <h1 className="font-mono text-2xl leading-8 font-semibold break-all">
                  {params.name}
                </h1>
                <span className="text-muted-foreground text-xs leading-5">{skillSourceLabel}</span>
              </div>
            ) : (
              <h1
                className={
                  isExtension
                    ? "font-mono text-2xl leading-8 font-semibold break-all"
                    : "mt-0.5 font-mono text-lg font-semibold break-all"
                }
              >
                {params.name}
              </h1>
            )}
            {displayedHeaderFilePath ? (
              <span
                className="text-muted-foreground mt-1 block text-base leading-6 break-all"
                title={headerFilePathTitle}
              >
                {displayedHeaderFilePath}
              </span>
            ) : null}
          </div>
          {!isSkill ? (
            <span
              className={
                capabilityInactive
                  ? "bg-muted text-muted-foreground rounded-full border px-2.5 py-1 text-[11px] font-medium"
                  : "rounded-full border border-emerald-500/15 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300"
              }
            >
              {t(
                isExtension
                  ? extensionEnabled && !extensionRemoved
                    ? "extensions.toolbox.extensions.loaded"
                    : "extensions.toolbox.extensions.disabled"
                  : isComponentExtension && componentExtensionCanUninstall
                    ? componentExtensionInstalled
                      ? "extensions.toolbox.status.installed"
                      : "extensions.toolbox.status.uninstalled"
                    : isCatalogPackage
                      ? "extensions.toolbox.status.officialCatalog"
                      : isInstalledPackage
                        ? installedPackageRemoved
                          ? "extensions.toolbox.status.uninstalled"
                          : "extensions.toolbox.status.installed"
                        : isPrompt
                          ? "extensions.toolbox.status.available"
                          : "extensions.toolbox.status.loaded",
              )}
            </span>
          ) : null}
        </header>

        <p className="text-muted-foreground mt-3 shrink-0 text-sm leading-5">
          {displayedDescription}
        </p>

        {isExtension ? (
          <div className="mt-4 shrink-0 border-t pt-4">
            <div className="flex items-center gap-1">
              <div className="bg-muted/30 dark:bg-foreground/8 flex h-7 items-center gap-1 rounded-lg px-1.5">
                <Switch
                  checked={extensionEnabled && !extensionRemoved}
                  disabled={!canToggleExtension}
                  className="h-4! w-7! [&_[data-slot=switch-thumb]]:size-3! [&_[data-slot=switch-thumb]]:data-checked:translate-x-3!"
                  aria-label={t(
                    extensionEnabled
                      ? "extensions.toolbox.extensions.disableExtension"
                      : "extensions.toolbox.extensions.enableExtension",
                    { name: params.name },
                  )}
                  aria-busy={extensionMutationState === "updating"}
                  title={t(
                    sessionRunning
                      ? "extensions.toolbox.extensions.sessionBusy"
                      : extensionEnabled
                        ? "extensions.toolbox.extensions.disableExtension"
                        : "extensions.toolbox.extensions.enableExtension",
                    { name: params.name },
                  )}
                  onCheckedChange={updateExtensionEnabled}
                />
                <span className="text-muted-foreground text-xs">
                  {t(
                    extensionEnabled && !extensionRemoved
                      ? "extensions.toolbox.extensions.enabledStatus"
                      : "extensions.toolbox.extensions.disabledStatus",
                  )}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={directoryResource?.scheme !== "extension-directory"}
                className="active:translate-y-0!"
                aria-label={t("extensions.toolbox.extensions.openFolder", { name: params.name })}
                title={t("extensions.toolbox.extensions.openFolder", { name: params.name })}
                onClick={openExtensionDirectory}
              >
                <FolderOpenIcon aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={!canDeleteExtension}
                className="text-destructive hover:text-destructive active:translate-y-0!"
                aria-label={t("extensions.toolbox.extensions.deleteExtension", {
                  name: params.name,
                })}
                title={t(
                  canDeleteExtension
                    ? "extensions.toolbox.extensions.deleteExtension"
                    : "extensions.toolbox.extensions.deleteUnavailable",
                  { name: params.name },
                )}
                onClick={() => setExtensionDeleteDialogOpen(true)}
              >
                <Trash2Icon aria-hidden="true" />
              </Button>
            </div>
            {extensionOpenFailed || extensionMutationState === "failed" ? (
              <p className="text-destructive mt-2 text-xs leading-5" role="alert">
                {t(
                  extensionOpenFailed
                    ? "extensions.toolbox.extensions.openFolderFailed"
                    : "extensions.toolbox.extensions.actionFailed",
                )}
              </p>
            ) : extensionMutationState === "removed" ? (
              <p className="text-muted-foreground mt-2 text-xs leading-5" role="status">
                {t(
                  params.origin === "package"
                    ? "extensions.toolbox.extensions.packageRemoved"
                    : "extensions.toolbox.extensions.removed",
                )}
              </p>
            ) : null}
          </div>
        ) : null}

        {isSkill && skillMutationState === "failed" ? (
          <p className="text-destructive mt-2 text-xs leading-5" role="alert">
            {t("extensions.toolbox.skills.actionFailed")}
          </p>
        ) : isSkill && skillMutationState === "removed" ? (
          <p className="text-muted-foreground mt-2 text-xs leading-5" role="status">
            {t(
              params.origin === "package"
                ? "extensions.toolbox.skills.packageRemoved"
                : "extensions.toolbox.skills.removed",
            )}
          </p>
        ) : null}

        {!isSkill && (!isExtension || showPackageOverview) ? (
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
                    <code className="text-xs break-all">{associatedPackageName}</code>
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
              ) : (
                <CapabilityMetadataFields params={params} />
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
        ) : null}

        {showPackageOverview && !isCatalogPackage && !isExtension ? (
          <div className="mt-4 border-t pt-4">
            <h2 className="mb-3 text-sm font-semibold">
              {t("extensions.toolbox.details.capabilityDetails")}
            </h2>
            <dl className="grid gap-3">
              <CapabilityMetadataFields params={params} />
            </dl>
          </div>
        ) : null}

        {isExtension ? (
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
        ) : null}

        {isSkill ? (
          <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden border-t pt-4">
            <div className="mb-4 flex shrink-0 items-center gap-1">
              <div className="bg-muted/30 dark:bg-foreground/8 flex h-7 items-center gap-1 rounded-lg px-1.5">
                <Switch
                  checked={skillEnabled && !skillRemoved}
                  disabled={!canToggleSkill}
                  className="h-4! w-7! [&_[data-slot=switch-thumb]]:size-3! [&_[data-slot=switch-thumb]]:data-checked:translate-x-3!"
                  aria-label={t(
                    skillEnabled
                      ? "extensions.toolbox.skills.disableSkill"
                      : "extensions.toolbox.skills.enableSkill",
                    { name: params.name },
                  )}
                  aria-busy={skillMutationState === "updating"}
                  title={t(
                    sessionRunning
                      ? "extensions.toolbox.skills.sessionBusy"
                      : skillEnabled
                        ? "extensions.toolbox.skills.disableSkill"
                        : "extensions.toolbox.skills.enableSkill",
                    { name: params.name },
                  )}
                  onCheckedChange={updateSkillEnabled}
                />
                <span className="text-muted-foreground text-xs">
                  {t(
                    skillEnabled && !skillRemoved
                      ? "extensions.toolbox.skills.enabledStatus"
                      : "extensions.toolbox.skills.disabledStatus",
                  )}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={directoryResource?.scheme !== "skill-directory"}
                className="active:translate-y-0!"
                aria-label={t("extensions.toolbox.skills.openFolder", { name: params.name })}
                title={t("extensions.toolbox.skills.openFolder", { name: params.name })}
                onClick={openSkillDirectory}
              >
                <FolderOpenIcon aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={!canDeleteSkill}
                className="text-destructive hover:text-destructive active:translate-y-0!"
                aria-label={t("extensions.toolbox.skills.deleteSkill", { name: params.name })}
                title={t(
                  canDeleteSkill
                    ? "extensions.toolbox.skills.deleteSkill"
                    : "extensions.toolbox.skills.deleteUnavailable",
                  { name: params.name },
                )}
                onClick={() => setSkillDeleteDialogOpen(true)}
              >
                <Trash2Icon aria-hidden="true" />
              </Button>
            </div>
            <div className="mb-3 flex min-h-7 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <h2 className="text-sm font-semibold">
                {t("extensions.toolbox.details.skillDocument")}
              </h2>
              <div
                className="flex items-center gap-1"
                role="group"
                aria-label={t("extensions.toolbox.details.skillDocumentViewMode")}
              >
                {skillDetails.value?.content ? (
                  <>
                    <Button
                      type="button"
                      variant={skillDocumentMode === "preview" ? "secondary" : "ghost"}
                      size="xs"
                      className="active:translate-y-0!"
                      aria-pressed={skillDocumentMode === "preview"}
                      title={t("extensions.toolbox.details.skillDocumentPreview")}
                      onClick={() => setSkillDocumentMode("preview")}
                    >
                      <EyeIcon aria-hidden="true" />
                      {t("extensions.toolbox.details.skillDocumentPreview")}
                    </Button>
                    <Button
                      type="button"
                      variant={skillDocumentMode === "source" ? "secondary" : "ghost"}
                      size="xs"
                      className="active:translate-y-0!"
                      aria-pressed={skillDocumentMode === "source"}
                      title={t("extensions.toolbox.details.skillDocumentSource")}
                      onClick={() => setSkillDocumentMode("source")}
                    >
                      <Code2Icon aria-hidden="true" />
                      {t("extensions.toolbox.details.skillDocumentSource")}
                    </Button>
                  </>
                ) : null}
                {skillDetails.loadState === "failed" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="active:translate-y-0!"
                    onClick={skillDetails.refresh}
                  >
                    {t("extensions.toolbox.details.retry")}
                  </Button>
                ) : null}
              </div>
            </div>
            {!sessionId ? (
              <p className="text-muted-foreground text-xs leading-5">
                {t("extensions.toolbox.details.skillDocumentSessionRequired")}
              </p>
            ) : skillDetails.loadState === "loading" ? (
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
            ) : skillDetails.loadState === "failed" ? (
              <p className="text-destructive text-xs leading-5" role="alert">
                {t("extensions.toolbox.details.skillDocumentLoadFailed")}
              </p>
            ) : skillDetails.value?.content ? (
              <div
                aria-label={t("extensions.toolbox.details.skillDocument")}
                className="focus-visible:ring-ring min-h-0 w-full flex-1 overflow-auto rounded-lg border bg-transparent outline-none focus-visible:ring-2"
                role="document"
                tabIndex={0}
              >
                {skillDocumentMode === "preview" ? (
                  <article className="w-full px-6 py-5 text-sm leading-7 break-words">
                    <MarkdownTextContent
                      text={skillDetails.value.content}
                      defer={false}
                      mode="static"
                    />
                  </article>
                ) : (
                  <pre className="min-h-full w-full p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-words">
                    {skillDetails.value.content}
                  </pre>
                )}
              </div>
            ) : skillDetails.loadState === "ready" ? (
              <p className="text-muted-foreground text-xs leading-5">
                {t("extensions.toolbox.details.skillDocumentEmpty")}
              </p>
            ) : null}
          </div>
        ) : null}

        {isCatalogPackage ? (
          <div className="mt-4 border-t pt-4">
            <h2 className="mb-3 text-sm font-semibold">
              {t("extensions.toolbox.packages.installLocation")}
            </h2>
            <div className="flex flex-wrap items-center gap-2" aria-live="polite">
              <DropdownMenu>
                <DropdownMenuTrigger
                  type="button"
                  disabled={mutating}
                  aria-label={t("extensions.toolbox.packages.chooseInstallLocation")}
                  className={buttonVariants({
                    variant: "outline",
                    className: "min-w-44 justify-between active:translate-y-0!",
                  })}
                >
                  {selectedInstallTarget?.scope === "user" ? (
                    <UserRoundIcon aria-hidden="true" />
                  ) : selectedInstallTarget?.scope === "project" ? (
                    <FolderIcon aria-hidden="true" />
                  ) : (
                    <MapPinIcon aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-left">
                    {selectedInstallTarget
                      ? installTargetLabel(selectedInstallTarget)
                      : t("extensions.toolbox.packages.chooseInstallLocation")}
                  </span>
                  <ChevronDownIcon aria-hidden="true" className="size-3.5 shrink-0 opacity-70" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="bottom" className="w-72">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>
                      {t("extensions.toolbox.packages.installLocation")}
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                      disabled={!sessionId}
                      className="items-start py-2"
                      onClick={() => selectInstallTarget({ scope: "user" })}
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
                      {installedTargets.has("user") || selectedInstallKey === "user" ? (
                        <CheckIcon
                          aria-hidden="true"
                          className={
                            installedTargets.has("user") ? "mt-0.5 text-emerald-600" : "mt-0.5"
                          }
                        />
                      ) : null}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger
                      disabled={workspaces.length === 0}
                      className="items-start py-2 data-disabled:pointer-events-none data-disabled:opacity-50"
                    >
                      <FolderIcon aria-hidden="true" className="mt-0.5" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">
                          {t("extensions.toolbox.packages.installLocationProjects")}
                        </span>
                        <span className="text-muted-foreground mt-0.5 block text-xs leading-4 whitespace-normal">
                          {workspaces.length > 0
                            ? t("extensions.toolbox.packages.installProjectsCount", {
                                count: workspaces.length,
                              })
                            : t("extensions.toolbox.packages.installProjectsEmpty")}
                        </span>
                      </span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-72">
                      <DropdownMenuGroup>
                        <DropdownMenuLabel>
                          {t("extensions.toolbox.packages.installLocationProjects")}
                        </DropdownMenuLabel>
                        {workspaces.map((workspace) => {
                          const targetKey = `project:${workspace.id}`;
                          const targetInstalled = installedTargets.has(targetKey);
                          return (
                            <DropdownMenuItem
                              key={workspace.id}
                              className="items-start py-2"
                              onClick={() =>
                                selectInstallTarget({
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
                              {targetInstalled || selectedInstallKey === targetKey ? (
                                <CheckIcon
                                  aria-hidden="true"
                                  className={targetInstalled ? "mt-0.5 text-emerald-600" : "mt-0.5"}
                                />
                              ) : null}
                            </DropdownMenuItem>
                          );
                        })}
                      </DropdownMenuGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </DropdownMenuContent>
              </DropdownMenu>
              {selectedInstallTarget ? (
                <code
                  className="text-muted-foreground min-w-0 flex-1 truncate text-xs"
                  title={selectedInstallPath}
                >
                  {selectedInstallPath ?? "…"}
                </code>
              ) : (
                <p className="text-muted-foreground text-xs">
                  {t("extensions.toolbox.packages.installChooseLocation")}
                </p>
              )}
            </div>
            <div className="mt-4 grid gap-4 border-t pt-4 sm:grid-cols-[15rem_minmax(0,1fr)]">
              <div className="min-w-0">
                <h2 className="mb-3 text-sm font-semibold">
                  {t("extensions.toolbox.packages.installQuick")}
                </h2>
                <div className="flex flex-wrap items-center gap-2" aria-live="polite">
                  <Button
                    type="button"
                    disabled={
                      !selectedInstallTarget ||
                      mutating ||
                      selectedTargetInstalled ||
                      (selectedInstallTarget.scope === "user" && !sessionId)
                    }
                    className="active:translate-y-0!"
                    onClick={() => {
                      if (selectedInstallTarget) installPackage(selectedInstallTarget);
                    }}
                  >
                    {installing ? (
                      <LoaderCircleIcon
                        aria-hidden="true"
                        className="animate-spin motion-reduce:animate-none"
                      />
                    ) : selectedTargetInstalled ? (
                      <CheckIcon aria-hidden="true" />
                    ) : (
                      <PackagePlusIcon aria-hidden="true" />
                    )}
                    {t(
                      installing
                        ? "extensions.toolbox.packages.installing"
                        : selectedTargetInstalled
                          ? "extensions.toolbox.packages.installed"
                          : "extensions.toolbox.packages.installNow",
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      !selectedInstallTarget ||
                      mutating ||
                      selectedTargetInstalled ||
                      !params.installCommand ||
                      (selectedInstallTarget.scope === "project" &&
                        !workspaces.some(
                          (workspace) => workspace.id === selectedInstallTarget.workspaceId,
                        ))
                    }
                    className="active:translate-y-0!"
                    onClick={installInTerminal}
                  >
                    <SquareTerminalIcon aria-hidden="true" />
                    {t("extensions.toolbox.packages.installInTerminal")}
                  </Button>
                  {installFeedback.status !== "idle" ? (
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
                  ) : null}
                  {terminalLaunchFailed ? (
                    <p className="text-destructive basis-full text-xs" role="alert">
                      {t("extensions.toolbox.packages.terminalInstallOpenFailed")}
                    </p>
                  ) : null}
                  {installing ? (
                    <Progress
                      value={null}
                      aria-label={t("extensions.toolbox.packages.installing")}
                      aria-valuetext={installStatusMessage}
                      className="basis-full pt-1"
                      trackClassName="max-w-md"
                    />
                  ) : null}
                </div>
              </div>
              <div className="min-w-0 border-t pt-4 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-4">
                <h2 className="mb-3 text-sm font-semibold">
                  {t("extensions.toolbox.packages.install")}
                </h2>
                <div className="bg-muted inline-flex max-w-full items-center gap-1.5 rounded-lg p-1 ps-2.5">
                  <code className="min-w-0 overflow-x-auto text-xs leading-5 whitespace-nowrap">
                    {selectedInstallCommand}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    className="shrink-0 active:translate-y-0!"
                    onClick={copyInstallCommand}
                  >
                    {copied ? (
                      <CheckIcon aria-hidden="true" />
                    ) : (
                      <ClipboardIcon aria-hidden="true" />
                    )}
                    {t(
                      copied
                        ? "extensions.toolbox.packages.copied"
                        : "extensions.toolbox.packages.copyCommand",
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {isComponentExtension ? (
          <div className="mt-4 border-t pt-4">
            <h2 className="text-sm font-semibold">
              {t("extensions.toolbox.details.componentContributions")}
            </h2>
            <p className="text-muted-foreground mt-1 text-xs leading-5">
              {t("extensions.toolbox.details.componentContributionsDescription")}
            </p>
            <div className="mt-3 grid gap-3">
              {componentContributions.length > 0 ? (
                componentContributions.map((contribution) => (
                  <ComponentContributionDetails
                    key={`${contribution.kind}:${contribution.id}`}
                    capabilityId={params.capabilityId}
                    contribution={contribution}
                  />
                ))
              ) : (
                <p className="text-muted-foreground text-xs" role="status">
                  {t("extensions.toolbox.details.none")}
                </p>
              )}
            </div>
          </div>
        ) : null}

        {isComponentExtension && componentExtensionCanUninstall ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4" aria-live="polite">
            <Button
              type="button"
              variant={componentExtensionInstalled ? "destructive" : "default"}
              className="active:translate-y-0!"
              onClick={() => {
                if (!params.componentExtensionId) return;
                setComponentExtensionInstalled(
                  params.componentExtensionId,
                  !componentExtensionInstalled,
                );
              }}
            >
              {componentExtensionInstalled ? (
                <Trash2Icon aria-hidden="true" />
              ) : (
                <PackagePlusIcon aria-hidden="true" />
              )}
              {t(
                componentExtensionInstalled
                  ? "extensions.toolbox.componentExtensions.uninstall"
                  : "extensions.toolbox.componentExtensions.install",
              )}
            </Button>
            <p className="text-muted-foreground text-xs">
              {t(
                componentExtensionInstalled
                  ? "extensions.toolbox.componentExtensions.installedDescription"
                  : "extensions.toolbox.componentExtensions.uninstalledDescription",
              )}
            </p>
          </div>
        ) : null}

        {showUninstallRow ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4" aria-live="polite">
            {installationPresent ? (
              <Button
                type="button"
                variant="destructive"
                disabled={!uninstallTarget || !uninstallSource || mutating}
                className="active:translate-y-0!"
                onClick={uninstallPackage}
              >
                {removing ? (
                  <LoaderCircleIcon
                    aria-hidden="true"
                    className="animate-spin motion-reduce:animate-none"
                  />
                ) : (
                  <Trash2Icon aria-hidden="true" />
                )}
                {t(
                  removing
                    ? "extensions.toolbox.packages.removing"
                    : "extensions.toolbox.packages.remove",
                )}
              </Button>
            ) : null}
            {removeFeedback.status !== "idle" ? (
              <p
                className={
                  removeFeedback.status === "failed"
                    ? "text-destructive text-xs"
                    : removeFeedback.status === "removed"
                      ? "text-emerald-700 text-xs dark:text-emerald-300"
                      : "text-muted-foreground text-xs"
                }
                role={removeFeedback.status === "failed" ? "alert" : "status"}
              >
                {removeStatusMessage}
              </p>
            ) : null}
            {installationPresent && !uninstallTarget ? (
              <p className="text-destructive basis-full text-xs" role="alert">
                {t("extensions.toolbox.packages.removeTargetUnavailable")}
              </p>
            ) : null}
            {removing ? (
              <Progress
                value={null}
                aria-label={t("extensions.toolbox.packages.removing")}
                aria-valuetext={removeStatusMessage}
                className="basis-full pt-1"
                trackClassName="max-w-md"
              />
            ) : null}
          </div>
        ) : null}

        {!isPackage && !isSkill ? (
          <aside className="text-muted-foreground mt-5 border-t pt-4 text-xs leading-5">
            {t(
              isPrompt
                ? "extensions.toolbox.details.promptProtocolLimit"
                : isComponentExtension
                  ? "extensions.toolbox.details.componentExtensionLifecycle"
                  : "extensions.toolbox.details.extensionProtocolLimit",
            )}
          </aside>
        ) : null}
      </div>
      {isSkill ? (
        <Dialog
          open={skillDeleteDialogOpen}
          onOpenChange={(open) => {
            if (skillMutationState === "removing") return;
            if (open) setSkillMutationState("idle");
            setSkillDeleteDialogOpen(open);
          }}
        >
          <DialogContent
            closeLabel={t("extensions.toolbox.skills.cancelDelete")}
            showCloseButton={false}
          >
            <DialogHeader>
              <DialogTitle>{t("extensions.toolbox.skills.deleteTitle")}</DialogTitle>
              <DialogDescription>
                {params.origin === "package"
                  ? t("extensions.toolbox.skills.deletePackageDescription", {
                      source: params.source ?? params.name,
                    })
                  : t("extensions.toolbox.skills.deleteIndependentDescription", {
                      name: params.name,
                      path: displayedSkillFilePath ?? skillDirectoryPath ?? params.name,
                    })}
              </DialogDescription>
            </DialogHeader>
            {skillMutationState === "failed" ? (
              <p className="text-destructive text-xs leading-5" role="alert">
                {t("extensions.toolbox.skills.deleteFailed")}
              </p>
            ) : null}
            <DialogFooter closeLabel={t("extensions.toolbox.skills.cancelDelete")} className="m-0">
              <Button
                type="button"
                variant="outline"
                disabled={skillMutationState === "removing"}
                onClick={() => setSkillDeleteDialogOpen(false)}
              >
                {t("extensions.toolbox.skills.cancelDelete")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={!canDeleteSkill}
                onClick={deleteSkill}
              >
                {skillMutationState === "removing" ? (
                  <LoaderCircleIcon
                    aria-hidden="true"
                    className="animate-spin motion-reduce:animate-none"
                  />
                ) : (
                  <Trash2Icon aria-hidden="true" />
                )}
                {t(
                  skillMutationState === "removing"
                    ? "extensions.toolbox.skills.deleting"
                    : "extensions.toolbox.skills.confirmDelete",
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
      {isExtension ? (
        <Dialog
          open={extensionDeleteDialogOpen}
          onOpenChange={(open) => {
            if (extensionMutationState === "removing") return;
            if (open) setExtensionMutationState("idle");
            setExtensionDeleteDialogOpen(open);
          }}
        >
          <DialogContent
            closeLabel={t("extensions.toolbox.extensions.cancelDelete")}
            showCloseButton={false}
          >
            <DialogHeader>
              <DialogTitle>{t("extensions.toolbox.extensions.deleteTitle")}</DialogTitle>
              <DialogDescription>
                {params.origin === "package"
                  ? t("extensions.toolbox.extensions.deletePackageDescription", {
                      source: params.source ?? params.name,
                    })
                  : t("extensions.toolbox.extensions.deleteIndependentDescription", {
                      name: params.name,
                      path: displayedExtensionFilePath ?? extensionDirectoryPath ?? params.name,
                    })}
              </DialogDescription>
            </DialogHeader>
            {extensionMutationState === "failed" ? (
              <p className="text-destructive text-xs leading-5" role="alert">
                {t("extensions.toolbox.extensions.deleteFailed")}
              </p>
            ) : null}
            <DialogFooter
              closeLabel={t("extensions.toolbox.extensions.cancelDelete")}
              className="m-0"
            >
              <Button
                type="button"
                variant="outline"
                disabled={extensionMutationState === "removing"}
                onClick={() => setExtensionDeleteDialogOpen(false)}
              >
                {t("extensions.toolbox.extensions.cancelDelete")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={!canDeleteExtension}
                onClick={deleteExtension}
              >
                {extensionMutationState === "removing" ? (
                  <LoaderCircleIcon
                    aria-hidden="true"
                    className="animate-spin motion-reduce:animate-none"
                  />
                ) : (
                  <Trash2Icon aria-hidden="true" />
                )}
                {t(
                  extensionMutationState === "removing"
                    ? "extensions.toolbox.extensions.deleting"
                    : "extensions.toolbox.extensions.confirmDelete",
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
}
