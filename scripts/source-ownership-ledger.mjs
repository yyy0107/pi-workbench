import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;
const TEST_FILE = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/;
const ROOT_NON_PRODUCT_SOURCE_DIRECTORIES = Object.freeze([
  ".agents",
  ".github",
  "apps",
  "docs",
  "node_modules",
  "packages",
  "public",
  "run_scripts",
  "scripts",
]);

function normalized(relativeFile) {
  return relativeFile.split(path.sep).join("/");
}

/**
 * Returns version-controlled working-tree candidates: indexed files plus non-ignored untracked
 * files. Including both makes the guard stable before and after `git add` while still excluding
 * generated/ignored output. A committed Phase 0 baseline remains a subset of this candidate set.
 */
export function versionControlledFiles(repositoryRoot = REPOSITORY_ROOT) {
  const candidates = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: repositoryRoot, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean)
    .map(normalized);
  const deleted = new Set(
    execFileSync("git", ["ls-files", "--deleted", "-z"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    })
      .split("\0")
      .filter(Boolean)
      .map(normalized),
  );
  return [...new Set(candidates)].filter((file) => !deleted.has(file)).sort();
}

export function isRootProductionSource(relativeFile) {
  const file = normalized(relativeFile);
  if (!SOURCE_FILE.test(file) || TEST_FILE.test(file)) return false;
  return !ROOT_NON_PRODUCT_SOURCE_DIRECTORIES.some(
    (directory) => file === directory || file.startsWith(`${directory}/`),
  );
}

/**
 * Classifies a repository-relative import or file-read target before extension resolution.
 * Unknown root paths are production by default so a newly introduced owner cannot bypass the
 * ledger merely by living outside one of the legacy source directories.
 */
export function isRootProductionSourceReference(relativeReference) {
  const file = normalized(relativeReference)
    .replace(/^@\//u, "")
    .replace(/[?#].*$/u, "")
    .replace(/^\.\//u, "");
  if (!file || file === "." || file === ".." || file.startsWith("../")) return false;
  if (
    ROOT_NON_PRODUCT_SOURCE_DIRECTORIES.some(
      (directory) => file === directory || file.startsWith(`${directory}/`),
    )
  ) {
    return false;
  }
  const extension = path.posix.extname(file);
  if (extension && !SOURCE_FILE.test(file)) return false;
  return !TEST_FILE.test(file);
}

function recordFor(relativeFile) {
  const file = normalized(relativeFile);
  if (file.startsWith("electron/")) {
    return {
      environment: "desktop",
      consumers: ["desktop-electron"],
      targetOwner: "apps/desktop-electron",
      migrationPhase: 7,
    };
  }
  if (file.startsWith("runtime/server/http/")) {
    return {
      environment: "node",
      consumers: ["runtime-node"],
      targetOwner: "packages/host/server",
      migrationPhase: 2,
    };
  }
  if (file.startsWith("runtime/server/automations/")) {
    return {
      environment: "node",
      consumers: ["runtime-node"],
      targetOwner: "packages/server/automation",
      migrationPhase: 2,
    };
  }
  if (file.startsWith("runtime/server/settings/")) {
    return {
      environment: "node",
      consumers: ["runtime-node"],
      targetOwner: "packages/server/settings",
      migrationPhase: 2,
    };
  }
  if (file.startsWith("runtime/server/workbench-server-shutdown")) {
    return {
      environment: "node",
      consumers: ["runtime-node"],
      targetOwner: "apps/runtime-node",
      migrationPhase: 4,
    };
  }
  if (
    file === "runtime/server/installed-api-only-runtime-host.ts" ||
    file === "runtime/server/installed-runtime-service.ts" ||
    file === "runtime/server/runtime-control-stdout.ts" ||
    file === "runtime/server/runtime-rpc-warmup.ts"
  ) {
    return {
      environment: "node",
      consumers: ["runtime-node"],
      targetOwner: "apps/runtime-node",
      migrationPhase: 4,
    };
  }
  if (file.startsWith("runtime/")) {
    return {
      environment: "node",
      consumers: ["runtime-node"],
      targetOwner: "packages/server/core",
      migrationPhase: 2,
    };
  }
  return undefined;
}

export function sourceOwnershipLedger({ files = versionControlledFiles() } = {}) {
  const records = files
    .filter(isRootProductionSource)
    .map((file) => ({ file, ...recordFor(file) }));
  return records.sort((left, right) => left.file.localeCompare(right.file));
}

export function ownershipViolations(records) {
  const seen = new Set();
  const violations = [];
  for (const record of records) {
    if (seen.has(record.file)) violations.push(`duplicate ownership record: ${record.file}`);
    seen.add(record.file);
    for (const field of ["environment", "targetOwner", "migrationPhase"]) {
      if (record[field] === undefined || record[field] === "") {
        violations.push(`unassigned ${field}: ${record.file}`);
      }
    }
    if (!Array.isArray(record.consumers) || record.consumers.length === 0) {
      violations.push(`unassigned consumers: ${record.file}`);
    }
  }
  return violations;
}

export function sourceClosureViolations({
  files = versionControlledFiles(),
  mode = "phase-0",
  ledger,
} = {}) {
  if (mode !== "phase-0" && mode !== "strict")
    throw new Error(`Unknown source closure mode: ${mode}`);
  const ledgerFiles = new Set(
    (ledger ?? sourceOwnershipLedger({ files })).map((record) => record.file),
  );
  const violations = [];
  for (const file of files.filter(isRootProductionSource)) {
    if (mode === "strict" && !file.startsWith("apps/") && !file.startsWith("packages/")) {
      violations.push(`root production source is forbidden in strict mode: ${file}`);
    } else if (mode === "phase-0" && !ledgerFiles.has(file)) {
      violations.push(`root production source is missing from the ownership ledger: ${file}`);
    }
  }
  return violations;
}

export function ledgerDocument({ files = versionControlledFiles() } = {}) {
  const ledger = sourceOwnershipLedger({ files });
  const violations = ownershipViolations(ledger);
  if (violations.length > 0) throw new Error(violations.join("\n"));
  return { schemaVersion: 1, records: ledger };
}

async function main(arguments_) {
  const document = ledgerDocument();
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
