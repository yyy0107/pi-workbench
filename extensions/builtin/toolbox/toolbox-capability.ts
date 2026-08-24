import type {
  ExtensionView,
  InstalledPackageView,
  PiPackageCatalogItemView,
  PromptCommandView,
  SkillView,
} from "@/runtime/pi/rpc-contracts";

export type ToolboxCapabilityKind = "skill" | "extension" | "prompt" | "package";
export type ToolboxMainSection = "skills" | "extensions" | "prompts" | "packages";

export interface ToolboxCapabilitySurfaceParams extends Record<string, unknown> {
  capabilityId: string;
  capabilityKind: ToolboxCapabilityKind;
  name: string;
  description?: string;
  whenToUse?: string;
  modelInvocable?: boolean;
  invocationName?: string;
  argumentHint?: string;
  source?: string;
  scope?: ExtensionView["scope"];
  origin?: ExtensionView["origin"];
  eventNames?: string[];
  toolNames?: string[];
  commandNames?: string[];
  packageTypes?: PiPackageCatalogItemView["types"];
  author?: string;
  monthlyDownloads?: number;
  publishedAt?: number;
  catalogUrl?: string;
  npmUrl?: string;
  repositoryUrl?: string;
  version?: string;
  installCommand?: string;
  installed?: boolean;
  packageScope?: InstalledPackageView["scope"];
  packageFiltered?: boolean;
}

export interface ToolboxMainViewParams extends Record<string, unknown> {
  section: ToolboxMainSection;
  detailOnly?: boolean;
  query?: string;
  selected?: ToolboxCapabilitySurfaceParams;
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

export function skillSurfaceParams(skill: SkillView): ToolboxCapabilitySurfaceParams {
  return {
    capabilityId: skillCapabilityId(skill),
    capabilityKind: "skill",
    name: skill.name,
    description: skill.description,
    ...(skill.whenToUse ? { whenToUse: skill.whenToUse } : {}),
    modelInvocable: skill.modelInvocable,
  };
}

export function extensionSurfaceParams(extension: ExtensionView): ToolboxCapabilitySurfaceParams {
  return {
    capabilityId: extensionCapabilityId(extension),
    capabilityKind: "extension",
    name: extension.name,
    source: extension.source,
    scope: extension.scope,
    origin: extension.origin,
    eventNames: [...extension.eventNames],
    toolNames: [...extension.toolNames],
    commandNames: [...extension.commandNames],
  };
}

export function promptSurfaceParams(prompt: PromptCommandView): ToolboxCapabilitySurfaceParams {
  return {
    capabilityId: promptCapabilityId(prompt),
    capabilityKind: "prompt",
    name: prompt.name,
    ...(prompt.description ? { description: prompt.description } : {}),
    invocationName: prompt.invocationName,
    ...(prompt.argumentHint ? { argumentHint: prompt.argumentHint } : {}),
  };
}

export function installedPackageSurfaceParams(
  item: InstalledPackageView,
): ToolboxCapabilitySurfaceParams {
  return {
    capabilityId: installedPackageCapabilityId(item),
    capabilityKind: "package",
    name: item.source,
    source: item.source,
    installed: true,
    packageScope: item.scope,
    packageFiltered: item.filtered,
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
  };
}
