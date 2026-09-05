"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { useToolCapabilityPreferences } from "@workbench/shell/tool-capability-preferences";

import { usePiI18n } from "../../i18n";
import { usePiResourceClient } from "@workbench/agent-runtime-pi-client/resources";
import { usePiWorkspaces } from "@workbench/agent-runtime-pi-client/workspace";
import type {
  BuiltinExtensionView,
  ExtensionView,
  PiResourceCatalogTarget,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import {
  BUILTIN_TOOL_PREFERENCE_KEYS,
  type BuiltinToolName,
  type WorkbenchToolboxScopePreference,
} from "@workbench/agent-runtime-contracts/settings";

import {
  bindCapabilityToCatalogTarget,
  builtinExtensionSurfaceParams,
  builtinToolPreferenceKey,
  extensionSurfaceParams,
  installedPackageSurfaceParams,
  promptSurfaceParams,
  skillSurfaceParams,
  type ToolboxCapabilitySurfaceParams,
} from "./toolbox-capability";
import { toolboxScopeMatchesResource, toolboxScopeTarget } from "./toolbox-scope";

export interface PiExtensionsCatalog {
  readonly extensions: readonly ExtensionView[];
  readonly builtins?: readonly BuiltinExtensionView[];
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
  readonly kind: "skill" | "extension" | "prompt" | "package";
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

function useToolboxCatalog<T>(
  target: ToolboxCatalogTarget | undefined,
  loader: (target: PiResourceCatalogTarget) => Promise<T>,
): ToolboxCatalog<T> {
  const resourceClient = usePiResourceClient();
  const resourceCatalogRevision = useSyncExternalStore(
    resourceClient.subscribeCatalog,
    resourceClient.getCatalogRevision,
    resourceClient.getCatalogRevision,
  );
  const [state, setState] = useState<ToolboxCatalogState<T>>({
    entries: [],
    loadState: "idle",
  });
  const requestGeneration = useRef(0);

  useEffect(() => {
    const requestId = ++requestGeneration.current;
    if (!target) {
      setState({ entries: [], loadState: "idle" });
      return;
    }

    setState((current) => ({
      entries: current.entries.filter((entry) => entry.target === target),
      loadState: "loading",
    }));
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
  }, [loader, resourceCatalogRevision, target]);

  return {
    ...state,
    hasTargets: target !== undefined,
    refresh: resourceClient.refreshCatalog,
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

export function useToolboxCatalogs(
  scope: WorkbenchToolboxScopePreference,
  kind?: ToolboxCapabilityItem["kind"],
) {
  const { t } = usePiI18n();
  const askUserPreference = useToolCapabilityPreferences("askUserEnabled");
  const todoPreference = useToolCapabilityPreferences("todoEnabled");
  const readPreference = useToolCapabilityPreferences("readToolEnabled");
  const bashPreference = useToolCapabilityPreferences("bashToolEnabled");
  const editPreference = useToolCapabilityPreferences("editToolEnabled");
  const writePreference = useToolCapabilityPreferences("writeToolEnabled");
  const grepPreference = useToolCapabilityPreferences("grepToolEnabled");
  const findPreference = useToolCapabilityPreferences("findToolEnabled");
  const lsPreference = useToolCapabilityPreferences("lsToolEnabled");

  const resourceClient = usePiResourceClient();
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
  const loadSkills = useCallback(
    async (catalogTarget: PiResourceCatalogTarget) =>
      (await resourceClient.listSkills({ target: catalogTarget })).skills,
    [resourceClient],
  );
  const loadExtensions = useCallback(
    (catalogTarget: PiResourceCatalogTarget) =>
      resourceClient.listExtensions({ target: catalogTarget }),
    [resourceClient],
  );
  const loadPrompts = useCallback(
    async (catalogTarget: PiResourceCatalogTarget) =>
      (await resourceClient.listPrompts({ target: catalogTarget })).prompts,
    [resourceClient],
  );
  const loadPackages = useCallback(
    async (catalogTarget: PiResourceCatalogTarget) =>
      (await resourceClient.listInstalledPackages({ target: catalogTarget })).packages,
    [resourceClient],
  );
  const skillsCatalog = useToolboxCatalog(
    !kind || kind === "skill" ? target : undefined,
    loadSkills,
  );
  const extensionsCatalog = useToolboxCatalog(
    !kind || kind === "extension" ? target : undefined,
    loadExtensions,
  );
  const promptsCatalog = useToolboxCatalog(
    !kind || kind === "prompt" ? target : undefined,
    loadPrompts,
  );
  const packagesCatalog = useToolboxCatalog(
    !kind || kind === "package" ? target : undefined,
    loadPackages,
  );

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

  const builtinExtensionItems = useMemo<readonly ToolboxCapabilityItem[]>(
    () =>
      uniqueCapabilities(
        extensionsCatalog.entries.flatMap(({ value }) =>
          (value.builtins ?? []).map((extension) => {
            const params = builtinExtensionSurfaceParams(extension);
            const key = builtinToolPreferenceKey(params);
            const preference = key
              ? {
                  askUserEnabled: askUserPreference,
                  todoEnabled: todoPreference,
                  readToolEnabled: readPreference,
                  bashToolEnabled: bashPreference,
                  editToolEnabled: editPreference,
                  writeToolEnabled: writePreference,
                  grepToolEnabled: grepPreference,
                  findToolEnabled: findPreference,
                  lsToolEnabled: lsPreference,
                }[key]
              : undefined;
            if (preference && preference.status !== "loading") params.enabled = preference.enabled;
            const nativeTool = (
              Object.keys(BUILTIN_TOOL_PREFERENCE_KEYS) as BuiltinToolName[]
            ).find((name) => extension.name === `workbench.tool.${name}`);
            const description = nativeTool
              ? t(`extensions.toolbox.builtins.tools.${nativeTool}`)
              : t("extensions.toolbox.extensions.capabilitySummary", {
                  events: extension.eventNames.length,
                  tools: extension.toolNames.length,
                  commands: extension.commandNames.length,
                });
            if (nativeTool) params.description = description;
            return {
              id: params.capabilityId,
              kind: "extension" as const,
              name: params.name,
              description,
              searchText: [
                extension.name,
                description,
                ...extension.eventNames,
                ...extension.toolNames,
                ...extension.commandNames,
              ].join(" "),
              params,
            };
          }),
        ),
      ),
    [
      extensionsCatalog.entries,
      t,
      askUserPreference,
      todoPreference,
      readPreference,
      bashPreference,
      editPreference,
      writePreference,
      grepPreference,
      findPreference,
      lsPreference,
    ],
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
    extensionItems: [...builtinExtensionItems, ...extensionItems],
    extensionsCatalog,
    packageItems,
    packagesCatalog,
    promptItems,
    promptsCatalog,
    skillItems,
    skillsCatalog,
  } as const;
}
