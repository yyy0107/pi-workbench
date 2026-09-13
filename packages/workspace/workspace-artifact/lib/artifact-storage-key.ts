import type { ArtifactKey } from "../src/artifact-preview-service";

/** Encode the complete scoped identity without separator collisions. */
export function toArtifactStorageKey({ id, scope }: ArtifactKey): string {
  return JSON.stringify([scope.type, scope.key, id]);
}
