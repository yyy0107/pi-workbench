"use client";

import {
  BoxesIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleXIcon,
  ClipboardIcon,
  FolderIcon,
  LoaderCircleIcon,
  MapPinIcon,
  MessageSquareTextIcon,
  PackageIcon,
  PackagePlusIcon,
  RefreshCwIcon,
  SparklesIcon,
  SquareTerminalIcon,
  Trash2Icon,
  UserRoundIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useOpenerService, useWorkspaceContext } from "@workbench/shell/right-workspace/react";
import { Button, buttonVariants } from "@workbench/shell/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workbench/shell/ui";
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
} from "@workbench/shell/ui";
import { Progress } from "@workbench/shell/ui";
import { useClipboardCopy } from "@workbench/shell/hooks";
import { usePiI18n } from "../../i18n";
import { PiApiError } from "@workbench/agent-runtime-pi-client/errors";
import { usePiHostDescription } from "@workbench/agent-runtime-pi-client/host";
import { usePiResourceClient } from "@workbench/agent-runtime-pi-client/resources";
import { usePiWorkspaces } from "@workbench/agent-runtime-pi-client/workspace";
import { usePiFileWorkspaceTargetService } from "../../public/installation-services";

import {
  toolboxDirectoryResource,
  type ToolboxCapabilitySurfaceParams,
} from "./toolbox-capability";
import { toolboxScopeTarget } from "./toolbox-scope";
import { useToolboxScope } from "./toolbox-scope-store";
import { usePiInstalledPackageDetails } from "./use-pi-installed-package-details";
import { usePiPackageDetails } from "./use-pi-package-details";
import { usePiPackageUpdates } from "./use-pi-package-updates";
import { usePiSkillDetails } from "./use-pi-skill-details";
import {
  CapabilityMetadataFields,
  ExtensionCapabilityDetailsPanel,
  ExtensionControls,
  PackageOverviewPanel,
  SkillDocumentPanel,
} from "./toolbox-capability-presentation";

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

type PackageUpdateFeedback =
  | { status: "idle" }
  | { status: "updating"; target: PackageInstallChoice }
  | { status: "updated"; target: PackageInstallChoice }
  | { status: "failed"; target: PackageInstallChoice; errorCode?: string };

type SkillMutationState = "idle" | "updating" | "removing" | "failed" | "removed";
type ExtensionMutationState = "idle" | "updating" | "removing" | "failed" | "removed";
type SkillDocumentMode = "preview" | "source";
function installChoiceKey(choice: PackageInstallChoice): string {
  return choice.scope === "user" ? "user" : `project:${choice.workspaceId}`;
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

function officialPackageUrl(name: string, kind: "catalog" | "npm"): string {
  const encodedName = name.split("/").map(encodeURIComponent).join("/");
  return kind === "catalog"
    ? `https://pi.dev/packages/${encodedName}`
    : `https://www.npmjs.com/package/${encodedName}`;
}

export function ToolboxCapabilityDetails({ params }: { params: ToolboxCapabilitySurfaceParams }) {
  const { number, t } = usePiI18n();
  const fileWorkspaceTargets = usePiFileWorkspaceTargetService();
  const resourceClient = usePiResourceClient();
  const opener = useOpenerService();
  const workspaceContext = useWorkspaceContext();
  const toolboxScope = useToolboxScope();
  const userPackageDir = usePiHostDescription()?.userPackageDir;
  const workspaces = usePiWorkspaces();
  const selectedScopeWorkspace =
    toolboxScope.kind === "project"
      ? workspaces.find((workspace) => workspace.id === toolboxScope.workspaceId)
      : undefined;
  const catalogTarget = useMemo(
    () =>
      params.catalogTarget ??
      (toolboxScope.kind === "user" || selectedScopeWorkspace
        ? toolboxScopeTarget(toolboxScope)
        : undefined),
    [params.catalogTarget, selectedScopeWorkspace, toolboxScope],
  );
  const defaultInstallTarget = useMemo<PackageInstallChoice | null>(
    () =>
      toolboxScope.kind === "user"
        ? { scope: "user" }
        : selectedScopeWorkspace
          ? {
              scope: "project",
              workspaceId: selectedScopeWorkspace.id,
              workspaceName: selectedScopeWorkspace.name,
            }
          : null,
    [selectedScopeWorkspace, toolboxScope.kind],
  );
  const isSkill = params.capabilityKind === "skill";
  const isPrompt = params.capabilityKind === "prompt";
  const isPackage = params.capabilityKind === "package";
  const isExtension = params.capabilityKind === "extension";
  const isInstalledPackage = isPackage && params.installed === true;
  const isCatalogPackage = isPackage && !isInstalledPackage;
  const associatedPackageName = params.packageName;
  const hasPackageOverview =
    Boolean(associatedPackageName) || (isInstalledPackage && Boolean(params.source));
  const showPackageOverview = hasPackageOverview && !isSkill;
  const isPromptPackage = isCatalogPackage && params.packageTypes?.includes("prompt");
  const packageDetails = usePiPackageDetails(
    associatedPackageName ?? "",
    showPackageOverview && !isInstalledPackage,
  );
  const installedPackageDetails = usePiInstalledPackageDetails(
    catalogTarget,
    params.source ?? "",
    isInstalledPackage,
  );
  const installedPackageUpdates = usePiPackageUpdates(
    catalogTarget,
    isInstalledPackage && params.packageUpdateAvailable !== true,
  );
  const skillDetails = usePiSkillDetails(catalogTarget, params.name, isSkill);
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
  const displayedPackageDetails = isInstalledPackage
    ? installedPackageDetails.value
    : officialDetails;
  const Icon =
    isPrompt || isPromptPackage
      ? MessageSquareTextIcon
      : isPackage
        ? PackageIcon
        : isSkill
          ? SparklesIcon
          : BoxesIcon;
  const {
    copy: copyInstallCommandText,
    isCopied: installCommandCopied,
    reset: resetInstallCommandCopy,
    status: installCommandCopyStatus,
  } = useClipboardCopy({ duration: 1_500 });
  const [installFeedback, setInstallFeedback] = useState<PackageInstallFeedback>({
    status: "idle",
  });
  const [selectedInstallTarget, setSelectedInstallTarget] = useState<PackageInstallChoice | null>(
    defaultInstallTarget,
  );
  const [installedTargets, setInstalledTargets] = useState(() => new Set<string>());
  const [terminalLaunchFailed, setTerminalLaunchFailed] = useState(false);
  const [removeFeedback, setRemoveFeedback] = useState<PackageRemoveFeedback>({ status: "idle" });
  const [updateFeedback, setUpdateFeedback] = useState<PackageUpdateFeedback>({ status: "idle" });
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
        : toolboxDirectoryResource(params, catalogTarget),
    [catalogTarget, extensionRemoved, isExtension, isSkill, params, resourceClient, skillRemoved],
  );
  const capabilityUninstalled = installedPackageRemoved;
  const capabilityInactive =
    capabilityUninstalled || (isExtension && (!extensionEnabled || extensionRemoved));
  const activeWorkspaceId =
    params.projectId ??
    (toolboxScope.kind === "project" ? toolboxScope.workspaceId : undefined) ??
    workspaceContext.projectId;
  const skillPackageRemovalTarget =
    params.origin === "package" && params.scope === "user"
      ? { scope: "user" as const }
      : params.origin === "package" && params.scope === "project" && activeWorkspaceId
        ? { scope: "project" as const, workspaceId: activeWorkspaceId }
        : undefined;
  const extensionPackageRemovalTarget =
    params.origin === "package" && params.scope === "user"
      ? { scope: "user" as const }
      : params.origin === "package" && params.scope === "project" && activeWorkspaceId
        ? { scope: "project" as const, workspaceId: activeWorkspaceId }
        : undefined;
  const skillMutationPending =
    skillMutationState === "updating" || skillMutationState === "removing";
  const canToggleSkill =
    isSkill &&
    Boolean(catalogTarget) &&
    !skillRemoved &&
    !skillMutationPending &&
    params.scope !== "temporary" &&
    (params.origin !== "package" || Boolean(params.source));
  const canDeleteSkill =
    isSkill &&
    Boolean(catalogTarget) &&
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
    catalogTarget &&
    params.extensionName &&
    params.filePath &&
    params.source &&
    params.scope &&
    params.origin
      ? {
          target: catalogTarget,
          name: params.extensionName,
          filePath: params.filePath,
          source: params.source,
          scope: params.scope,
          origin: params.origin,
        }
      : undefined;
  const canToggleExtension =
    Boolean(extensionIdentity) &&
    !extensionRemoved &&
    !extensionMutationPending &&
    params.scope !== "temporary";
  const canDeleteExtension =
    Boolean(extensionIdentity) &&
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
    if (!isCatalogPackage) return;
    setSelectedInstallTarget(defaultInstallTarget);
    setInstallFeedback({ status: "idle" });
    setRemoveFeedback({ status: "idle" });
  }, [defaultInstallTarget, isCatalogPackage]);

  useEffect(() => {
    if (!isInstalledPackage) return;
    setUpdateFeedback({ status: "idle" });
    setRemoveFeedback({ status: "idle" });
    setInstalledPackageRemoved(false);
  }, [isInstalledPackage, params.capabilityId, params.packageUpdateAvailable]);

  useEffect(() => {
    if (!directoryResource) return;
    return fileWorkspaceTargets.activate(directoryResource);
  }, [directoryResource, fileWorkspaceTargets]);

  useEffect(() => {
    if (!isCatalogPackage || !catalogTarget) return;
    let active = true;
    const source = `npm:${params.name}`;
    void resourceClient.listInstalledPackages({ target: catalogTarget }).then(
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
  }, [activeWorkspaceId, catalogTarget, isCatalogPackage, params.name]);
  const packageDetailsLoadState = isInstalledPackage
    ? installedPackageDetails.loadState
    : packageDetails.loadState;
  const refreshPackageDetails = isInstalledPackage
    ? installedPackageDetails.refresh
    : packageDetails.refresh;
  const detailsPlaceholder = packageDetailsLoadState === "loading" ? "…" : "—";
  const publishedAt = isInstalledPackage
    ? undefined
    : (params.publishedAt ?? officialDetails?.publishedAt);
  const monthlyDownloads = isInstalledPackage
    ? undefined
    : (officialDetails?.monthlyDownloads ?? params.monthlyDownloads);
  const weeklyDownloads = isInstalledPackage ? undefined : officialDetails?.weeklyDownloads;
  const packageTypes = displayedPackageDetails?.types ?? params.packageTypes ?? [];
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
  const packageSizeBytes = isInstalledPackage ? undefined : officialDetails?.packageSizeBytes;
  const packageSize =
    packageSizeBytes === undefined
      ? undefined
      : packageSizeBytes >= 1_000_000
        ? `${number(packageSizeBytes / 1_000_000, { maximumFractionDigits: 1 })} MB`
        : packageSizeBytes >= 1_000
          ? `${number(packageSizeBytes / 1_000, { maximumFractionDigits: 1 })} KB`
          : `${number(packageSizeBytes)} B`;
  const displayedDescription = isInstalledPackage
    ? installedPackageDetails.value?.description ||
      (installedPackageDetails.loadState === "loading"
        ? "…"
        : t("extensions.toolbox.packages.installedDescriptionUnavailable"))
    : params.description ||
      (isExtension
        ? t("extensions.toolbox.extensions.capabilitySummary", {
            events: params.eventNames?.length ?? 0,
            tools: params.toolNames?.length ?? 0,
            commands: params.commandNames?.length ?? 0,
          })
        : t("extensions.toolbox.details.descriptionUnavailable"));

  const copyInstallCommand = () => {
    if (!selectedInstallCommand) return;
    void copyInstallCommandText(selectedInstallCommand);
  };

  const installPackage = (target: PackageInstallChoice) => {
    if (
      installFeedback.status === "installing" ||
      removeFeedback.status === "removing" ||
      installedTargets.has(installChoiceKey(target))
    ) {
      return;
    }
    const rpcTarget =
      target.scope === "user"
        ? { scope: "user" as const }
        : { scope: "project" as const, workspaceId: target.workspaceId };
    setRemoveFeedback({ status: "idle" });
    setInstallFeedback({ status: "installing", target });
    void resourceClient
      .installPackage({
        name: params.name,
        target: rpcTarget,
      })
      .then(
        () => {
          setInstalledTargets((current) => {
            const next = new Set(current);
            next.add(installChoiceKey(target));
            return next;
          });
          setInstallFeedback({ status: "installed", target });
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
              t("extensions.toolbox.packages.installLocationProjects"),
          }
        : null;
  const installedPackagePresent = isInstalledPackage && !installedPackageRemoved;
  const installationPresent = installedPackagePresent || selectedTargetInstalled;
  const uninstallTarget = isInstalledPackage ? installedPackageTarget : selectedInstallTarget;
  const uninstallSource = params.source ?? (isCatalogPackage ? `npm:${params.name}` : undefined);
  const checkedPackageUpdate = installedPackageUpdates.value.updates.find(
    (update) => update.source === params.source && update.scope === params.packageScope,
  );
  const checkedPackageUpdateAvailable = checkedPackageUpdate !== undefined;
  const packageUpdateAvailable =
    isInstalledPackage &&
    !installedPackageRemoved &&
    (params.packageUpdateAvailable === true || checkedPackageUpdateAvailable) &&
    updateFeedback.status !== "updated";
  const removing = removeFeedback.status === "removing";
  const updating = updateFeedback.status === "updating";
  const mutating = installing || removing || updating;
  const showUninstallRow = installationPresent || removeFeedback.status !== "idle";
  const installTargetLabel = (target: PackageInstallChoice): string =>
    target.scope === "user"
      ? t("extensions.toolbox.packages.installLocationUser")
      : target.workspaceName;
  const updatePackage = () => {
    if (!packageUpdateAvailable || !installedPackageTarget || !params.source || mutating) {
      return;
    }
    const rpcTarget =
      installedPackageTarget.scope === "user"
        ? { scope: "user" as const }
        : {
            scope: "project" as const,
            workspaceId: installedPackageTarget.workspaceId,
          };

    setRemoveFeedback({ status: "idle" });
    setUpdateFeedback({ status: "updating", target: installedPackageTarget });
    void resourceClient.updatePackage({ source: params.source, target: rpcTarget }).then(
      () => {
        setUpdateFeedback({ status: "updated", target: installedPackageTarget });
        refreshPackageDetails();
      },
      (error: unknown) =>
        setUpdateFeedback({
          status: "failed",
          target: installedPackageTarget,
          ...(error instanceof PiApiError ? { errorCode: error.code } : {}),
        }),
    );
  };
  const selectInstallTarget = (target: PackageInstallChoice) => {
    setSelectedInstallTarget(target);
    setInstallFeedback({ status: "idle" });
    setRemoveFeedback({ status: "idle" });
    setTerminalLaunchFailed(false);
    resetInstallCommandCopy();
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
        policy: "force-focus",
      })
      .catch((error: unknown) => {
        console.error(error);
        setTerminalLaunchFailed(true);
      });
  };
  const uninstallPackage = () => {
    if (!installationPresent || !uninstallTarget || !uninstallSource || mutating) {
      return;
    }
    const rpcTarget =
      uninstallTarget.scope === "user"
        ? { scope: "user" as const }
        : { scope: "project" as const, workspaceId: uninstallTarget.workspaceId };

    setRemoveFeedback({ status: "removing", target: uninstallTarget });
    void resourceClient.removePackage({ source: uninstallSource, target: rpcTarget }).then(
      () => {
        setInstalledTargets((current) => {
          const next = new Set(current);
          next.delete(installChoiceKey(uninstallTarget));
          return next;
        });
        if (isInstalledPackage) setInstalledPackageRemoved(true);
        setInstallFeedback({ status: "idle" });
        setUpdateFeedback({ status: "idle" });
        setRemoveFeedback({ status: "removed", target: uninstallTarget });
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
    if (!catalogTarget || !canToggleSkill || enabled === skillEnabled) return;
    setSkillMutationState("updating");
    void resourceClient.setSkillEnabled({ target: catalogTarget, name: params.name, enabled }).then(
      (value) => {
        setSkillEnabled(value.enabled);
        setSkillMutationState("idle");
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
    if (!catalogTarget || !canDeleteSkill) return;
    setSkillMutationState("removing");
    const operation =
      params.origin === "package" && params.source && skillPackageRemovalTarget
        ? resourceClient.removePackage({ source: params.source, target: skillPackageRemovalTarget })
        : resourceClient.removeSkill({ target: catalogTarget, name: params.name });
    void operation.then(
      () => {
        setSkillEnabled(false);
        setSkillRemoved(true);
        setSkillMutationState("removed");
        setSkillDeleteDialogOpen(false);
      },
      () => setSkillMutationState("failed"),
    );
  };
  const updateExtensionEnabled = (enabled: boolean) => {
    if (!extensionIdentity || !canToggleExtension || enabled === extensionEnabled) return;
    setExtensionMutationState("updating");
    void resourceClient.setExtensionEnabled({ ...extensionIdentity, enabled }).then(
      (value) => {
        setExtensionEnabled(value.enabled);
        setExtensionMutationState("idle");
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
        ? resourceClient.removePackage({
            source: params.source,
            target: extensionPackageRemovalTarget,
          })
        : resourceClient.removeExtension(extensionIdentity);
    void operation.then(
      () => {
        setExtensionEnabled(false);
        setExtensionRemoved(true);
        setExtensionMutationState("removed");
        setExtensionDeleteDialogOpen(false);
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
  const updateStatusMessage = (() => {
    if (updateFeedback.status === "idle") return "";
    if (updateFeedback.status === "updating") {
      return t("extensions.toolbox.packages.updatingAt", {
        target: installTargetLabel(updateFeedback.target),
      });
    }
    if (updateFeedback.status === "updated") {
      return updateFeedback.target.scope === "user"
        ? t("extensions.toolbox.packages.updateSuccess")
        : t("extensions.toolbox.packages.updateProjectSuccess", {
            project: updateFeedback.target.workspaceName,
          });
    }
    if (updateFeedback.errorCode === "project-untrusted") {
      return t("extensions.toolbox.packages.updateProjectUntrusted");
    }
    if (updateFeedback.errorCode === "workspace-not-found") {
      return t("extensions.toolbox.packages.updateWorkspaceMissing");
    }
    if (updateFeedback.errorCode === "package-not-installed") {
      return t("extensions.toolbox.packages.updateAlreadyMissing");
    }
    if (updateFeedback.errorCode === "session-not-found") {
      return t("extensions.toolbox.packages.updateSessionMissing");
    }
    if (updateFeedback.errorCode === "session-busy") {
      return t("extensions.toolbox.packages.mutationSessionBusy");
    }
    return t("extensions.toolbox.packages.updateFailed");
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
          {!isSkill && !isExtension && !isPackage ? (
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
                  isExtension || isPackage
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
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <span
                className={
                  capabilityInactive
                    ? "bg-muted text-muted-foreground rounded-full border px-2.5 py-1 text-[11px] font-medium"
                    : packageUpdateAvailable
                      ? "rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300"
                      : "rounded-full border border-emerald-500/15 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300"
                }
              >
                {t(
                  isExtension
                    ? extensionEnabled && !extensionRemoved
                      ? "extensions.toolbox.extensions.loaded"
                      : "extensions.toolbox.extensions.disabled"
                    : isCatalogPackage
                      ? "extensions.toolbox.status.officialCatalog"
                      : isInstalledPackage
                        ? installedPackageRemoved
                          ? "extensions.toolbox.status.uninstalled"
                          : packageUpdateAvailable
                            ? "extensions.toolbox.status.updateAvailable"
                            : "extensions.toolbox.status.installed"
                        : isPrompt
                          ? "extensions.toolbox.status.available"
                          : "extensions.toolbox.status.loaded",
                )}
              </span>
              {isInstalledPackage && packageUpdateAvailable ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={!installedPackageTarget || !params.source || mutating}
                  aria-busy={updating}

                  onClick={updatePackage}
                >
                  {updating ? (
                    <LoaderCircleIcon
                      aria-hidden="true"
                      className="animate-spin motion-reduce:animate-none"
                    />
                  ) : (
                    <RefreshCwIcon aria-hidden="true" />
                  )}
                  {t(
                    updating
                      ? "extensions.toolbox.packages.updating"
                      : "extensions.toolbox.packages.update",
                  )}
                </Button>
              ) : null}
            </div>
          ) : null}
        </header>

        <p className="text-muted-foreground mt-3 shrink-0 text-sm leading-5">
          {displayedDescription}
        </p>

        {isInstalledPackage &&
        (updateFeedback.status !== "idle" ||
          (packageUpdateAvailable && (!installedPackageTarget || !params.source))) ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4" aria-live="polite">
            {updateFeedback.status !== "idle" ? (
              <p
                className={
                  updateFeedback.status === "failed"
                    ? "text-destructive text-xs"
                    : updateFeedback.status === "updated"
                      ? "text-emerald-700 text-xs dark:text-emerald-300"
                      : "text-muted-foreground text-xs"
                }
                role={updateFeedback.status === "failed" ? "alert" : "status"}
              >
                {updateStatusMessage}
              </p>
            ) : null}
            {packageUpdateAvailable && (!installedPackageTarget || !params.source) ? (
              <p className="text-destructive text-xs" role="alert">
                {t("extensions.toolbox.packages.updateTargetUnavailable")}
              </p>
            ) : null}
            {updating ? (
              <Progress
                value={null}
                aria-label={t("extensions.toolbox.packages.updating")}
                aria-valuetext={updateStatusMessage}
                className="basis-full pt-1"
                trackClassName="max-w-md"
              />
            ) : null}
          </div>
        ) : null}

        {isExtension ? (
          <ExtensionControls
            canDelete={canDeleteExtension}
            canOpenDirectory={directoryResource?.scheme === "extension-directory"}
            canToggle={canToggleExtension}
            enabled={extensionEnabled}
            mutationState={extensionMutationState}
            name={params.name}
            openFailed={extensionOpenFailed}
            origin={params.origin}
            removed={extensionRemoved}
            onDelete={() => setExtensionDeleteDialogOpen(true)}
            onOpenDirectory={openExtensionDirectory}
            onToggle={updateExtensionEnabled}
          />
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
          <PackageOverviewPanel
            associatedPackageName={associatedPackageName}
            catalogDetailUrl={catalogDetailUrl}
            checkedPackageUpdate={checkedPackageUpdate}
            details={displayedPackageDetails}
            detailsLoadState={packageDetailsLoadState}
            detailsPlaceholder={detailsPlaceholder}
            isExtension={isExtension}
            isInstalledPackage={isInstalledPackage}
            monthlyDownloads={monthlyDownloads}
            npmUrl={npmUrl}
            packageSize={packageSize}
            packageTypes={packageTypes}
            packageUpdateAvailable={packageUpdateAvailable}
            params={params}
            publishedAt={publishedAt}
            refreshDetails={refreshPackageDetails}
            showPackageOverview={showPackageOverview}
            weeklyDownloads={weeklyDownloads}
          />
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

        {isExtension ? <ExtensionCapabilityDetailsPanel params={params} /> : null}

        {isSkill ? (
          <SkillDocumentPanel
            canDelete={canDeleteSkill}
            canOpenDirectory={directoryResource?.scheme === "skill-directory"}
            canToggle={canToggleSkill}
            content={skillDetails.value?.content}
            documentMode={skillDocumentMode}
            enabled={skillEnabled}
            loadState={skillDetails.loadState}
            mutationState={skillMutationState}
            name={params.name}
            removed={skillRemoved}
            scopeAvailable={Boolean(catalogTarget)}
            onDelete={() => setSkillDeleteDialogOpen(true)}
            onDocumentModeChange={setSkillDocumentMode}
            onOpenDirectory={openSkillDirectory}
            onRefresh={skillDetails.refresh}
            onToggle={updateSkillEnabled}
          />
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
                    className: "min-w-44 justify-between",
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
                    disabled={!selectedInstallTarget || mutating || selectedTargetInstalled}

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
                    className="shrink-0"
                    onClick={copyInstallCommand}
                  >
                    {installCommandCopied ? (
                      <CheckIcon aria-hidden="true" />
                    ) : installCommandCopyStatus === "failed" ? (
                      <CircleXIcon aria-hidden="true" className="text-destructive" />
                    ) : (
                      <ClipboardIcon aria-hidden="true" />
                    )}
                    {t(
                      installCommandCopyStatus === "copied"
                        ? "extensions.toolbox.packages.copied"
                        : installCommandCopyStatus === "failed"
                          ? "extensions.toolbox.packages.copyFailed"
                          : "extensions.toolbox.packages.copyCommand",
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {showUninstallRow ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4" aria-live="polite">
            {installationPresent ? (
              <Button
                type="button"
                variant="destructive"
                disabled={!uninstallTarget || !uninstallSource || mutating}

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
