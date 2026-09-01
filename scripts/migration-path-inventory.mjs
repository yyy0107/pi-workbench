import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isRootProductionSource,
  ledgerDocument,
  versionControlledFiles,
} from "./source-ownership-ledger.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;
const TEST_FILE = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/;
const NATIVE_PACKAGES = new Set(["node-pty", "tree-sitter", "tree-sitter-bash"]);

function normalized(relativeFile) {
  return relativeFile.split(path.sep).join("/");
}

function lineNumber(source, index) {
  return source.slice(0, index).split("\n").length;
}

function evidence(category, file, source, expression, detail) {
  const results = [];
  for (const match of source.matchAll(expression)) {
    results.push({ category, file, line: lineNumber(source, match.index), detail });
  }
  return results;
}

function isProductionCode(file) {
  if (!SOURCE_FILE.test(file) || TEST_FILE.test(file)) return false;
  if (file.startsWith("apps/") || file.startsWith("packages/")) {
    return /^(?:apps|packages)\/[^/]+(?:\/[^/]+)*\/src\//.test(file);
  }
  return isRootProductionSource(file);
}

async function sourceFor(repositoryRoot, file) {
  return readFile(path.join(repositoryRoot, file), "utf8");
}

export async function migrationPathInventory({
  repositoryRoot = REPOSITORY_ROOT,
  files = versionControlledFiles(repositoryRoot),
} = {}) {
  const inventory = [];
  for (const file of files.filter(isProductionCode).map(normalized).sort()) {
    const source = await sourceFor(repositoryRoot, file);
    inventory.push(...evidence("hardcoded-api-path", file, source, /["'`]\/api(?:\/|\b)/g, "/api"));
    inventory.push(
      ...evidence("window-location", file, source, /\bwindow\.location\b/g, "window.location"),
    );
    inventory.push(
      ...evidence(
        "websocket-origin",
        file,
        source,
        /\b(?:new\s+)?WebSocket\s*\(/g,
        "WebSocket construction",
      ),
    );
    inventory.push(...evidence("server-entry-path", file, source, /\bserver\.ts\b/g, "server.ts"));
    inventory.push(
      ...evidence(
        "next-output-path",
        file,
        source,
        /(?:\.next(?:\/|\b)|\.desktop-build(?:\/|\b))/g,
        ".next or .desktop-build",
      ),
    );
    inventory.push(
      ...evidence("electron-path", file, source, /(?:\belectron\/|\belectron\\)/g, "electron path"),
    );
    inventory.push(
      ...evidence(
        "dynamic-module-load",
        file,
        source,
        /\bimport\s*\(|\brequire\s*\(/g,
        "dynamic import or require",
      ),
    );
    inventory.push(
      ...evidence(
        "runtime-asset",
        file,
        source,
        /\bimport\.meta\.url\b|\b(?:readFileSync|readFile|cpSync|copyFileSync)\s*\(/g,
        "runtime-relative asset or file access",
      ),
    );
  }

  for (const file of files.filter(
    (candidate) =>
      candidate === "package.json" || /^(?:apps|packages)\/.*\/package\.json$/.test(candidate),
  )) {
    const manifest = JSON.parse(await sourceFor(repositoryRoot, file));
    for (const section of ["dependencies", "optionalDependencies", "devDependencies"]) {
      for (const packageName of Object.keys(manifest[section] ?? {}).sort()) {
        if (NATIVE_PACKAGES.has(packageName)) {
          inventory.push({
            category: "native-package",
            file,
            line: 1,
            detail: `${section}:${packageName}`,
          });
        }
      }
    }
  }
  return inventory.sort((left, right) =>
    `${left.category}\0${left.file}\0${left.line}\0${left.detail}`.localeCompare(
      `${right.category}\0${right.file}\0${right.line}\0${right.detail}`,
    ),
  );
}

export async function repositoryRevision(repositoryRoot = REPOSITORY_ROOT) {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
}

export async function phaseZeroMetadata({
  repositoryRoot = REPOSITORY_ROOT,
  files = versionControlledFiles(repositoryRoot),
  revision,
} = {}) {
  return {
    schemaVersion: 1,
    baselineRevision: revision ?? (await repositoryRevision(repositoryRoot)),
    ownership: ledgerDocument({ files }),
    migrationPathInventory: await migrationPathInventory({ repositoryRoot, files }),
  };
}

export function phaseZeroSnapshotViolations(snapshot, current) {
  const violations = [];
  if (snapshot.schemaVersion !== current.schemaVersion) {
    violations.push(
      `Phase 0 metadata schema drifted: ${snapshot.schemaVersion} != ${current.schemaVersion}`,
    );
  }
  if (JSON.stringify(snapshot.ownership) !== JSON.stringify(current.ownership)) {
    violations.push("Phase 0 ownership ledger drifted; regenerate the checked metadata snapshot.");
  }
  if (
    JSON.stringify(snapshot.migrationPathInventory) !==
    JSON.stringify(current.migrationPathInventory)
  ) {
    violations.push(
      "Phase 0 migration path inventory drifted; regenerate the checked metadata snapshot.",
    );
  }
  return violations;
}

async function main(arguments_) {
  const document = await phaseZeroMetadata();
  const writeIndex = arguments_.indexOf("--write");
  if (writeIndex >= 0) {
    const destination = arguments_[writeIndex + 1];
    if (!destination) throw new Error("--write requires a destination path");
    await writeFile(destination, `${JSON.stringify(document, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
