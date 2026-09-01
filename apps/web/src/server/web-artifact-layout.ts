import type { WebArtifactManifest } from "@workbench/host-contracts/web-artifact-manifest";
import { resolveWebArtifact } from "@workbench/host-server/web-artifact";

export interface WebArtifactRuntimeLayout {
  readonly artifactRoot: string;
  readonly webRoot: string;
  readonly manifest: WebArtifactManifest;
}

/** Loads only the fixed manifest beside the bundled primary entry; callers cannot inject paths. */
export async function loadWebArtifactRuntimeLayout(
  injectedArtifactRoot: string,
): Promise<WebArtifactRuntimeLayout> {
  try {
    const artifact = resolveWebArtifact({ artifactRoot: injectedArtifactRoot });
    return Object.freeze({
      artifactRoot: artifact.artifactRoot,
      webRoot: artifact.appRoot,
      manifest: artifact.manifest,
    });
  } catch {
    throw new Error("Web artifact runtime layout is invalid.");
  }
}
