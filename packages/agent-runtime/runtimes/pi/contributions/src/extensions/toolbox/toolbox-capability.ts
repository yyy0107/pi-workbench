import {
  BUILTIN_TOOL_PREFERENCE_KEYS,
  BUILTIN_EXTENSION_PREFERENCE_KEYS,
} from "@workbench/agent-runtime-contracts/settings";

import type {
  BuiltinExtensionView,
  ExtensionRegisteredCommandView,
  ExtensionRegisteredEventView,
  ExtensionRegisteredToolView,
  ExtensionView,
  InstalledPackageView,
  PiResourceCatalogTarget,
  PiPackageCatalogItemView,
  PromptCommandView,
  PromptTemplateView,
  SkillView,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import type { OpenableResource } from "@workbench/extension-sdk";

export type ToolboxCapabilityKind = "skill" | "extension" | "prompt" | "package";
export type ToolboxMainSection =
  | "skills"
  | "extensions"
  | "prompts"
  | "installed"
  | "packages"
  | "updates";

export interface ToolboxCapabilitySurfaceParams extends Record<string, unknown> {
  capabilityId: string;
  capabilityKind: ToolboxCapabilityKind;
  name: string;
  description?: string;
  whenToUse?: string;
  modelInvocable?: boolean;
  enabled?: boolean;
  builtin?: boolean;
  provenance?: BuiltinExtensionView["provenance"];
  invocationName?: string;
  argumentHint?: string;
  promptId?: string;
  editable?: boolean;
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
  packageUpdateAvailable?: boolean;
  currentVersion?: string;
  targetVersion?: string;
  currentRevision?: string;
  targetRevision?: string;
  packageScope?: InstalledPackageView["scope"];
  packageFiltered?: boolean;
  catalogTarget?: PiResourceCatalogTarget;
  projectId?: string;
  projectName?: string;
  projectPath?: string;
}

export function bindCapabilityToCatalogTarget(
  params: ToolboxCapabilitySurfaceParams,
  scope: ExtensionView["scope"] | InstalledPackageView["scope"],
  target: PiResourceCatalogTarget,
  project?: { id: string; name: string; path: string },
): ToolboxCapabilitySurfaceParams {
  const scopedProject = scope === "project" ? project : undefined;
  return {
    ...params,
    capabilityId: scopedProject
      ? `${params.capabilityId}:project:${encodeURIComponent(scopedProject.id)}`
      : params.capabilityId,
    catalogTarget: target,
    ...(scopedProject
      ? {
          projectId: scopedProject.id,
          projectName: scopedProject.name,
          projectPath: scopedProject.path,
        }
      : {}),
  };
}

export interface ToolboxMainViewParams extends Record<string, unknown> {
  section: ToolboxMainSection;
  detailOnly?: boolean;
  query?: string;
  selected?: ToolboxCapabilitySurfaceParams;
}

export function toolboxDirectoryResource(
  params: ToolboxCapabilitySurfaceParams,
  target: PiResourceCatalogTarget | undefined,
): OpenableResource | undefined {
  if (!target || (params.builtin && params.capabilityKind !== "skill")) return undefined;

  if (params.capabilityKind === "skill") {
    return {
      scheme: "skill-directory",
      path: params.name,
      label: params.name,
      metadata: {
        resourceTarget: target,
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
      resourceTarget: target,
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
    ...(skill.source === "builtin" ? { builtin: true } : {}),
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

export function builtinExtensionSurfaceParams(
  extension: BuiltinExtensionView,
): ToolboxCapabilitySurfaceParams {
  return {
    ...extension,
    ...(extension.name.startsWith("workbench.tool.") && extension.toolNames.length === 1
      ? { name: extension.toolNames[0], extensionName: extension.name }
      : {}),
    capabilityId: `builtin-extension:${encodeURIComponent(extension.name)}`,
    capabilityKind: "extension",
    builtin: true,
  };
}

export function promptSurfaceParams(
  prompt: PromptCommandView | PromptTemplateView,
): ToolboxCapabilitySurfaceParams {
  const packageName = npmPackageNameFromSource(prompt.source);
  return {
    capabilityId: "id" in prompt ? `prompt:${prompt.id}` : promptCapabilityId(prompt),
    ...("id" in prompt
      ? { promptId: prompt.id, enabled: prompt.enabled, editable: prompt.editable }
      : {}),
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

/** Built-in extensions use the same global switches as Workbench settings. */
export function builtinToolPreferenceKey(params: ToolboxCapabilitySurfaceParams) {
  if (!params.builtin || params.capabilityKind !== "extension") return undefined;
  for (const [name, key] of Object.entries(BUILTIN_EXTENSION_PREFERENCE_KEYS)) {
    if (params.name === name) return key;
  }
  for (const [name, key] of Object.entries(BUILTIN_TOOL_PREFERENCE_KEYS)) {
    if (
      (params.extensionName ?? params.name) === `workbench.tool.${name}` &&
      params.toolNames?.includes(name)
    )
      return key;
  }
  if (params.name === "workbench.ask-user" && params.toolNames?.includes("ask_user"))
    return "askUserEnabled" as const;
  if (params.name === "workbench.rpiv-todo" && params.toolNames?.includes("todo"))
    return "todoEnabled" as const;
  return undefined;
}
