import assert from "node:assert/strict";
import test from "node:test";
import type { Manifest } from "material-icon-theme";

import { materialIconAssetUrl } from "./material-icon-theme";

test("resolves material icons against the app-injected asset base URL", () => {
  const manifest = {
    iconDefinitions: {
      typescript: { iconPath: "./icons/folder/typescript.svg" },
    },
  } as Manifest;

  assert.equal(
    materialIconAssetUrl(manifest, "typescript", "https://assets.example/theme/"),
    "https://assets.example/theme/icons/folder/typescript.svg",
  );
  assert.equal(
    materialIconAssetUrl(manifest, "unknown icon", "/custom/material-icons"),
    "/custom/material-icons/icons/unknown%20icon.svg",
  );
});
