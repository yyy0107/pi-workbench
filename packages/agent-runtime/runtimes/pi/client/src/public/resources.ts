"use client";

import { useMemo } from "react";

import { usePiSessionManager } from "../runtime/context";
import {
  describeInstalledPiPackage,
  describePiPackageCatalog,
  describePiSkill,
  installPiPackage,
  listAvailablePiPackageUpdates,
  listInstalledPiPackages,
  listPiExtensionFiles,
  listPiExtensions,
  listPiPrompts,
  describePiPrompt,
  savePiPrompt,
  removePiPrompt,
  setPiPromptEnabled,
  expandPiPrompt,
  listPiSkillFiles,
  listPiSkills,
  readPiExtensionFile,
  readPiSkillFile,
  removePiExtension,
  removePiPackage,
  removePiSkill,
  searchPiPackageCatalog,
  setPiExtensionEnabled,
  setPiSkillEnabled,
  updatePiPackage,
} from "../transport/api";

export {
  createPiPackageUpdatesQuery,
  IDLE_PI_PACKAGE_UPDATES_SNAPSHOT,
  piPackageUpdatesTargetKey,
} from "../runtime/package-updates-query";
export type {
  PiPackageUpdatesLoadState,
  PiPackageUpdatesQuery,
  PiPackageUpdatesQueryOptions,
  PiPackageUpdatesSnapshot,
} from "../runtime/package-updates-query";

/** Bind Pi resource requests to the installation that owns the current manager. */
export function usePiResourceClient() {
  const manager = usePiSessionManager();
  return useMemo(() => {
    const options = manager.rpcTransportOptions;
    const invalidateCatalog = manager.resourceCatalogRevision.invalidate;
    const invalidatePackageUpdates = manager.packageUpdatesQuery.invalidate;
    return {
      getCatalogRevision: manager.resourceCatalogRevision.getRevision,
      subscribeCatalog: manager.resourceCatalogRevision.subscribe,
      packageUpdatesQuery: manager.packageUpdatesQuery,
      listSkills: (payload: Parameters<typeof listPiSkills>[0]) => listPiSkills(payload, options),
      describeSkill: (payload: Parameters<typeof describePiSkill>[0]) =>
        describePiSkill(payload, options),
      setSkillEnabled: async (payload: Parameters<typeof setPiSkillEnabled>[0]) => {
        const value = await setPiSkillEnabled(payload, options);
        invalidateCatalog();
        return value;
      },
      removeSkill: async (payload: Parameters<typeof removePiSkill>[0]) => {
        const value = await removePiSkill(payload, options);
        invalidateCatalog();
        return value;
      },
      listSkillFiles: (payload: Parameters<typeof listPiSkillFiles>[0]) =>
        listPiSkillFiles(payload, options),
      readSkillFile: (payload: Parameters<typeof readPiSkillFile>[0]) =>
        readPiSkillFile(payload, options),
      listExtensions: (payload: Parameters<typeof listPiExtensions>[0]) =>
        listPiExtensions(payload, options),
      readExtensionFile: (payload: Parameters<typeof readPiExtensionFile>[0]) =>
        readPiExtensionFile(payload, options),
      listExtensionFiles: (payload: Parameters<typeof listPiExtensionFiles>[0]) =>
        listPiExtensionFiles(payload, options),
      setExtensionEnabled: async (payload: Parameters<typeof setPiExtensionEnabled>[0]) => {
        const value = await setPiExtensionEnabled(payload, options);
        invalidateCatalog();
        return value;
      },
      removeExtension: async (payload: Parameters<typeof removePiExtension>[0]) => {
        const value = await removePiExtension(payload, options);
        invalidateCatalog();
        return value;
      },
      listPrompts: (payload: Parameters<typeof listPiPrompts>[0]) =>
        listPiPrompts(payload, options),
      describePrompt: (payload: Parameters<typeof describePiPrompt>[0]) =>
        describePiPrompt(payload, options),
      expandPrompt: (payload: Parameters<typeof expandPiPrompt>[0]) =>
        expandPiPrompt(payload, options),
      savePrompt: async (payload: Parameters<typeof savePiPrompt>[0]) => {
        const value = await savePiPrompt(payload, options);
        invalidateCatalog();
        return value;
      },
      removePrompt: async (payload: Parameters<typeof removePiPrompt>[0]) => {
        const value = await removePiPrompt(payload, options);
        invalidateCatalog();
        return value;
      },
      setPromptEnabled: async (payload: Parameters<typeof setPiPromptEnabled>[0]) => {
        const value = await setPiPromptEnabled(payload, options);
        invalidateCatalog();
        return value;
      },
      listInstalledPackages: (payload: Parameters<typeof listInstalledPiPackages>[0]) =>
        listInstalledPiPackages(payload, options),
      describeInstalledPackage: (payload: Parameters<typeof describeInstalledPiPackage>[0]) =>
        describeInstalledPiPackage(payload, options),
      listAvailablePackageUpdates: (payload: Parameters<typeof listAvailablePiPackageUpdates>[0]) =>
        listAvailablePiPackageUpdates(payload, options),
      installPackage: async (payload: Parameters<typeof installPiPackage>[0]) => {
        const value = await installPiPackage(payload, options);
        invalidateCatalog();
        invalidatePackageUpdates(payload.target);
        return value;
      },
      updatePackage: async (payload: Parameters<typeof updatePiPackage>[0]) => {
        const value = await updatePiPackage(payload, options);
        invalidateCatalog();
        invalidatePackageUpdates(payload.target);
        return value;
      },
      removePackage: async (payload: Parameters<typeof removePiPackage>[0]) => {
        const value = await removePiPackage(payload, options);
        invalidateCatalog();
        invalidatePackageUpdates(payload.target);
        return value;
      },
      searchPackageCatalog: (payload?: Parameters<typeof searchPiPackageCatalog>[0]) =>
        searchPiPackageCatalog(payload, options),
      describePackageCatalog: (payload: Parameters<typeof describePiPackageCatalog>[0]) =>
        describePiPackageCatalog(payload, options),
    };
  }, [manager]);
}

export type PiResourceClient = ReturnType<typeof usePiResourceClient>;
