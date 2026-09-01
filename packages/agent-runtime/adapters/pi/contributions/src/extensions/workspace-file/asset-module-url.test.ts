import assert from "node:assert/strict";
import test from "node:test";

import { assetModuleUrl } from "./asset-module-url";

test("uses Vite's string asset modules directly", () => {
  assert.equal(assetModuleUrl("/assets/vscode.svg"), "/assets/vscode.svg");
});

test("uses Next static-image asset modules through src", () => {
  assert.equal(
    assetModuleUrl({ src: "/_next/static/media/vscode.hash.svg", width: 16, height: 16 }),
    "/_next/static/media/vscode.hash.svg",
  );
});

test("rejects an empty static asset URL", () => {
  assert.throws(() => assetModuleUrl({ src: "" }), /non-empty URL/);
});
