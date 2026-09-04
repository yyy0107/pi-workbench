"use client";

import { createElement, useCallback, useSyncExternalStore, type ReactNode } from "react";

import type {
  SidebarSectionComponentProps,
  SidebarSectionDefinition,
} from "@workbench/extension-sdk";

import { useExtensionEnvironment } from "../extension-context";
import { ExtensionErrorBoundary } from "./extension-error-boundary";

const NO_SECTION = undefined;

export interface SidebarSectionHostProps extends SidebarSectionComponentProps {
  sectionId: string;
  fallback?: ReactNode;
}

/** Mount one registered Sidebar destination with extension-owned error isolation. */
export function SidebarSectionHost({
  fallback = null,
  mobile,
  onNavigate,
  searchQuery,
  sectionId,
}: Readonly<SidebarSectionHostProps>) {
  const { manager, reportError } = useExtensionEnvironment();
  const registry = manager.sidebarSections;
  const getSnapshot = useCallback(() => registry.get(sectionId), [registry, sectionId]);
  const definition = useSyncExternalStore<SidebarSectionDefinition | undefined>(
    registry.subscribe,
    getSnapshot,
    () => NO_SECTION,
  );

  if (!definition) return fallback;

  return (
    <ExtensionErrorBoundary
      key={definition.id}
      contributionId={definition.id}
      source="sidebar-section"
      fallback={fallback}
      onError={reportError}
    >
      {createElement(definition.component, { mobile, onNavigate, searchQuery })}
    </ExtensionErrorBoundary>
  );
}
