"use client";

import type { OpenableResource } from "@workbench/extension-sdk";

import { useRightWorkspaceInstallationResource } from "../right-workspace/right-workspace-context";

interface ActiveFileWorkspaceTarget {
  readonly resource: OpenableResource;
  readonly token: symbol;
}

/**
 * Shares the directory resource owned by the currently visible feature with the
 * Right Workspace File entry without coupling either feature to the other.
 */
export class FileWorkspaceTargetService {
  readonly #listeners = new Set<() => void>();
  #active: ActiveFileWorkspaceTarget | undefined;
  #closed = false;

  readonly activate = (resource: OpenableResource): (() => void) => {
    if (this.#closed) {
      throw new Error("The File workspace target service has been disposed.");
    }
    if (!resource.scheme.trim() || !resource.path.trim()) {
      throw new Error("A File workspace target requires a non-empty resource scheme and path");
    }

    const token = Symbol("file-workspace-target");
    const snapshot = Object.freeze({
      ...resource,
      ...(resource.metadata ? { metadata: Object.freeze({ ...resource.metadata }) } : {}),
    });
    this.#active = { resource: snapshot, token };
    this.#emit();

    return () => {
      if (this.#active?.token !== token) return;
      this.#active = undefined;
      this.#emit();
    };
  };

  readonly getSnapshot = (): OpenableResource | undefined => this.#active?.resource;

  readonly getInitialSnapshot = (): undefined => undefined;

  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.#closed) return () => undefined;
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  dispose(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#active = undefined;
    this.#listeners.clear();
  }

  #emit(): void {
    if (this.#closed) return;
    for (const listener of this.#listeners) listener();
  }
}

const FILE_WORKSPACE_TARGET_SERVICE_RESOURCE = Symbol("workbench.file-workspace-target-service");

export function useFileWorkspaceTargetService(): FileWorkspaceTargetService {
  return useRightWorkspaceInstallationResource(
    FILE_WORKSPACE_TARGET_SERVICE_RESOURCE,
    () => new FileWorkspaceTargetService(),
  );
}
