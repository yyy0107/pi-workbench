import {
  getDefaultFileViewerAssetBaseUrl,
  normalizeFileViewerAssetBaseUrl,
  resetDefaultFileViewerAssetBaseUrl,
  setDefaultFileViewerAssetBaseUrl,
} from "@file-viewer/core";

interface FileViewerAssetBaseLease {
  released: boolean;
}

let baselineBaseUrl: string | undefined;
let activeBaseUrl: string | undefined;
let activeLeaseCount = 0;

function restoreBaselineBaseUrl() {
  if (baselineBaseUrl === undefined) resetDefaultFileViewerAssetBaseUrl();
  else setDefaultFileViewerAssetBaseUrl(baselineBaseUrl);
}

/**
 * Temporarily installs File Viewer's browser/process fallback base for one mounted provider.
 *
 * Individual Pi viewers always pass their injected asset base explicitly. Some third-party preset
 * paths still resolve File Viewer's process-global fallback, which cannot safely represent two
 * different renderer roots at once. Concurrent leases therefore must use the same normalized base
 * URL; a conflicting base is rejected synchronously without changing the existing fallback. The
 * first lease captures the pre-existing library default, and the final release restores it. This
 * also makes React development Strict Mode's setup → cleanup → setup replay deterministic.
 */
export function acquireFileViewerAssetBaseLease(baseUrl: string): () => void {
  const normalizedBaseUrl = normalizeFileViewerAssetBaseUrl(baseUrl);
  if (normalizedBaseUrl === undefined) {
    throw new Error("A File Viewer asset base URL is required for a Pi contribution installation.");
  }

  if (activeLeaseCount === 0) {
    baselineBaseUrl = getDefaultFileViewerAssetBaseUrl();
    activeBaseUrl = normalizedBaseUrl;
    setDefaultFileViewerAssetBaseUrl(activeBaseUrl);
  } else if (activeBaseUrl !== normalizedBaseUrl) {
    throw new Error(
      `Cannot install Pi File Viewer assets for ${normalizedBaseUrl}: ${activeBaseUrl} is already active.`,
    );
  }

  activeLeaseCount += 1;
  const lease: FileViewerAssetBaseLease = { released: false };

  return () => {
    if (lease.released) return;
    lease.released = true;

    activeLeaseCount -= 1;
    if (activeLeaseCount === 0) {
      restoreBaselineBaseUrl();
      baselineBaseUrl = undefined;
      activeBaseUrl = undefined;
    }
  };
}
