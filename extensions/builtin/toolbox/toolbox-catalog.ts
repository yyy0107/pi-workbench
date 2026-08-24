"use client";

import { useEffect, useMemo } from "react";

import { useI18n } from "@/i18n";
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
  readonly kind: "skill" | "extension" | "prompt" | "package";
  readonly name: string;
  readonly secondary: string;
  readonly status: string;
  readonly searchText: string;
  readonly params: ToolboxCapabilitySurfaceParams;
}

const EMPTY_SKILLS: readonly SkillView[] = [];
const EMPTY_EXTENSIONS: PiExtensionsCatalog = { extensions: [], loadErrorCount: 0 };
const EMPTY_PROMPTS: readonly PromptCommandView[] = [];
const EMPTY_PACKAGES: readonly InstalledPackageView[] = [];
const packageChangeListeners = new Set<() => void>();

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
  const { t } = useI18n();
  const skillsCatalog = usePiSessionCatalog(loadSkills, EMPTY_SKILLS);
  const extensionsCatalog = usePiSessionCatalog(loadExtensions, EMPTY_EXTENSIONS);
  const promptsCatalog = usePiSessionCatalog(loadPrompts, EMPTY_PROMPTS);
  const packagesCatalog = usePiSessionCatalog(loadPackages, EMPTY_PACKAGES);

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
        secondary: `${t("extensions.toolbox.currentSession")} · ${t(
          skill.modelInvocable
            ? "extensions.toolbox.status.modelInvocable"
            : "extensions.toolbox.status.manualOnly",
        )}`,
        status: t("extensions.toolbox.status.available"),
        searchText: `${skill.name} ${skill.description} ${skill.whenToUse ?? ""}`,
        params: skillSurfaceParams(skill),
      })),
    [skillsCatalog.value, t],
  );
  const extensionItems = useMemo<readonly ToolboxCapabilityItem[]>(
    () =>
      extensionsCatalog.value.extensions.map((extension) => ({
        id: extensionCapabilityId(extension),
        kind: "extension",
        name: extension.name,
        secondary: `${extension.source} · ${t(`extensions.toolbox.scopes.${extension.scope}`)}`,
        status: t("extensions.toolbox.status.loaded"),
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
    [extensionsCatalog.value.extensions, t],
  );
  const promptItems = useMemo<readonly ToolboxCapabilityItem[]>(
    () =>
      promptsCatalog.value.map((prompt) => ({
        id: promptCapabilityId(prompt),
        kind: "prompt",
        name: prompt.name,
        secondary: `${t("extensions.toolbox.currentSession")} · /${prompt.invocationName}`,
        status: t("extensions.toolbox.status.available"),
        searchText: [
          prompt.name,
          prompt.invocationName,
          prompt.description ?? "",
          prompt.argumentHint ?? "",
        ].join(" "),
        params: promptSurfaceParams(prompt),
      })),
    [promptsCatalog.value, t],
  );
  const packageItems = useMemo<readonly ToolboxCapabilityItem[]>(
    () =>
      packagesCatalog.value.map((item) => ({
        id: installedPackageCapabilityId(item),
        kind: "package",
        name: item.source,
        secondary: `${t(`extensions.toolbox.scopes.${item.scope}`)} · ${t(
          item.filtered
            ? "extensions.toolbox.packages.filteredResources"
            : "extensions.toolbox.packages.allResources",
        )}`,
        status: t("extensions.toolbox.status.installed"),
        searchText: `${item.source} ${item.scope}`,
        params: installedPackageSurfaceParams(item),
      })),
    [packagesCatalog.value, t],
  );

  return {
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
