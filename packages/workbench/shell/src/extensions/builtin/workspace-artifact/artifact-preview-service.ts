"use client";

import type { WorkspaceScope } from "@workbench/extension-sdk";

import { useRightWorkspaceInstallationResource } from "../../../right-workspace/right-workspace-context";

export type ArtifactRendererKind =
  | "markdown"
  | "code"
  | "image"
  | "pdf"
  | "html"
  | "spreadsheet"
  | "presentation"
  | "unknown";

export interface ArtifactDescriptor {
  id: string;
  scope: WorkspaceScope;
  title: string;
  mimeType?: string;
  rendererKind: ArtifactRendererKind;
  content?: string;
  url?: string;
  updatedAt: number;
}

export type ArtifactKey = Pick<ArtifactDescriptor, "id" | "scope">;

export interface ArtifactPreviewService {
  getArtifact(key: ArtifactKey): ArtifactDescriptor | undefined;
  upsertArtifact(artifact: ArtifactDescriptor): void;
  subscribe(listener: () => void): () => void;
  getRevision(): number;
  dispose(): void;
}

export class MemoryArtifactPreviewService implements ArtifactPreviewService {
  readonly #artifacts = new Map<string, ArtifactDescriptor>();
  readonly #listeners = new Set<() => void>();
  #revision = 0;
  #disposed = false;

  getArtifact(key: ArtifactKey): ArtifactDescriptor | undefined {
    if (this.#disposed) return undefined;
    return this.#artifacts.get(toArtifactStorageKey(key));
  }

  upsertArtifact(artifact: ArtifactDescriptor): void {
    this.assertActive();
    this.#artifacts.set(toArtifactStorageKey(artifact), {
      ...artifact,
      scope: { ...artifact.scope },
    });
    this.#revision += 1;
    for (const listener of this.#listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    if (this.#disposed) return () => {};
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  getRevision(): number {
    return this.#revision;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#artifacts.clear();
    this.#listeners.clear();
  }

  private assertActive(): void {
    if (this.#disposed) throw new Error("The artifact preview service has been disposed.");
  }
}

function toArtifactStorageKey({ id, scope }: ArtifactKey): string {
  return JSON.stringify([scope.type, scope.key, id]);
}

const ARTIFACT_PREVIEW_SERVICE_RESOURCE = Symbol("workbench.artifact-preview-service");

export function useArtifactPreviewService(): ArtifactPreviewService {
  return useRightWorkspaceInstallationResource(
    ARTIFACT_PREVIEW_SERVICE_RESOURCE,
    () => new MemoryArtifactPreviewService(),
  );
}
