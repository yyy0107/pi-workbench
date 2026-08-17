"use client";

import {
  createElement,
  useCallback,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";

import type { SlotContribution, SlotPropsMap, WorkbenchSlot } from "../api/slot";
import { useExtensionEnvironment } from "../extension-context";
import { ExtensionErrorBoundary } from "./extension-error-boundary";

const EMPTY_CONTRIBUTIONS = Object.freeze([]) as readonly SlotContribution[];

export interface SlotHostProps<K extends WorkbenchSlot> {
  name: K;
  context?: SlotPropsMap[K];
  className?: string;
}

export function SlotHost<K extends WorkbenchSlot>({
  name,
  context,
  className,
}: SlotHostProps<K>): ReactNode {
  const { manager, reportError } = useExtensionEnvironment();
  const registry = manager.slots;
  const getSnapshot = useCallback(() => registry.get(name), [name, registry]);
  const contributions = useSyncExternalStore(
    registry.subscribe,
    getSnapshot,
    () => EMPTY_CONTRIBUTIONS as readonly SlotContribution<K>[],
  );

  const content = contributions.map((contribution) => {
    const Component = contribution.component as ComponentType<object>;
    return (
      <ExtensionErrorBoundary
        key={contribution.id}
        contributionId={contribution.id}
        source="slot"
        onError={reportError}
      >
        {createElement(Component, context ?? {})}
      </ExtensionErrorBoundary>
    );
  });

  if (className) {
    return (
      <div className={className} data-slot-host={name}>
        {content}
      </div>
    );
  }
  return content;
}
