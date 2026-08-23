import { cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.dirname(require.resolve("file-viewer-copy-assets/package.json"));
const sourceRoot = path.join(packageRoot, "viewer");
const targetRoot = path.join(projectRoot, "public", "file-viewer");

if (
  path.basename(targetRoot) !== "file-viewer" ||
  path.basename(path.dirname(targetRoot)) !== "public"
) {
  throw new Error(`Refusing to replace unexpected file-viewer asset directory: ${targetRoot}`);
}

const officeAssetDirectories = [
  "vendor/docx",
  "vendor/hangul",
  "vendor/iwork",
  "vendor/pdf",
  "vendor/ppt",
  "vendor/pptx",
  "vendor/wordperfect",
  "vendor/xlsx",
];

await rm(targetRoot, { recursive: true, force: true });
await mkdir(targetRoot, { recursive: true });
for (const relativePath of officeAssetDirectories) {
  const target = path.join(targetRoot, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(path.join(sourceRoot, relativePath), target, { recursive: true });
}
