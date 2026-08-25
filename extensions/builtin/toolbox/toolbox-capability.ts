import type {
  ExtensionRegisteredCommandView,
  ExtensionRegisteredEventView,
  ExtensionRegisteredToolView,
  ExtensionView,
  InstalledPackageView,
  PiPackageCatalogItemView,
  PromptCommandView,
  SkillView,
} from "@/runtime/pi/rpc-contracts";
import type { PiResourceCatalogTarget } from "@/runtime/pi/client/runtime/manager";
import type { ComponentType } from "react";
import type { ComponentExtensionContributionKind, OpenableResource } from "@/platform/extensions";

export interface ToolboxComponentContribution {
  id: string;
  kind: ComponentExtensionContributionKind;
  surface: string;
  target: string;
  host?: string;
  description?: string;
  preview: ComponentType;
  sourceFiles: readonly string[];
}

export type ToolboxCapabilityKind =
  | "skill"
  | "component-extension"
  | "extension"
  | "prompt"
  | "package";
export type ToolboxMainSection =
  | "skills"
  | "component-extensions"
  | "extensions"
  | "prompts"
  | "packages";

export interface ToolboxCapabilitySurfaceParams extends Record<string, unknown> {
  capabilityId: string;
  capabilityKind: ToolboxCapabilityKind;
  name: string;
  description?: string;
  whenToUse?: string;
  modelInvocable?: boolean;
  enabled?: boolean;
  invocationName?: string;
  argumentHint?: string;
  source?: string;
  filePath?: string;
  extensionName?: string;
  scope?: ExtensionView["scope"];
  origin?: ExtensionView["origin"];
  eventNames?: string[];
  toolNames?: string[];
  commandNames?: string[];
  eventDetails?: ExtensionRegisteredEventView[];
  toolDetails?: ExtensionRegisteredToolView[];
  commandDetails?: ExtensionRegisteredCommandView[];
  entryFile?: string;
  componentExtensionId?: string;
  componentExtensionDistribution?: "builtin" | "installable";
  componentContributions?: ToolboxComponentContribution[];
  packageTypes?: PiPackageCatalogItemView["types"];
  author?: string;
  monthlyDownloads?: number;
  publishedAt?: number;
  catalogUrl?: string;
  npmUrl?: string;
  repositoryUrl?: string;
  version?: string;
  installCommand?: string;
  packageName?: string;
  installed?: boolean;
  packageScope?: InstalledPackageView["scope"];
  packageFiltered?: boolean;
  catalogSessionId?: string;
  projectId?: string;
  projectName?: string;
  projectPath?: string;
}

export function bindCapabilityToCatalogTarget(
  params: ToolboxCapabilitySurfaceParams,
  scope: ExtensionView["scope"] | InstalledPackageView["scope"],
  target: PiResourceCatalogTarget,
): ToolboxCapabilitySurfaceParams {
  const project = scope === "project" ? target.project : undefined;
  return {
    ...params,
    capabilityId: project
      ? `${params.capabilityId}:project:${encodeURIComponent(project.id)}`
      : params.capabilityId,
    catalogSessionId: target.sessionId,
    ...(project
      ? {
          projectId: project.id,
          projectName: project.name,
          projectPath: project.path,
        }
      : {}),
  };
}

export function componentExtensionCapabilityId(extensionId: string): string {
  return `component-extension:${encodeURIComponent(extensionId)}`;
}

export interface ToolboxMainViewParams extends Record<string, unknown> {
  section: ToolboxMainSection;
  detailOnly?: boolean;
  query?: string;
  selected?: ToolboxCapabilitySurfaceParams;
}

export function toolboxDirectoryResource(
  params: ToolboxCapabilitySurfaceParams,
  sessionId: string | undefined,
): OpenableResource | undefined {
  if (!sessionId) return undefined;

  if (params.capabilityKind === "skill") {
    return {
      scheme: "skill-directory",
      path: params.name,
      label: params.name,
      metadata: {
        sessionId,
        skillName: params.name,
      },
    };
  }

  if (
    params.capabilityKind !== "extension" ||
    !params.extensionName ||
    !params.filePath ||
    !params.source ||
    !params.scope ||
    !params.origin
  ) {
    return undefined;
  }

  return {
    scheme: "extension-directory",
    path: params.filePath,
    label: params.extensionName,
    metadata: {
      sessionId,
      extensionName: params.extensionName,
      extensionFilePath: params.filePath,
      extensionSource: params.source,
      extensionScope: params.scope,
      extensionOrigin: params.origin,
    },
  };
}

export function sectionForCapability(
  capability: ToolboxCapabilitySurfaceParams,
): ToolboxMainSection {
  return capability.capabilityKind === "skill"
    ? "skills"
    : capability.capabilityKind === "component-extension"
      ? "component-extensions"
      : capability.capabilityKind === "extension"
        ? "extensions"
        : capability.capabilityKind === "prompt"
          ? "prompts"
          : capability.packageTypes?.includes("prompt")
            ? "prompts"
            : "packages";
}

export function skillCapabilityId(skill: Pick<SkillView, "name">): string {
  return `skill:${encodeURIComponent(skill.name)}`;
}

export function extensionCapabilityId(
  extension: Pick<ExtensionView, "name" | "origin" | "scope" | "source">,
): string {
  return [
    "extension",
    extension.scope,
    extension.origin,
    encodeURIComponent(extension.source),
    encodeURIComponent(extension.name),
  ].join(":");
}

export function promptCapabilityId(
  prompt: Pick<PromptCommandView, "invocationName" | "name">,
): string {
  return `prompt:${encodeURIComponent(prompt.invocationName)}:${encodeURIComponent(prompt.name)}`;
}

export function installedPackageCapabilityId(
  item: Pick<InstalledPackageView, "scope" | "source">,
): string {
  return `installed-package:${item.scope}:${encodeURIComponent(item.source)}`;
}

const NPM_PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;

export function npmPackageNameFromSource(source?: string): string | undefined {
  if (!source?.startsWith("npm:")) return undefined;
  const name = source.slice("npm:".length).trim();
  return NPM_PACKAGE_NAME.test(name) ? name : undefined;
}

export function skillSurfaceParams(skill: SkillView): ToolboxCapabilitySurfaceParams {
  const packageName = npmPackageNameFromSource(skill.source);
  return {
    capabilityId: skillCapabilityId(skill),
    capabilityKind: "skill",
    name: skill.name,
    description: skill.description,
    ...(skill.whenToUse ? { whenToUse: skill.whenToUse } : {}),
    enabled: skill.enabled,
    modelInvocable: skill.modelInvocable,
    source: skill.source,
    scope: skill.scope,
    origin: skill.origin,
    packageTypes: ["skill"],
    ...(packageName ? { packageName } : {}),
  };
}

export function extensionSurfaceParams(extension: ExtensionView): ToolboxCapabilitySurfaceParams {
  const packageName = npmPackageNameFromSource(extension.source);
  return {
    capabilityId: extensionCapabilityId(extension),
    capabilityKind: "extension",
    name: packageName ?? extension.name,
    extensionName: extension.name,
    enabled: extension.enabled,
    filePath: extension.filePath,
    source: extension.source,
    scope: extension.scope,
    origin: extension.origin,
    eventNames: [...extension.eventNames],
    toolNames: [...extension.toolNames],
    commandNames: [...extension.commandNames],
    eventDetails: (extension.eventDetails ?? []).map((detail) => ({ ...detail })),
    toolDetails: (extension.toolDetails ?? []).map((detail) => ({ ...detail })),
    commandDetails: (extension.commandDetails ?? []).map((detail) => ({ ...detail })),
    packageTypes: ["extension"],
    ...(packageName ? { packageName } : {}),
  };
}

export function promptSurfaceParams(prompt: PromptCommandView): ToolboxCapabilitySurfaceParams {
  const packageName = npmPackageNameFromSource(prompt.source);
  return {
    capabilityId: promptCapabilityId(prompt),
    capabilityKind: "prompt",
    name: prompt.name,
    ...(prompt.description ? { description: prompt.description } : {}),
    invocationName: prompt.invocationName,
    ...(prompt.argumentHint ? { argumentHint: prompt.argumentHint } : {}),
    source: prompt.source,
    scope: prompt.scope,
    origin: prompt.origin,
    packageTypes: ["prompt"],
    ...(packageName ? { packageName } : {}),
  };
}

export function installedPackageSurfaceParams(
  item: InstalledPackageView,
): ToolboxCapabilitySurfaceParams {
  const packageName = npmPackageNameFromSource(item.source);
  return {
    capabilityId: installedPackageCapabilityId(item),
    capabilityKind: "package",
    name: item.source,
    source: item.source,
    installed: true,
    packageScope: item.scope,
    packageFiltered: item.filtered,
    ...(packageName ? { packageName } : {}),
  };
}

export function packageSurfaceParams(
  item: PiPackageCatalogItemView,
): ToolboxCapabilitySurfaceParams {
  return {
    capabilityId: `package:${encodeURIComponent(item.name)}`,
    capabilityKind: "package",
    name: item.name,
    description: item.description,
    packageTypes: [...item.types],
    author: item.author,
    monthlyDownloads: item.monthlyDownloads,
    publishedAt: item.publishedAt,
    catalogUrl: item.catalogUrl,
    npmUrl: item.npmUrl,
    ...(item.repositoryUrl ? { repositoryUrl: item.repositoryUrl } : {}),
    ...(item.version ? { version: item.version } : {}),
    installCommand: item.installCommand,
    packageName: item.name,
  };
}
