"use client";

import { useEffect, useMemo } from "react";

import { useInstallableComponentExtensions } from "@/extensions/component-extension-installation";
import { useI18n } from "@/i18n";
import { useWorkbenchExtensions } from "@/platform/extensions";
import { usePiSessionCatalog } from "@/runtime/pi/client/runtime/session-catalog";
import {
  listInstalledPiPackages,
  listPiCommands,
  listPiExtensions,
  listPiSkills,
} from "@/runtime/pi/client/transport/api";
import type {
  ExtensionView,
  InstalledPackageView,
  PromptCommandView,
  SkillView,
} from "@/runtime/pi/rpc-contracts";

import {
  componentExtensionCapabilityId,
  extensionCapabilityId,
  extensionSurfaceParams,
  installedPackageCapabilityId,
  installedPackageSurfaceParams,
  promptCapabilityId,
  promptSurfaceParams,
  skillCapabilityId,
  skillSurfaceParams,
  type ToolboxCapabilitySurfaceParams,
} from "./toolbox-capability";

export interface PiExtensionsCatalog {
  readonly extensions: readonly ExtensionView[];
  readonly loadErrorCount: number;
}

export interface ToolboxCapabilityItem {
  readonly id: string;
  readonly kind: "skill" | "component-extension" | "extension" | "prompt" | "package";
  readonly name: string;
  readonly description?: string;
  readonly status?: string;
  readonly searchText: string;
  readonly params: ToolboxCapabilitySurfaceParams;
}

const EMPTY_SKILLS: readonly SkillView[] = [];
const EMPTY_EXTENSIONS: PiExtensionsCatalog = { extensions: [], loadErrorCount: 0 };
const EMPTY_PROMPTS: readonly PromptCommandView[] = [];
const EMPTY_PACKAGES: readonly InstalledPackageView[] = [];
const skillChangeListeners = new Set<() => void>();
const packageChangeListeners = new Set<() => void>();

export function notifyToolboxSkillsChanged(): void {
  for (const listener of skillChangeListeners) listener();
}

export function notifyToolboxPackagesChanged(): void {
  for (const listener of packageChangeListeners) listener();
}

async function loadSkills(sessionId: string): Promise<readonly SkillView[]> {
  return (await listPiSkills({ sessionId })).skills;
}

async function loadExtensions(sessionId: string): Promise<PiExtensionsCatalog> {
  return listPiExtensions({ sessionId });
}

async function loadPrompts(sessionId: string): Promise<readonly PromptCommandView[]> {
  return (await listPiCommands({ sessionId })).commands.filter(
    (command): command is PromptCommandView => command.kind === "prompt",
  );
}

async function loadPackages(sessionId: string): Promise<readonly InstalledPackageView[]> {
  return (await listInstalledPiPackages({ sessionId })).packages;
}

export function useToolboxSessionCatalogs() {
  const { t, text } = useI18n();
  const workbenchExtensions = useWorkbenchExtensions();
  const installableComponentExtensions = useInstallableComponentExtensions();
  const skillsCatalog = usePiSessionCatalog(loadSkills, EMPTY_SKILLS);
  const extensionsCatalog = usePiSessionCatalog(loadExtensions, EMPTY_EXTENSIONS);
  const promptsCatalog = usePiSessionCatalog(loadPrompts, EMPTY_PROMPTS);
  const packagesCatalog = usePiSessionCatalog(loadPackages, EMPTY_PACKAGES);

  useEffect(() => {
    const refresh = skillsCatalog.refresh;
    skillChangeListeners.add(refresh);
    return () => {
      skillChangeListeners.delete(refresh);
    };
  }, [skillsCatalog.refresh]);

  useEffect(() => {
    const refresh = packagesCatalog.refresh;
    packageChangeListeners.add(refresh);
    return () => {
      packageChangeListeners.delete(refresh);
    };
  }, [packagesCatalog.refresh]);
  const skillItems = useMemo<readonly ToolboxCapabilityItem[]>(
    () =>
      skillsCatalog.value.map((skill) => ({
        id: skillCapabilityId(skill),
        kind: "skill",
        name: skill.name,
        description: skill.description,
        searchText: `${skill.name} ${skill.description} ${skill.whenToUse ?? ""}`,
        params: skillSurfaceParams(skill),
      })),
    [skillsCatalog.value],
  );
  const componentExtensionItems = useMemo<readonly ToolboxCapabilityItem[]>(() => {
    const installableIds = new Set(
      installableComponentExtensions.map(({ extension }) => extension.id),
    );
    const catalog = [
      ...installableComponentExtensions,
      ...workbenchExtensions
        .filter(
          (extension) =>
            extension.toolbox?.kind === "component-extension" && !installableIds.has(extension.id),
        )
        .map((extension) => ({ extension, installed: true })),
    ];

    return catalog.flatMap(({ extension, installed }) => {
      if (extension.toolbox?.kind !== "component-extension") return [];
      const name = text(extension.toolbox.name);
      const description = extension.toolbox.description
        ? text(extension.toolbox.description)
        : undefined;
      const contributions = extension.toolbox.contributions.map((contribution) => {
        const contributionDescription = contribution.description
          ? text(contribution.description)
          : undefined;
        return {
          id: contribution.id,
          kind: contribution.kind,
          surface: text(contribution.surface),
          target: contribution.target,
          ...(contribution.host ? { host: contribution.host } : {}),
          ...(contributionDescription ? { description: contributionDescription } : {}),
          preview: contribution.preview,
          sourceFiles: [...contribution.sourceFiles],
        };
      });
      const id = componentExtensionCapabilityId(extension.id);

      return [
        {
          id,
          kind: "component-extension" as const,
          name,
          ...(description ? { description } : {}),
          status: t(
            extension.toolbox.distribution === "installable"
              ? installed
                ? "extensions.toolbox.status.installed"
                : "extensions.toolbox.status.uninstalled"
              : "extensions.toolbox.status.loaded",
          ),
          searchText: [
            name,
            description ?? "",
            extension.id,
            extension.version,
            extension.toolbox.entryFile,
            ...contributions.flatMap((contribution) => [
              contribution.kind,
              contribution.id,
              contribution.surface,
              contribution.target,
              contribution.host ?? "",
              contribution.description ?? "",
              ...contribution.sourceFiles,
            ]),
          ].join(" "),
          params: {
            capabilityId: id,
            capabilityKind: "component-extension" as const,
            name,
            ...(description ? { description } : {}),
            source: extension.id,
            version: extension.version,
            entryFile: extension.toolbox.entryFile,
            componentExtensionId: extension.id,
            componentExtensionDistribution: extension.toolbox.distribution,
            installed,
            eventNames: [],
            toolNames: [],
            commandNames: [],
            componentContributions: contributions,
          },
        },
      ];
    });
  }, [installableComponentExtensions, t, text, workbenchExtensions]);
  const extensionItems = useMemo<readonly ToolboxCapabilityItem[]>(
    () =>
      extensionsCatalog.value.extensions.map((extension) => ({
        id: extensionCapabilityId(extension),
        kind: "extension",
        name: extension.name,
        searchText: [
          extension.name,
          extension.source,
          extension.scope,
          extension.origin,
          ...extension.eventNames,
          ...extension.toolNames,
          ...extension.commandNames,
        ].join(" "),
        params: extensionSurfaceParams(extension),
      })),
    [extensionsCatalog.value.extensions],
  );
  const promptItems = useMemo<readonly ToolboxCapabilityItem[]>(
    () =>
      promptsCatalog.value.map((prompt) => ({
        id: promptCapabilityId(prompt),
        kind: "prompt",
        name: prompt.name,
        ...(prompt.description ? { description: prompt.description } : {}),
        searchText: [
          prompt.name,
          prompt.invocationName,
          prompt.description ?? "",
          prompt.argumentHint ?? "",
        ].join(" "),
        params: promptSurfaceParams(prompt),
      })),
    [promptsCatalog.value],
  );
  const packageItems = useMemo<readonly ToolboxCapabilityItem[]>(
    () =>
      packagesCatalog.value.map((item) => ({
        id: installedPackageCapabilityId(item),
        kind: "package",
        name: item.source,
        searchText: `${item.source} ${item.scope}`,
        params: installedPackageSurfaceParams(item),
      })),
    [packagesCatalog.value],
  );

  return {
    componentExtensionItems,
    extensionItems,
    extensionsCatalog,
    packageItems,
    packagesCatalog,
    promptItems,
    promptsCatalog,
    skillItems,
    skillsCatalog,
  } as const;
}
