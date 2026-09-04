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
  describeInstalledPiPackage,
  describePiPackageCatalog,
  describePiSkill,
  installPiPackage,
  listAvailablePiPackageUpdates,
  listInstalledPiPackages,
  listPiCommands,
  listPiExtensionFiles,
  listPiExtensions,
  listPiPrompts,
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
export {
  createPiSessionCatalogState,
  isPiSessionUnavailable,
  readPiSessionCatalog,
  transitionPiSessionCatalog,
  usePiSessionCatalog,
} from "../runtime/session-catalog";
export type {
  PiSessionCatalog,
  PiSessionCatalogEvent,
  PiSessionCatalogLoadState,
  PiSessionCatalogState,
} from "../runtime/session-catalog";

/**
 * Bind resource-catalog requests to the installation that owns the current Pi manager.
 * Standalone exports above intentionally retain their same-origin default for isolated callers.
 */
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
