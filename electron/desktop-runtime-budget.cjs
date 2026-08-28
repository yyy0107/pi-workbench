const { existsSync, lstatSync, readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");

const MEBIBYTE = 1024 * 1024;
const DESKTOP_RUNTIME_BUDGET = Object.freeze({
  maxAppBytes: 250 * MEBIBYTE,
  maxDependencyPackages: 135,
  maxFileCount: 7_500,
  maxNodeModulesBytes: 110 * MEBIBYTE,
  requiredExternalPackages: Object.freeze([
    "@earendil-works/pi-coding-agent",
    "next",
    "node-pty",
    "ws",
  ]),
  requiredDynamicRuntimePackages: Object.freeze([
    "@earendil-works/pi-ai",
    "@earendil-works/pi-coding-agent",
  ]),
  requiredNativeRuntimePackages: Object.freeze(["node-pty", "tree-sitter-bash"]),
});
const PACKAGED_OUTPUT_BUDGET = Object.freeze({
  maxArtifactBytes: 300 * MEBIBYTE,
});
const FORBIDDEN_RUNTIME_PACKAGES = new Set([
  "@electron/rebuild",
  "@vercel/nft",
  "electron",
  "electron-builder",
  "esbuild",
  "sharp",
  "tsx",
  "typescript",
]);
const TEST_PATH_PATTERN = /(?:^|\/)(?:__tests__|tests?|fixtures)(?:\/|$)|\.(?:test|spec)\.[^/]+$/iu;
const TYPESCRIPT_SOURCE_PATTERN = /\.(?:[cm]?ts|tsx)$/iu;

function formatBytes(bytes) {
  return `${(bytes / MEBIBYTE).toFixed(1)} MiB`;
}

function inspectDesktopRuntime(appDirectory) {
  const normalizedAppDirectory = path.resolve(appDirectory);
  const report = {
    appBytes: 0,
    brokenSymlinks: [],
    dependencyPackages: new Set(),
    fileCount: 0,
    nodeModulesBytes: 0,
    sourceFiles: [],
    sourceMaps: [],
    testFiles: [],
  };

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path
        .relative(normalizedAppDirectory, absolutePath)
        .split(path.sep)
        .join("/");
      const stats = lstatSync(absolutePath);
      if (stats.isSymbolicLink()) {
        if (!existsSync(absolutePath)) report.brokenSymlinks.push(relativePath);
        continue;
      }
      if (stats.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!stats.isFile()) continue;

      report.fileCount += 1;
      report.appBytes += stats.size;
      if (relativePath.includes("/node_modules/")) report.nodeModulesBytes += stats.size;
      if (relativePath.endsWith(".map")) report.sourceMaps.push(relativePath);
      if (TYPESCRIPT_SOURCE_PATTERN.test(relativePath)) report.sourceFiles.push(relativePath);
      if (TEST_PATH_PATTERN.test(relativePath)) report.testFiles.push(relativePath);

      if (entry.name === "package.json" && relativePath.includes("/node_modules/")) {
        try {
          const manifest = JSON.parse(readFileSync(absolutePath, "utf8"));
          if (typeof manifest.name === "string" && typeof manifest.version === "string") {
            report.dependencyPackages.add(`${manifest.name}@${manifest.version}`);
          }
        } catch {
          // Invalid runtime package manifests will fail naturally when loaded. Budget reporting
          // remains best-effort so it can still show the other violations in one pass.
        }
      }
    }
  }

  visit(normalizedAppDirectory);
  return {
    ...report,
    dependencyPackages: [...report.dependencyPackages].sort(),
  };
}

function assertDesktopRuntimeBudget(appDirectory, budget = DESKTOP_RUNTIME_BUDGET) {
  const report = inspectDesktopRuntime(appDirectory);
  const runtimeDirectory = path.join(appDirectory, "desktop-runtime");
  const allowlistPath = path.join(runtimeDirectory, "runtime-allowlist.json");
  const rootPackage = JSON.parse(readFileSync(path.join(appDirectory, "package.json"), "utf8"));
  const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));
  const violations = [];
  const allowedAppEntries = new Set(["desktop-runtime", "electron", "package.json", "public"]);
  const allowedRuntimeEntries = new Set([
    ".next",
    "desktop-server-launcher.cjs",
    "node_modules",
    "package.json",
    "public",
    "runtime-allowlist.json",
    "server.mjs",
  ]);
  const unexpectedAppEntries = readdirSync(appDirectory).filter(
    (entry) => !allowedAppEntries.has(entry),
  );
  const unexpectedRuntimeEntries = readdirSync(runtimeDirectory).filter(
    (entry) => !allowedRuntimeEntries.has(entry),
  );

  if (Object.keys(rootPackage.dependencies ?? {}).length > 0) {
    violations.push("the staged Electron package must not declare production dependencies");
  }
  if (unexpectedAppEntries.length > 0) {
    violations.push(`unexpected staged app entries: ${unexpectedAppEntries.join(", ")}`);
  }
  if (unexpectedRuntimeEntries.length > 0) {
    violations.push(`unexpected desktop runtime entries: ${unexpectedRuntimeEntries.join(", ")}`);
  }
  if (report.appBytes > budget.maxAppBytes) {
    violations.push(
      `app size ${formatBytes(report.appBytes)} exceeds ${formatBytes(budget.maxAppBytes)}`,
    );
  }
  if (report.nodeModulesBytes > budget.maxNodeModulesBytes) {
    violations.push(
      `node_modules size ${formatBytes(report.nodeModulesBytes)} exceeds ${formatBytes(budget.maxNodeModulesBytes)}`,
    );
  }
  if (report.fileCount > budget.maxFileCount) {
    violations.push(`file count ${report.fileCount} exceeds ${budget.maxFileCount}`);
  }
  if (report.dependencyPackages.length > budget.maxDependencyPackages) {
    violations.push(
      `dependency package count ${report.dependencyPackages.length} exceeds ${budget.maxDependencyPackages}`,
    );
  }

  const externalPackages = [...(allowlist.externalPackages ?? [])].sort();
  const requiredExternalPackages = [...budget.requiredExternalPackages].sort();
  if (JSON.stringify(externalPackages) !== JSON.stringify(requiredExternalPackages)) {
    violations.push(
      `server external package whitelist changed: ${externalPackages.join(", ") || "(empty)"}`,
    );
  }
  const dynamicRuntimePackages = [...(allowlist.dynamicRuntimePackages ?? [])].sort();
  const requiredDynamicRuntimePackages = [...budget.requiredDynamicRuntimePackages].sort();
  if (JSON.stringify(dynamicRuntimePackages) !== JSON.stringify(requiredDynamicRuntimePackages)) {
    violations.push(
      `Pi dynamic runtime whitelist changed: ${dynamicRuntimePackages.join(", ") || "(empty)"}`,
    );
  }
  const nativeRuntimePackages = [...(allowlist.nativeRuntimePackages ?? [])].sort();
  const requiredNativeRuntimePackages = [...budget.requiredNativeRuntimePackages].sort();
  if (JSON.stringify(nativeRuntimePackages) !== JSON.stringify(requiredNativeRuntimePackages)) {
    violations.push(
      `native runtime whitelist changed: ${nativeRuntimePackages.join(", ") || "(empty)"}`,
    );
  }
  const forbiddenPackages = report.dependencyPackages.filter((item) =>
    FORBIDDEN_RUNTIME_PACKAGES.has(item.slice(0, item.lastIndexOf("@"))),
  );
  if (forbiddenPackages.length > 0) {
    violations.push(`build-only packages entered the runtime: ${forbiddenPackages.join(", ")}`);
  }
  if (report.sourceMaps.length > 0) {
    violations.push(`source maps are present (${report.sourceMaps.length})`);
  }
  if (report.sourceFiles.length > 0) {
    violations.push(`TypeScript source files are present (${report.sourceFiles.length})`);
  }
  if (report.testFiles.length > 0) {
    violations.push(`test or fixture files are present (${report.testFiles.length})`);
  }
  if (report.brokenSymlinks.length > 0) {
    violations.push(`broken runtime symlinks are present (${report.brokenSymlinks.length})`);
  }

  if (violations.length > 0) {
    const details = [
      "Desktop runtime budget failed:",
      ...violations.map((violation) => `- ${violation}`),
    ].join("\n");
    throw new Error(details);
  }

  return report;
}

function findPackagedAppDirectories(outputDirectory, maxDepth = 6) {
  const results = [];
  function visit(directory, depth) {
    if (existsSync(path.join(directory, "desktop-runtime", "runtime-allowlist.json"))) {
      results.push(directory);
      return;
    }
    if (depth >= maxDepth) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) visit(path.join(directory, entry.name), depth + 1);
    }
  }
  visit(path.resolve(outputDirectory), 0);
  return results;
}

function assertPackagedOutputBudget(
  outputDirectory,
  { requireArtifact = false, runtimeBudget = DESKTOP_RUNTIME_BUDGET } = {},
) {
  const appDirectories = findPackagedAppDirectories(outputDirectory);
  if (appDirectories.length === 0) {
    throw new Error(`No packaged desktop app was found under ${outputDirectory}.`);
  }
  const appDirectory = appDirectories.sort(
    (left, right) => lstatSync(right).mtimeMs - lstatSync(left).mtimeMs,
  )[0];
  const runtimeReport = assertDesktopRuntimeBudget(appDirectory, runtimeBudget);
  const artifactPattern = /\.(?:appimage|dmg|exe|zip)$/iu;
  const artifacts = readdirSync(outputDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && artifactPattern.test(entry.name))
    .map((entry) => {
      const artifactPath = path.join(outputDirectory, entry.name);
      return { path: artifactPath, stats: lstatSync(artifactPath) };
    })
    .sort((left, right) => right.stats.mtimeMs - left.stats.mtimeMs);
  if (requireArtifact && artifacts.length === 0) {
    throw new Error(`No desktop distribution artifact was found under ${outputDirectory}.`);
  }
  const artifact = requireArtifact ? artifacts[0] : undefined;
  if (artifact && artifact.stats.size > PACKAGED_OUTPUT_BUDGET.maxArtifactBytes) {
    throw new Error(
      `Desktop artifact ${path.basename(artifact.path)} is ${formatBytes(artifact.stats.size)}; budget is ${formatBytes(PACKAGED_OUTPUT_BUDGET.maxArtifactBytes)}.`,
    );
  }
  return {
    appDirectory,
    artifactBytes: artifact?.stats.size,
    artifactPath: artifact?.path,
    runtimeReport,
  };
}

module.exports = {
  DESKTOP_RUNTIME_BUDGET,
  FORBIDDEN_RUNTIME_PACKAGES,
  PACKAGED_OUTPUT_BUDGET,
  assertDesktopRuntimeBudget,
  assertPackagedOutputBudget,
  findPackagedAppDirectories,
  formatBytes,
  inspectDesktopRuntime,
};
