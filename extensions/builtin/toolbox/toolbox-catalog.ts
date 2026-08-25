"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { useI18n } from "@/i18n";
import { usePiResourceCatalogTargets } from "@/runtime/pi/client/runtime/context";
import type { PiResourceCatalogTarget } from "@/runtime/pi/client/runtime/manager";
import {
  getPiResourceCatalogRevision,
  invalidatePiResourceCatalog,
  subscribePiResourceCatalog,
} from "@/runtime/pi/client/runtime/resource-catalog-revision";
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
  bindCapabilityToCatalogTarget,
  extensionSurfaceParams,
  installedPackageSurfaceParams,
  promptSurfaceParams,
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
  readonly project?: PiResourceCatalogTarget["project"];
  readonly searchText: string;
  readonly params: ToolboxCapabilitySurfaceParams;
}

type ToolboxCatalogLoadState = "idle" | "loading" | "ready" | "failed";

interface ToolboxCatalogEntry<T> {
  readonly target: PiResourceCatalogTarget;
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

async function loadCatalogEntries<T>(
  targets: readonly PiResourceCatalogTarget[],
  loader: (sessionId: string) => Promise<T>,
): Promise<{ entries: readonly ToolboxCatalogEntry<T>[]; failureCount: number }> {
  const entries = Array.from<ToolboxCatalogEntry<T> | undefined>({ length: targets.length });
  let failureCount = 0;
  let nextIndex = 0;
  const workerCount = Math.min(4, targets.length);

  const worker = async () => {
    while (nextIndex < targets.length) {
      const index = nextIndex++;
      const target = targets[index];
      if (!target) continue;
      try {
        entries[index] = { target, value: await loader(target.sessionId) };
      } catch {
        failureCount += 1;
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return {
    entries: entries.filter((entry): entry is ToolboxCatalogEntry<T> => entry !== undefined),
    failureCount,
  };
}

function useToolboxCatalog<T>(
  targets: readonly PiResourceCatalogTarget[],
  loader: (sessionId: string) => Promise<T>,
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
    if (targets.length === 0) {
      setState({ entries: [], loadState: "idle" });
      return;
    }

    setState({ entries: [], loadState: "loading" });
    void loadCatalogEntries(targets, loader).then(({ entries, failureCount }) => {
      if (requestGeneration.current !== requestId) return;
      setState({
        entries,
        loadState: entries.length === 0 && failureCount > 0 ? "failed" : "ready",
      });
    });

    return () => {
      requestGeneration.current += 1;
    };
  }, [loader, reloadRevision, resourceCatalogRevision, targets]);

  return {
    ...state,
    hasTargets: targets.length > 0,
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

function projectSearchText(target: PiResourceCatalogTarget): string {
  return target.project ? `${target.project.name} ${target.project.path}` : "";
}

export function useToolboxCatalogs() {
  const { t } = useI18n();
  const targets = usePiResourceCatalogTargets();
  const skillsCatalog = useToolboxCatalog(targets, loadSkills);
  const extensionsCatalog = useToolboxCatalog(targets, loadExtensions);
  const promptsCatalog = useToolboxCatalog(targets, loadPrompts);
  const packagesCatalog = useToolboxCatalog(targets, loadPackages);

  const skillItems = useMemo<readonly ToolboxCapabilityItem[]>(
    () =>
      uniqueCapabilities(
        skillsCatalog.entries.flatMap(({ target, value }) =>
          value.map((skill) => {
            const params = bindCapabilityToCatalogTarget(
              skillSurfaceParams(skill),
              skill.scope,
              target,
            );
            return {
              id: params.capabilityId,
              kind: "skill" as const,
              name: skill.name,
              description: skill.description,
              ...(params.projectId && target.project ? { project: target.project } : {}),
              searchText: [
                skill.name,
                skill.description,
                skill.whenToUse ?? "",
                params.projectId ? projectSearchText(target) : "",
              ].join(" "),
              params,
            };
          }),
        ),
      ),
    [skillsCatalog.entries],
  );

  const extensionItems = useMemo<readonly ToolboxCapabilityItem[]>(
    () =>
      uniqueCapabilities(
        extensionsCatalog.entries.flatMap(({ target, value }) =>
          value.extensions.map((extension) => {
            const params = bindCapabilityToCatalogTarget(
              extensionSurfaceParams(extension),
              extension.scope,
              target,
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
              ...(params.projectId && target.project ? { project: target.project } : {}),
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
                params.projectId ? projectSearchText(target) : "",
              ].join(" "),
              params,
            };
          }),
        ),
      ),
    [extensionsCatalog.entries, t],
  );

  const promptItems = useMemo<readonly ToolboxCapabilityItem[]>(
    () =>
      uniqueCapabilities(
        promptsCatalog.entries.flatMap(({ target, value }) =>
          value.map((prompt) => {
            const params = bindCapabilityToCatalogTarget(
              promptSurfaceParams(prompt),
              prompt.scope,
              target,
            );
            return {
              id: params.capabilityId,
              kind: "prompt" as const,
              name: prompt.name,
              ...(prompt.description ? { description: prompt.description } : {}),
              ...(params.projectId && target.project ? { project: target.project } : {}),
              searchText: [
                prompt.name,
                prompt.invocationName,
                prompt.description ?? "",
                prompt.argumentHint ?? "",
                params.projectId ? projectSearchText(target) : "",
              ].join(" "),
              params,
            };
          }),
        ),
      ),
    [promptsCatalog.entries],
  );

  const packageItems = useMemo<readonly ToolboxCapabilityItem[]>(
    () =>
      uniqueCapabilities(
        packagesCatalog.entries.flatMap(({ target, value }) =>
          value.map((item) => {
            const params = bindCapabilityToCatalogTarget(
              installedPackageSurfaceParams(item),
              item.scope,
              target,
            );
            return {
              id: params.capabilityId,
              kind: "package" as const,
              name: item.source,
              ...(params.projectId && target.project ? { project: target.project } : {}),
              searchText: `${item.source} ${item.scope} ${
                params.projectId ? projectSearchText(target) : ""
              }`,
              params,
            };
          }),
        ),
      ),
    [packagesCatalog.entries],
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
