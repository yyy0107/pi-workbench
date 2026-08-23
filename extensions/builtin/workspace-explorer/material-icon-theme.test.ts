import assert from "node:assert/strict";
import test from "node:test";

import type { Manifest } from "material-icon-theme";

import {
  materialFileIconIds,
  materialFolderIconIds,
  materialIconAssetUrl,
} from "@/components/workspace-file-tree/material-icon-theme";

const manifest = {
  iconDefinitions: {
    file: { iconPath: "./../icons/file.svg" },
    node: { iconPath: "./../icons/node.svg" },
    typescript: { iconPath: "./../icons/typescript.svg" },
    declaration: { iconPath: "./../icons/declaration.svg" },
    folder: { iconPath: "./../icons/folder.svg" },
    "folder-open": { iconPath: "./../icons/folder-open.svg" },
    "folder-src": { iconPath: "./../icons/folder-src.svg" },
    "folder-src-open": { iconPath: "./../icons/folder-src-open.svg" },
  },
  file: "file",
  fileNames: { "package.json": "node" },
  fileExtensions: { ts: "typescript", "d.ts": "declaration" },
  folder: "folder",
  folderExpanded: "folder-open",
  folderNames: { src: "folder-src" },
  folderNamesExpanded: { src: "folder-src-open" },
} satisfies Manifest;

test("file names take priority over extensions", () => {
  assert.deepEqual(materialFileIconIds(manifest, "packages/app/package.json"), {
    dark: "node",
    light: "node",
  });
});

test("compound extensions are matched before their final extension", () => {
  assert.deepEqual(materialFileIconIds(manifest, "types/global.d.ts"), {
    dark: "declaration",
    light: "declaration",
  });
});

test("folder icons reflect folder name and expanded state", () => {
  assert.deepEqual(materialFolderIconIds(manifest, "src", false), {
    dark: "folder-src",
    light: "folder-src",
  });
  assert.deepEqual(materialFolderIconIds(manifest, "src", true), {
    dark: "folder-src-open",
    light: "folder-src-open",
  });
});

test("asset paths are served from the synchronized public directory", () => {
  assert.equal(
    materialIconAssetUrl(manifest, "typescript"),
    "/vendor/material-icon-theme/icons/typescript.svg",
  );
});
