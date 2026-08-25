import type { OpenableResource } from "@/platform/extensions";

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

  readonly activate = (resource: OpenableResource): (() => void) => {
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
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}

export const fileWorkspaceTargetService = new FileWorkspaceTargetService();
