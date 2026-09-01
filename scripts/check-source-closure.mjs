import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isRootProductionSourceReference,
  sourceClosureViolations,
  versionControlledFiles,
} from "./source-ownership-ledger.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/u;
const TEST_OR_FIXTURE_FILE = /\.(?:bench|fixture|spec|test)\.(?:[cm]?[jt]sx?)$/u;
const TEST_OR_FIXTURE_SEGMENTS = new Set([
  "__fixtures__",
  "__tests__",
  "fixtures",
  "test",
  "test-fixtures",
  "tests",
]);
const NON_PRODUCT_EVIDENCE_ROOTS = new Set([".agents", ".github", "docs"]);
const STRICT_CLOSURE_PREFIX = "root production source is forbidden in strict mode: ";

/** Root owners removed by the Milestone A Apps/Packages migration. */
export const FORBIDDEN_LEGACY_PRODUCTION_ROOTS = Object.freeze([
  "app",
  "components",
  "electron",
  "extensions",
  "hooks",
  "i18n",
  "lib",
  "platform",
  "runtime",
  "services",
  "stores",
  "test-utils",
  "workbench",
]);

export const FORBIDDEN_RUNTIME_ROUTE_SOURCE_PATHS = Object.freeze([
  "apps/web/src/app/api/[rpc]/route.ts",
  "apps/web/src/app/api/pi/models/route.ts",
  "apps/web/src/app/api/pi/running/events/route.ts",
  "apps/web/src/app/api/pi/sessions/[id]/commands/route.ts",
  "apps/web/src/app/api/pi/sessions/[id]/events/route.ts",
  "apps/web/src/app/api/pi/sessions/[id]/route.ts",
  "apps/web/src/app/api/pi/sessions/route.ts",
  "apps/web/src/app/api/pi/workspaces/pick/route.ts",
  "apps/web/src/app/api/session.export/route.ts",
  "apps/web/src/app/api/workspace.files.content/route.ts",
]);

/** Exact removed entries whose path is meaningful even inside an otherwise valid app/package. */
export const FORBIDDEN_TRANSITION_SOURCE_PATHS = Object.freeze([
  "server.ts",
  "apps/web/src/server.ts",
  "apps/web/src/server/runtime-api-route-delegator.ts",
  ...FORBIDDEN_RUNTIME_ROUTE_SOURCE_PATHS,
]);

/** Unique transition names may not be restored under a different production owner. */
export const FORBIDDEN_TRANSITION_SOURCE_BASENAMES = Object.freeze([
  "build-desktop-server.cjs",
  "desktop-server-launcher.cjs",
  "development-external-runtime-main.ts",
  "development-external-runtime.ts",
  "development-web-control.ts",
  "runtime-api-route-delegator.ts",
]);

function normalized(relativeFile) {
  return relativeFile.split(path.sep).join("/").replace(/^\.\//u, "");
}

function isTestOrFixturePath(relativeFile) {
  const file = normalized(relativeFile);
  if (TEST_OR_FIXTURE_FILE.test(file)) return true;
  return file.split("/").some((segment) => TEST_OR_FIXTURE_SEGMENTS.has(segment));
}

function isHistoricalEvidencePath(relativeFile) {
  const [root] = normalized(relativeFile).split("/");
  return NON_PRODUCT_EVIDENCE_ROOTS.has(root);
}

function legacyRootFor(relativeFile) {
  const file = normalized(relativeFile);
  return FORBIDDEN_LEGACY_PRODUCTION_ROOTS.find(
    (root) => file === root || file.startsWith(`${root}/`),
  );
}

function isWorkspaceProductionSource(relativeFile) {
  const file = normalized(relativeFile);
  return (
    (file.startsWith("apps/") || file.startsWith("packages/")) &&
    SOURCE_FILE.test(file) &&
    !isTestOrFixturePath(file)
  );
}

function transitionViolation(relativeFile) {
  return `removed transition production source is forbidden: ${relativeFile}`;
}

function legacyRootViolation(relativeFile) {
  return `removed legacy production source is forbidden: ${relativeFile}`;
}

function rootSourceViolation(relativeFile) {
  return `production source must be owned by apps/** or packages/**: ${relativeFile}`;
}

function sourceSymlinkViolation(relativeFile) {
  return `production source symlink is forbidden: ${relativeFile}`;
}

/**
 * Closes the Phase 0 ownership ledger without parsing source a second time. Tests/fixtures and
 * historical evidence are path-scoped non-production inputs; everything else uses the ledger's
 * production-extension classifier and strict Apps/Packages closure.
 */
export function permanentSourceClosureViolations({ files, symbolicLinks = [] } = {}) {
  if (!Array.isArray(files)) throw new Error("Permanent source closure requires a file inventory.");
  const candidates = [...new Set(files.map(normalized))].sort();
  const symbolicLinkSet = new Set(symbolicLinks.map(normalized));
  const productionCandidates = candidates.filter((file) => !isTestOrFixturePath(file));
  const transitionPaths = new Set(FORBIDDEN_TRANSITION_SOURCE_PATHS);
  const transitionBasenames = new Set(FORBIDDEN_TRANSITION_SOURCE_BASENAMES);
  const violations = [];

  for (const violation of sourceClosureViolations({
    files: productionCandidates,
    mode: "strict",
  })) {
    if (!violation.startsWith(STRICT_CLOSURE_PREFIX)) {
      violations.push(violation);
      continue;
    }
    const file = violation.slice(STRICT_CLOSURE_PREFIX.length);
    if (transitionPaths.has(file)) violations.push(transitionViolation(file));
    else if (legacyRootFor(file)) violations.push(legacyRootViolation(file));
    else violations.push(rootSourceViolation(file));
  }

  for (const file of candidates) {
    if (isTestOrFixturePath(file) || isHistoricalEvidencePath(file)) continue;
    if (transitionPaths.has(file)) violations.push(transitionViolation(file));
    if (transitionBasenames.has(path.posix.basename(file))) {
      violations.push(transitionViolation(file));
    }

    if (!symbolicLinkSet.has(file)) continue;
    const legacyRoot = legacyRootFor(file);
    if (legacyRoot) {
      violations.push(
        file === legacyRoot
          ? `removed legacy production root is forbidden: ${file}`
          : legacyRootViolation(file),
      );
      continue;
    }
    if (
      isWorkspaceProductionSource(file) ||
      /^(?:apps|packages)\/.+\/src(?:\/|$)/u.test(file) ||
      isRootProductionSourceReference(file)
    ) {
      violations.push(sourceSymlinkViolation(file));
    }
  }

  return [...new Set(violations)].sort();
}

export function repositorySourceClosureViolations(repositoryRoot = REPOSITORY_ROOT) {
  const files = versionControlledFiles(repositoryRoot);
  const symbolicLinks = files.filter((file) =>
    lstatSync(path.join(repositoryRoot, ...file.split("/"))).isSymbolicLink(),
  );
  return permanentSourceClosureViolations({ files, symbolicLinks });
}

export function checkSourceClosure(repositoryRoot = REPOSITORY_ROOT) {
  const violations = repositorySourceClosureViolations(repositoryRoot);
  if (violations.length === 0) return;
  throw new Error(
    `Permanent source closure violations:\n${violations.map((item) => `- ${item}`).join("\n")}`,
  );
}

const invokedFile = process.argv[1] ? realpathSync(process.argv[1]) : undefined;
if (invokedFile === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    checkSourceClosure();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
