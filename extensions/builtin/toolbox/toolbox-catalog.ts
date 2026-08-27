"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { useI18n } from "@/i18n";
import { usePiWorkspaces } from "@/runtime/pi/client/runtime/context";
import {
  getPiResourceCatalogRevision,
  invalidatePiResourceCatalog,
  subscribePiResourceCatalog,
} from "@/runtime/pi/client/runtime/resource-catalog-revision";
import {
  listInstalledPiPackages,
  listPiExtensions,
  listPiPrompts,
  listPiSkills,
} from "@/runtime/pi/client/transport/api";
import type {
  ExtensionView,
  InstalledPackageView,
  PiResourceCatalogTarget,
  PromptCommandView,
  SkillView,
  WorkbenchToolboxScopePreference,
} from "@/runtime/pi/contracts/rpc";

import {
  bindCapabilityToCatalogTarget,
  extensionSurfaceParams,
  installedPackageSurfaceParams,
  promptSurfaceParams,
  skillSurfaceParams,
  type ToolboxCapabilitySurfaceParams,
} from "./toolbox-capability";
import { toolboxScopeMatchesResource, toolboxScopeTarget } from "./toolbox-scope";

export interface PiExtensionsCatalog {
  readonly extensions: readonly ExtensionView[];
  readonly loadErrorCount: number;
}

interface ToolboxProject {
  readonly id: string;
  readonly name: string;
  readonly path: string;
}

interface ToolboxCatalogTarget {
  readonly resource: PiResourceCatalogTarget;
  readonly project?: ToolboxProject;
}

export interface ToolboxCapabilityItem {
  readonly id: string;
  readonly kind: "skill" | "component-extension" | "extension" | "prompt" | "package";
  readonly name: string;
  readonly description?: string;
  readonly status?: string;
  readonly project?: ToolboxProject;
  readonly searchText: string;
  readonly params: ToolboxCapabilitySurfaceParams;
}

type ToolboxCatalogLoadState = "idle" | "loading" | "ready" | "failed";

interface ToolboxCatalogEntry<T> {
  readonly target: ToolboxCatalogTarget;
  readonly value: T;
}

interface ToolboxCatalog<T> {
  readonly entries: readonly ToolboxCatalogEntry<T>[];
  readonly hasTargets: boolean;
  readonly loadState: ToolboxCatalogLoadState;
  readonly refresh: () => void;
}

interface ToolboxCatalogState<T> {
  readonly entries: readonly ToolboxCatalogEntry<T>[];
  readonly loadState: ToolboxCatalogLoadState;
}

export function notifyToolboxSkillsChanged(): void {
  invalidatePiResourceCatalog();
}

export function notifyToolboxExtensionsChanged(): void {
  invalidatePiResourceCatalog();
}

export function notifyToolboxPackagesChanged(): void {
  invalidatePiResourceCatalog();
}

async function loadSkills(target: PiResourceCatalogTarget): Promise<readonly SkillView[]> {
  return (await listPiSkills({ target })).skills;
}

async function loadExtensions(target: PiResourceCatalogTarget): Promise<PiExtensionsCatalog> {
  return listPiExtensions({ target });
}

async function loadPrompts(target: PiResourceCatalogTarget): Promise<readonly PromptCommandView[]> {
  return (await listPiPrompts({ target })).prompts;
}

async function loadPackages(
  target: PiResourceCatalogTarget,
): Promise<readonly InstalledPackageView[]> {
  return (await listInstalledPiPackages({ target })).packages;
}

function useToolboxCatalog<T>(
  target: ToolboxCatalogTarget | undefined,
  loader: (target: PiResourceCatalogTarget) => Promise<T>,
): ToolboxCatalog<T> {
  const [reloadRevision, setReloadRevision] = useState(0);
  const resourceCatalogRevision = useSyncExternalStore(
    subscribePiResourceCatalog,
    getPiResourceCatalogRevision,
    () => 0,
  );
  const [state, setState] = useState<ToolboxCatalogState<T>>({
    entries: [],
    loadState: "idle",
  });
  const requestGeneration = useRef(0);
  const refresh = useCallback(() => setReloadRevision((revision) => revision + 1), []);

  useEffect(() => {
    const requestId = ++requestGeneration.current;
    if (!target) {
      setState({ entries: [], loadState: "idle" });
      return;
    }

    setState({ entries: [], loadState: "loading" });
    void loader(target.resource).then(
      (value) => {
        if (requestGeneration.current !== requestId) return;
        setState({ entries: [{ target, value }], loadState: "ready" });
      },
      () => {
        if (requestGeneration.current !== requestId) return;
        setState({ entries: [], loadState: "failed" });
      },
    );

    return () => {
      requestGeneration.current += 1;
    };
  }, [loader, reloadRevision, resourceCatalogRevision, target]);

  return {
    ...state,
    hasTargets: target !== undefined,
    refresh,
  };
}

function uniqueCapabilities(
  items: readonly ToolboxCapabilityItem[],
): readonly ToolboxCapabilityItem[] {
  const unique = new Map<string, ToolboxCapabilityItem>();
  for (const item of items) {
    if (!unique.has(item.id)) unique.set(item.id, item);
  }
  return [...unique.values()];
}

function projectSearchText(target: ToolboxCatalogTarget): string {
  return target.project ? `${target.project.name} ${target.project.path}` : "";
}

export function useToolboxCatalogs(scope: WorkbenchToolboxScopePreference) {
  const { t } = useI18n();
  const workspaces = usePiWorkspaces();
  const target = useMemo<ToolboxCatalogTarget | undefined>(() => {
    const resource = toolboxScopeTarget(scope);
    if (scope.kind === "user") return { resource };
    const workspace = workspaces.find((candidate) => candidate.id === scope.workspaceId);
    return workspace
      ? {
          resource,
          project: { id: workspace.id, name: workspace.name, path: workspace.cwd },
        }
      : undefined;
  }, [scope, workspaces]);
  const skillsCatalog = useToolboxCatalog(target, loadSkills);
  const extensionsCatalog = useToolboxCatalog(target, loadExtensions);
  const promptsCatalog = useToolboxCatalog(target, loadPrompts);
  const packagesCatalog = useToolboxCatalog(target, loadPackages);

  const skillItems = useMemo<readonly ToolboxCapabilityItem[]>(
    () =>
      uniqueCapabilities(
        skillsCatalog.entries.flatMap(({ target: entryTarget, value }) =>
          value
            .filter((skill) => toolboxScopeMatchesResource(scope, skill.scope))
            .map((skill) => {
              const params = bindCapabilityToCatalogTarget(
                skillSurfaceParams(skill),
                skill.scope,
                entryTarget.resource,
                entryTarget.project,
              );
              return {
                id: params.capabilityId,
                kind: "skill" as const,
                name: skill.name,
                description: skill.description,
                ...(params.projectId && entryTarget.project
                  ? { project: entryTarget.project }
                  : {}),
                searchText: [
                  skill.name,
                  skill.description,
                  skill.whenToUse ?? "",
                  params.projectId ? projectSearchText(entryTarget) : "",
                ].join(" "),
                params,
              };
            }),
        ),
      ),
    [scope, skillsCatalog.entries],
  );

  const extensionItems = useMemo<readonly ToolboxCapabilityItem[]>(
    () =>
      uniqueCapabilities(
        extensionsCatalog.entries.flatMap(({ target: entryTarget, value }) =>
          value.extensions
            .filter((extension) => toolboxScopeMatchesResource(scope, extension.scope))
            .map((extension) => {
              const params = bindCapabilityToCatalogTarget(
                extensionSurfaceParams(extension),
                extension.scope,
                entryTarget.resource,
                entryTarget.project,
              );
              const description = t("extensions.toolbox.extensions.capabilitySummary", {
                events: extension.eventNames.length,
                tools: extension.toolNames.length,
                commands: extension.commandNames.length,
              });
              return {
                id: params.capabilityId,
                kind: "extension" as const,
                name: params.name,
                description,
                status: t(
                  extension.enabled
                    ? "extensions.toolbox.extensions.loaded"
                    : "extensions.toolbox.extensions.disabled",
                ),
                ...(params.projectId && entryTarget.project
                  ? { project: entryTarget.project }
                  : {}),
                searchText: [
                  params.name,
                  extension.name,
                  description,
                  extension.source,
                  extension.scope,
                  extension.origin,
                  ...extension.eventNames,
                  ...extension.toolNames,
                  ...extension.commandNames,
                  params.projectId ? projectSearchText(entryTarget) : "",
                ].join(" "),
                params,
              };
            }),
        ),
      ),
    [extensionsCatalog.entries, scope, t],
  );

  const promptItems = useMemo<readonly ToolboxCapabilityItem[]>(
    () =>
      uniqueCapabilities(
        promptsCatalog.entries.flatMap(({ target: entryTarget, value }) =>
          value
            .filter((prompt) => toolboxScopeMatchesResource(scope, prompt.scope))
            .map((prompt) => {
              const params = bindCapabilityToCatalogTarget(
                promptSurfaceParams(prompt),
                prompt.scope,
                entryTarget.resource,
                entryTarget.project,
              );
              return {
                id: params.capabilityId,
                kind: "prompt" as const,
                name: prompt.name,
                ...(prompt.description ? { description: prompt.description } : {}),
                ...(params.projectId && entryTarget.project
                  ? { project: entryTarget.project }
                  : {}),
                searchText: [
                  prompt.name,
                  prompt.invocationName,
                  prompt.description ?? "",
                  prompt.argumentHint ?? "",
                  params.projectId ? projectSearchText(entryTarget) : "",
                ].join(" "),
                params,
              };
            }),
        ),
      ),
    [promptsCatalog.entries, scope],
  );

  const packageItems = useMemo<readonly ToolboxCapabilityItem[]>(
    () =>
      uniqueCapabilities(
        packagesCatalog.entries.flatMap(({ target: entryTarget, value }) =>
          value
            .filter((item) => toolboxScopeMatchesResource(scope, item.scope))
            .map((item) => {
              const params = bindCapabilityToCatalogTarget(
                installedPackageSurfaceParams(item),
                item.scope,
                entryTarget.resource,
                entryTarget.project,
              );
              return {
                id: params.capabilityId,
                kind: "package" as const,
                name: item.source,
                ...(params.projectId && entryTarget.project
                  ? { project: entryTarget.project }
                  : {}),
                searchText: `${item.source} ${item.scope} ${
                  params.projectId ? projectSearchText(entryTarget) : ""
                }`,
                params,
              };
            }),
        ),
      ),
    [packagesCatalog.entries, scope],
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
