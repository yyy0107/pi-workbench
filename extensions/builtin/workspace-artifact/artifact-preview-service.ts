import type { WorkspaceScope } from "@/platform/extensions/authoring";

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
}

export class MemoryArtifactPreviewService implements ArtifactPreviewService {
  readonly #artifacts = new Map<string, ArtifactDescriptor>();
  readonly #listeners = new Set<() => void>();
  #revision = 0;

  getArtifact(key: ArtifactKey): ArtifactDescriptor | undefined {
    return this.#artifacts.get(toArtifactStorageKey(key));
  }

  upsertArtifact(artifact: ArtifactDescriptor): void {
    this.#artifacts.set(toArtifactStorageKey(artifact), {
      ...artifact,
      scope: { ...artifact.scope },
    });
    this.#revision += 1;
    for (const listener of this.#listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  getRevision(): number {
    return this.#revision;
  }
}

function toArtifactStorageKey({ id, scope }: ArtifactKey): string {
  return JSON.stringify([scope.type, scope.key, id]);
}

export const artifactPreviewService = new MemoryArtifactPreviewService();
