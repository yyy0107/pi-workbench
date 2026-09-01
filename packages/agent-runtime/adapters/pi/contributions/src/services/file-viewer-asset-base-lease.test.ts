import assert from "node:assert/strict";
import test from "node:test";

import {
  getDefaultFileViewerAssetBaseUrl,
  resetDefaultFileViewerAssetBaseUrl,
  setDefaultFileViewerAssetBaseUrl,
} from "@file-viewer/core";

import { acquireFileViewerAssetBaseLease } from "./file-viewer-asset-base-lease";

function withBaseline(baseUrl: string | undefined, run: () => void) {
  if (baseUrl === undefined) resetDefaultFileViewerAssetBaseUrl();
  else setDefaultFileViewerAssetBaseUrl(baseUrl);

  try {
    run();
  } finally {
    resetDefaultFileViewerAssetBaseUrl();
  }
}

test("restores the baseline during a Strict Mode effect replay", () => {
  withBaseline("/existing-assets/", () => {
    const releaseFirstMount = acquireFileViewerAssetBaseLease("/pi-assets/");
    assert.equal(getDefaultFileViewerAssetBaseUrl(), "/pi-assets/");

    releaseFirstMount();
    assert.equal(getDefaultFileViewerAssetBaseUrl(), "/existing-assets/");

    const releaseReplayMount = acquireFileViewerAssetBaseLease("/pi-assets/");
    assert.equal(getDefaultFileViewerAssetBaseUrl(), "/pi-assets/");
    releaseReplayMount();

    assert.equal(getDefaultFileViewerAssetBaseUrl(), "/existing-assets/");
  });
});

test("keeps the shared base when same-base providers unmount out of order", () => {
  withBaseline(undefined, () => {
    const releaseFirstProvider = acquireFileViewerAssetBaseLease("/pi-assets");
    const releaseSecondProvider = acquireFileViewerAssetBaseLease("/pi-assets/");
    assert.equal(getDefaultFileViewerAssetBaseUrl(), "/pi-assets/");

    releaseFirstProvider();
    assert.equal(getDefaultFileViewerAssetBaseUrl(), "/pi-assets/");

    releaseSecondProvider();
    assert.equal(getDefaultFileViewerAssetBaseUrl(), undefined);
  });
});

test("restores the baseline for reverse-order same-base provider unmounts", () => {
  withBaseline("/existing-assets/", () => {
    const releaseFirstProvider = acquireFileViewerAssetBaseLease("/pi-assets/");
    const releaseSecondProvider = acquireFileViewerAssetBaseLease("/pi-assets/");

    releaseSecondProvider();
    assert.equal(getDefaultFileViewerAssetBaseUrl(), "/pi-assets/");

    releaseFirstProvider();
    assert.equal(getDefaultFileViewerAssetBaseUrl(), "/existing-assets/");
  });
});

test("rejects a conflicting base without changing the current fallback, then permits retry", () => {
  withBaseline("/existing-assets/", () => {
    const releaseFirst = acquireFileViewerAssetBaseLease("/first-assets/");
    try {
      assert.throws(
        () => acquireFileViewerAssetBaseLease("/second-assets/"),
        /Cannot install Pi File Viewer assets for \/second-assets\/: \/first-assets\/ is already active\./,
      );
      assert.equal(getDefaultFileViewerAssetBaseUrl(), "/first-assets/");
    } finally {
      releaseFirst();
    }

    assert.equal(getDefaultFileViewerAssetBaseUrl(), "/existing-assets/");

    const releaseRetry = acquireFileViewerAssetBaseLease("/second-assets/");
    try {
      assert.equal(getDefaultFileViewerAssetBaseUrl(), "/second-assets/");
    } finally {
      releaseRetry();
    }
    assert.equal(getDefaultFileViewerAssetBaseUrl(), "/existing-assets/");
  });
});
