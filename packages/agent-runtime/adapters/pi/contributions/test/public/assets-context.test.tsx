import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  normalizePiAssetBaseUrl,
  piContributionAssetUrl,
  usePiContributionAssets,
} from "../../src/public/assets-context";

function AssetConsumer() {
  usePiContributionAssets();
  return null;
}

test("normalizes application-provided Pi asset bases before composing viewer URLs", () => {
  assert.equal(normalizePiAssetBaseUrl("/file-viewer"), "/file-viewer/");
  assert.equal(
    normalizePiAssetBaseUrl("https://assets.example.test/pi/"),
    "https://assets.example.test/pi/",
  );
  assert.equal(
    piContributionAssetUrl("https://assets.example.test/pi", "/vendor/ppt/worker.mjs"),
    "https://assets.example.test/pi/vendor/ppt/worker.mjs",
  );
});

test("fails fast when Pi contribution assets were not installed by an application", () => {
  assert.throws(
    () => renderToStaticMarkup(<AssetConsumer />),
    /PiAgentRuntimeContributionsProvider is required/,
  );
});
