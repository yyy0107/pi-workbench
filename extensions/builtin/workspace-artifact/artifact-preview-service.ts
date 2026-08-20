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
  threadId?: string;
  title: string;
  mimeType?: string;
  rendererKind: ArtifactRendererKind;
  content?: string;
  url?: string;
  updatedAt: number;
}

export interface ArtifactPreviewService {
  getArtifact(artifactId: string): ArtifactDescriptor | undefined;
  upsertArtifact(artifact: ArtifactDescriptor): void;
  subscribe(listener: () => void): () => void;
  getRevision(): number;
}

export class MemoryArtifactPreviewService implements ArtifactPreviewService {
  readonly #artifacts = new Map<string, ArtifactDescriptor>();
  readonly #listeners = new Set<() => void>();
  #revision = 0;

  getArtifact(artifactId: string): ArtifactDescriptor | undefined {
    return this.#artifacts.get(artifactId);
  }

  upsertArtifact(artifact: ArtifactDescriptor): void {
    this.#artifacts.set(artifact.id, { ...artifact });
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

export const artifactPreviewService = new MemoryArtifactPreviewService();
