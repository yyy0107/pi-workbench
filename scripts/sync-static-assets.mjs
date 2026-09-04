import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const SYNC_MARKER = ".workbench-assets";

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function syncStaticAssets({ entries, fingerprint, targetRoot }) {
  const marker = path.join(targetRoot, SYNC_MARKER);
  const previousFingerprint = await readFile(marker, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  });
  if (
    previousFingerprint === fingerprint &&
    (await Promise.all(entries.map(({ target }) => exists(path.join(targetRoot, target))))).every(
      Boolean,
    )
  ) {
    return false;
  }

  await rm(targetRoot, { recursive: true, force: true });
  await mkdir(targetRoot, { recursive: true });
  await Promise.all(
    entries.map(async ({ source, target }) => {
      const destination = path.join(targetRoot, target);
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(source, destination, { recursive: true });
    }),
  );
  await writeFile(marker, fingerprint);
  return true;
}

export function syncMaterialIconTheme({ publicRoot, require }) {
  const manifest = require("material-icon-theme/package.json");
  const packageRoot = path.dirname(require.resolve("material-icon-theme/package.json"));
  return syncStaticAssets({
    targetRoot: path.join(publicRoot, "vendor", "material-icon-theme"),
    fingerprint: JSON.stringify({
      package: `${manifest.name}@${manifest.version}`,
      assets: ["icons", "material-icons.json"],
    }),
    entries: [
      { source: path.join(packageRoot, "icons"), target: "icons" },
      {
        source: path.join(packageRoot, "dist", "material-icons.json"),
        target: "material-icons.json",
      },
    ],
  });
}

const officeAssetDirectories = Object.freeze([
  "vendor/docx",
  "vendor/hangul",
  "vendor/iwork",
  "vendor/pdf",
  "vendor/ppt",
  "vendor/pptx",
  "vendor/wordperfect",
  "vendor/xlsx",
]);

export function syncFileViewerAssets({ publicRoot, require }) {
  const manifest = require("file-viewer-copy-assets/package.json");
  const packageRoot = path.dirname(require.resolve("file-viewer-copy-assets/package.json"));
  const targetRoot = path.join(publicRoot, "file-viewer");
  if (
    path.basename(targetRoot) !== "file-viewer" ||
    path.basename(path.dirname(targetRoot)) !== "public"
  ) {
    throw new Error(`Refusing to replace unexpected file-viewer asset directory: ${targetRoot}`);
  }
  return syncStaticAssets({
    targetRoot,
    fingerprint: JSON.stringify({
      package: `${manifest.name}@${manifest.version}`,
      assets: officeAssetDirectories,
    }),
    entries: officeAssetDirectories.map((relativePath) => ({
      source: path.join(packageRoot, "viewer", relativePath),
      target: relativePath,
    })),
  });
}
