const {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} = require("node:fs");
const { createHash } = require("node:crypto");
const { createRequire } = require("node:module");
const path = require("node:path");

const { nodeFileTrace } = require("@vercel/nft");

const { assertDesktopRuntimeBudget, formatBytes } = require("./desktop-runtime-budget.cjs");
const { runNodeScript } = require("./process-runner.cjs");

const projectRoot = path.resolve(__dirname, "..");
const stagingRoot = path.join(projectRoot, ".electron-build");
const appDirectory = path.join(stagingRoot, "app");
const runtimeDirectory = path.join(appDirectory, "desktop-runtime");
const nextBuildDirectory = path.join(projectRoot, ".next");
const nextStandaloneDirectory = path.join(nextBuildDirectory, "standalone");
const compiledServerDirectory = path.join(projectRoot, ".desktop-build");
const compiledServerPath = path.join(compiledServerDirectory, "server.mjs");
const compiledAllowlistPath = path.join(compiledServerDirectory, "runtime-allowlist.json");
const ELECTRON_RUNTIME_FILES = Object.freeze([
  "main.cjs",
  "preload.cjs",
  "server-probe.cjs",
  "server-process-lifecycle.cjs",
  "server-startup-handshake.cjs",
]);
const PI_DYNAMIC_RUNTIME_PACKAGES = Object.freeze([
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
]);
const REQUIRED_FILE_VIEWER_PRESENTATION_ASSETS = Object.freeze([
  "vendor/ppt/index.mjs",
  "vendor/ppt/worker.mjs",
  "vendor/ppt/ppt-native.wasm",
  "vendor/ppt/ppt-font-cjk.otf",
  "vendor/pptx/pptx.worker.js",
]);

function copyFileInto(sourcePath, destinationPath) {
  mkdirSync(path.dirname(destinationPath), { recursive: true });
  copyFileSync(sourcePath, destinationPath);
}

function copyTracedPath(relativePath, destinationRoot) {
  const sourcePath = path.join(projectRoot, relativePath);
  const destinationPath = path.join(destinationRoot, relativePath);
  const sourceStats = lstatSync(sourcePath);
  mkdirSync(path.dirname(destinationPath), { recursive: true });

  if (sourceStats.isSymbolicLink()) {
    if (
      existsSync(destinationPath) ||
      (() => {
        try {
          lstatSync(destinationPath);
          return true;
        } catch {
          return false;
        }
      })()
    ) {
      const destinationStats = lstatSync(destinationPath);
      if (destinationStats.isDirectory() && !destinationStats.isSymbolicLink()) return;
      if (
        destinationStats.isSymbolicLink() &&
        readlinkSync(destinationPath) === readlinkSync(sourcePath)
      ) {
        return;
      }
      rmSync(destinationPath, { force: true, recursive: true });
    }
    symlinkSync(readlinkSync(sourcePath), destinationPath);
    return;
  }

  if (sourceStats.isDirectory()) {
    mkdirSync(destinationPath, { recursive: true });
    return;
  }
  copyFileSync(sourcePath, destinationPath);
}

function isNextPackageTracePath(relativePath) {
  const normalized = relativePath.split(path.sep).join("/");
  return (
    normalized === "node_modules/next" ||
    normalized.startsWith("node_modules/next/") ||
    normalized.includes("/node_modules/next/")
  );
}

function isAllowedTraceWarning(warning) {
  const message = String(warning);
  return (
    message.includes('Failed to resolve dependency "bufferutil"') ||
    message.includes('Failed to resolve dependency "utf-8-validate"') ||
    (message.includes("@earendil-works+pi-ai") &&
      message.includes("Cannot use 'import.meta' outside a module"))
  );
}

async function mergeCustomServerTrace() {
  const result = await nodeFileTrace([compiledServerPath], {
    base: projectRoot,
    conditions: ["node", "production"],
    exportsOnly: true,
    ignore: isNextPackageTracePath,
    processCwd: projectRoot,
  });
  const unexpectedWarnings = [...result.warnings].filter(
    (warning) => !isAllowedTraceWarning(warning),
  );
  if (unexpectedWarnings.length > 0) {
    throw new Error(
      `Custom server dependency tracing produced unexpected warnings:\n${unexpectedWarnings.join("\n")}`,
    );
  }

  const tracedFiles = [...result.fileList]
    .map((file) => file.split(path.sep).join("/"))
    .filter((file) => file !== ".desktop-build/server.mjs" && !isNextPackageTracePath(file))
    .sort();
  for (const file of tracedFiles) copyTracedPath(file, runtimeDirectory);
  return tracedFiles;
}

function resolvedPackageDirectory(packageName) {
  const installedPackagePath = path.join(projectRoot, "node_modules", ...packageName.split("/"));
  if (existsSync(installedPackagePath)) return realpathSync(installedPackagePath);

  try {
    return path.dirname(require.resolve(`${packageName}/package.json`));
  } catch (error) {
    if (error?.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;
  }

  let directory = path.dirname(require.resolve(packageName));
  while (directory !== path.dirname(directory)) {
    const manifestPath = path.join(directory, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (manifest.name === packageName) return directory;
    }
    directory = path.dirname(directory);
  }
  throw new Error(`Could not find package root for ${packageName}.`);
}

function completeNextModuleSyncRuntime() {
  // Node 22+ selects @swc/helpers' `module-sync` export when Next is loaded through the custom
  // server. Next's generated CommonJS standalone entry traces only the default CJS branch, so add
  // the other published runtime branch and its one dependency explicitly.
  const nextSourceDirectory = resolvedPackageDirectory("next");
  const requireFromNextSource = createRequire(path.join(nextSourceDirectory, "package.json"));
  const swcHelpersSourceDirectory = path.dirname(
    requireFromNextSource.resolve("@swc/helpers/package.json"),
  );
  const requireFromSwcHelpers = createRequire(path.join(swcHelpersSourceDirectory, "package.json"));
  const tslibSourceDirectory = path.dirname(requireFromSwcHelpers.resolve("tslib/package.json"));

  const nextRuntimeDirectory = path.join(runtimeDirectory, "node_modules", "next");
  const swcHelpersRuntimeLink = path.join(
    path.dirname(realpathSync(nextRuntimeDirectory)),
    "@swc",
    "helpers",
  );
  const swcHelpersRuntimeDirectory = path.resolve(
    path.dirname(swcHelpersRuntimeLink),
    readlinkSync(swcHelpersRuntimeLink),
  );
  cpSync(swcHelpersSourceDirectory, swcHelpersRuntimeDirectory, {
    dereference: true,
    recursive: true,
  });
  cpSync(tslibSourceDirectory, path.join(runtimeDirectory, "node_modules", "tslib"), {
    dereference: true,
    recursive: true,
  });
}

function completeDynamicPackageRuntime(packageName) {
  // Pi intentionally uses variable dynamic imports for extension/provider loading. Static tracing
  // cannot enumerate every internal module name, so keep the package's published dist tree while
  // still pruning declarations, maps, tests, and documentation below.
  const sourceDirectory = resolvedPackageDirectory(packageName);
  const runtimeLink = path.join(runtimeDirectory, "node_modules", ...packageName.split("/"));
  const destinationDirectory = realpathSync(runtimeLink);
  cpSync(sourceDirectory, destinationDirectory, {
    dereference: true,
    recursive: true,
  });
}

function stageNodePtyBuildInputs() {
  const nodeModulesDirectory = path.join(runtimeDirectory, "node_modules");
  const pnpmDirectory = path.join(nodeModulesDirectory, ".pnpm");
  const nodePtyDirectory = path.join(nodeModulesDirectory, "node-pty");
  const nodeAddonApiDirectory = path.join(nodeModulesDirectory, "node-addon-api");
  const nodePtySourceDirectory = resolvedPackageDirectory("node-pty");
  const requireFromNodePty = createRequire(path.join(nodePtySourceDirectory, "package.json"));
  const nodeAddonApiSourceDirectory = path.dirname(
    requireFromNodePty.resolve("node-addon-api/package.json"),
  );
  rmSync(nodePtyDirectory, { force: true, recursive: true });
  rmSync(nodeAddonApiDirectory, { force: true, recursive: true });
  if (existsSync(pnpmDirectory)) {
    for (const entry of readdirSync(pnpmDirectory, { withFileTypes: true })) {
      if (entry.name.startsWith("node-pty@")) {
        rmSync(path.join(pnpmDirectory, entry.name), { force: true, recursive: true });
      }
    }
  }
  cpSync(nodePtySourceDirectory, nodePtyDirectory, {
    dereference: true,
    recursive: true,
  });
  cpSync(nodeAddonApiSourceDirectory, nodeAddonApiDirectory, {
    dereference: true,
    recursive: true,
  });

  // Next emits hashed aliases for serverExternalPackages. Keep that generated alias valid while
  // materializing node-pty as a flat package so electron-rebuild sees one complete source tree.
  const nextAliasDirectory = path.join(runtimeDirectory, ".next", "node_modules");
  if (existsSync(nextAliasDirectory)) {
    for (const entry of readdirSync(nextAliasDirectory, { withFileTypes: true })) {
      if (!entry.isSymbolicLink() || !entry.name.startsWith("node-pty-")) continue;
      const aliasPath = path.join(nextAliasDirectory, entry.name);
      const aliasTarget = path.resolve(nextAliasDirectory, readlinkSync(aliasPath));
      mkdirSync(path.dirname(aliasTarget), { recursive: true });
      symlinkSync(path.relative(path.dirname(aliasTarget), nodePtyDirectory), aliasTarget);
    }
  }
}

function rebuildNodePty() {
  stageNodePtyBuildInputs();
  const electronVersion = require("electron/package.json").version;
  const electronRebuildCli = path.join(
    path.dirname(require.resolve("@electron/rebuild")),
    "cli.js",
  );
  runNodeScript(
    electronRebuildCli,
    [
      "--force",
      "--only",
      "node-pty",
      "--module-dir",
      runtimeDirectory,
      "--version",
      electronVersion,
    ],
    {
      cwd: projectRoot,
      env: process.env,
      label: "electron-rebuild",
      stdio: "inherit",
    },
  );
  rmSync(path.join(runtimeDirectory, "node_modules", "node-addon-api"), {
    force: true,
    recursive: true,
  });
}

function pruneNodePty() {
  const packageDirectory = path.join(runtimeDirectory, "node_modules", "node-pty");
  for (const item of ["binding.gyp", "deps", "scripts", "src", "third_party", "typings"]) {
    rmSync(path.join(packageDirectory, item), { force: true, recursive: true });
  }
  for (const item of ["Makefile", "binding.Makefile", "config.gypi", "pty.target.mk"]) {
    rmSync(path.join(packageDirectory, "build", item), { force: true });
  }
  rmSync(path.join(packageDirectory, "build", "Release", "obj.target"), {
    force: true,
    recursive: true,
  });

  const currentPlatform = `${process.platform}-${process.arch}`;
  for (const parent of ["prebuilds", "bin"]) {
    const directory = path.join(packageDirectory, parent);
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.name.startsWith(currentPlatform)) {
        rmSync(path.join(directory, entry.name), { force: true, recursive: true });
      }
    }
  }
}

function pruneTreeSitterBash() {
  const packageDirectory = realpathSync(
    path.join(runtimeDirectory, "node_modules", "tree-sitter-bash"),
  );
  const currentPlatform = `${process.platform}-${process.arch}`;
  const prebuildsDirectory = path.join(packageDirectory, "prebuilds");
  const currentPrebuildDirectory = path.join(prebuildsDirectory, currentPlatform);
  const currentPrebuild = path.join(currentPrebuildDirectory, "tree-sitter-bash.node");

  if (!existsSync(currentPrebuild)) {
    throw new Error(`tree-sitter-bash has no prebuild for ${currentPlatform}.`);
  }

  for (const item of [
    "bin",
    "binding.gyp",
    "build",
    "grammar.js",
    "tree-sitter-bash.wasm",
    "tree-sitter.json",
  ]) {
    rmSync(path.join(packageDirectory, item), { force: true, recursive: true });
  }
  for (const entry of readdirSync(prebuildsDirectory, { withFileTypes: true })) {
    if (entry.name !== currentPlatform) {
      rmSync(path.join(prebuildsDirectory, entry.name), { force: true, recursive: true });
    }
  }

  // bindings/node adds this metadata to the loaded grammar when available. Keep it, but remove the
  // generated parser and C build inputs that are unnecessary once the N-API binary is selected.
  const sourceDirectory = path.join(packageDirectory, "src");
  for (const entry of readdirSync(sourceDirectory, { withFileTypes: true })) {
    if (entry.name !== "node-types.json") {
      rmSync(path.join(sourceDirectory, entry.name), { force: true, recursive: true });
    }
  }
}

function shouldRemoveRuntimeFile(relativePath) {
  const normalized = relativePath.split(path.sep).join("/");
  const basename = path.posix.basename(normalized);
  return (
    normalized.endsWith(".map") ||
    normalized.endsWith(".pdb") ||
    /\.(?:[cm]?ts|tsx)$/iu.test(normalized) ||
    /(?:^|\/)(?:__tests__|tests?|fixtures)(?:\/|$)/iu.test(normalized) ||
    /\.(?:test|spec)\.[^/]+$/iu.test(normalized) ||
    /^(?:readme|changelog)(?:\.(?:md|markdown|rst|txt))?$/iu.test(basename)
  );
}

function pruneRuntimeTree(directory, root = directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(root, absolutePath);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (/^(?:__tests__|fixtures|tests?)$/iu.test(entry.name)) {
        rmSync(absolutePath, { force: true, recursive: true });
        continue;
      }
      pruneRuntimeTree(absolutePath, root);
      if (readdirSync(absolutePath).length === 0) rmSync(absolutePath, { recursive: true });
      continue;
    }
    if (entry.isFile() && shouldRemoveRuntimeFile(relativePath)) rmSync(absolutePath);
  }
}

function pruneRuntimeTopLevel() {
  const allowedEntries = new Set([
    ".next",
    "desktop-server-launcher.cjs",
    "node_modules",
    "package.json",
    "public",
    "runtime-allowlist.json",
    "server.mjs",
  ]);
  for (const entry of readdirSync(runtimeDirectory, { withFileTypes: true })) {
    if (allowedEntries.has(entry.name)) continue;
    rmSync(path.join(runtimeDirectory, entry.name), { force: true, recursive: true });
  }
}

function collectRegularFiles(directory, files = []) {
  if (!existsSync(directory)) return files;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectRegularFiles(absolutePath, files);
    else if (entry.isFile()) files.push(absolutePath);
  }
  return files;
}

function contentDigest(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function pruneDuplicatedFileViewerAssets() {
  const publicRoot = path.join(runtimeDirectory, "public", "file-viewer");
  const staticMediaRoot = path.join(runtimeDirectory, ".next", "static", "media");
  for (const relativePath of REQUIRED_FILE_VIEWER_PRESENTATION_ASSETS) {
    if (!existsSync(path.join(publicRoot, relativePath))) {
      throw new Error(`Missing canonical File Viewer asset: public/file-viewer/${relativePath}`);
    }
  }

  const publicAssetsByDigest = new Map();
  for (const filePath of collectRegularFiles(publicRoot)) {
    publicAssetsByDigest.set(contentDigest(filePath), filePath);
  }

  const removed = [];
  for (const filePath of collectRegularFiles(staticMediaRoot)) {
    const canonicalPath = publicAssetsByDigest.get(contentDigest(filePath));
    if (!canonicalPath) continue;
    const bytes = lstatSync(filePath).size;
    rmSync(filePath);
    removed.push({
      bytes,
      emitted: path.relative(runtimeDirectory, filePath).split(path.sep).join("/"),
      canonical: path.relative(runtimeDirectory, canonicalPath).split(path.sep).join("/"),
    });
  }
  return removed.sort((left, right) => left.emitted.localeCompare(right.emitted));
}

function pruneNextImageOptimizer() {
  const requiredServerFiles = JSON.parse(
    readFileSync(path.join(nextBuildDirectory, "required-server-files.json"), "utf8"),
  );
  if (requiredServerFiles.config?.images?.unoptimized !== true) {
    throw new Error(
      "Refusing to remove sharp while the production Next config still enables image optimization.",
    );
  }

  const nodeModulesDirectory = path.join(runtimeDirectory, "node_modules");
  const pnpmDirectory = path.join(nodeModulesDirectory, ".pnpm");
  const removed = [];
  if (existsSync(pnpmDirectory)) {
    for (const entry of readdirSync(pnpmDirectory, { withFileTypes: true })) {
      if (!/^(?:sharp@|@img\+(?:colour|sharp-))/u.test(entry.name)) continue;
      rmSync(path.join(pnpmDirectory, entry.name), { force: true, recursive: true });
      removed.push(entry.name);
    }
  }

  function removePackageLinks(directory) {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      const isSharpPackage = entry.name === "sharp";
      const isSharpSupportPackage =
        path.basename(directory) === "@img" &&
        (entry.name === "colour" || entry.name.startsWith("sharp-"));
      if (isSharpPackage || isSharpSupportPackage) {
        rmSync(absolutePath, { force: true, recursive: true });
        continue;
      }
      if (entry.isDirectory() && !entry.isSymbolicLink()) removePackageLinks(absolutePath);
    }
  }

  removePackageLinks(nodeModulesDirectory);
  return removed.sort();
}

function writeMinimalPackageFiles(projectPackage) {
  writeFileSync(
    path.join(appDirectory, "package.json"),
    `${JSON.stringify(
      {
        name: projectPackage.name,
        version: projectPackage.version,
        private: true,
        license: projectPackage.license,
        main: "electron/main.cjs",
        productName: projectPackage.productName,
        desktopName: projectPackage.desktopName,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(runtimeDirectory, "package.json"),
    `${JSON.stringify(
      {
        name: `${projectPackage.name}-desktop-runtime`,
        version: projectPackage.version,
        private: true,
      },
      null,
      2,
    )}\n`,
  );
}

async function preparePackage() {
  if (!existsSync(path.join(nextBuildDirectory, "BUILD_ID"))) {
    throw new Error("Missing .next production output. Run `pnpm build` before packaging Electron.");
  }
  if (!existsSync(nextStandaloneDirectory)) {
    throw new Error('Missing .next/standalone. Keep `output: "standalone"` enabled and rebuild.');
  }
  if (!existsSync(compiledServerPath) || !existsSync(compiledAllowlistPath)) {
    throw new Error(
      "Missing precompiled desktop server. Run `pnpm build` before packaging Electron.",
    );
  }

  const projectPackage = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  const compiledAllowlist = JSON.parse(readFileSync(compiledAllowlistPath, "utf8"));
  rmSync(stagingRoot, { force: true, recursive: true });
  mkdirSync(runtimeDirectory, { recursive: true });

  // Next's output tracing is the base runtime whitelist. The custom server trace below adds only
  // packages that the compiled Node entry imports beyond the Next route graph.
  cpSync(nextStandaloneDirectory, runtimeDirectory, {
    recursive: true,
    verbatimSymlinks: true,
  });
  cpSync(path.join(projectRoot, "public"), path.join(runtimeDirectory, "public"), {
    recursive: true,
  });
  cpSync(path.join(nextBuildDirectory, "static"), path.join(runtimeDirectory, ".next", "static"), {
    recursive: true,
  });
  copyFileInto(compiledServerPath, path.join(runtimeDirectory, "server.mjs"));
  copyFileInto(
    path.join(__dirname, "desktop-server-launcher.cjs"),
    path.join(runtimeDirectory, "desktop-server-launcher.cjs"),
  );
  rmSync(path.join(runtimeDirectory, "server.js"), { force: true });

  const tracedFiles = await mergeCustomServerTrace();
  completeNextModuleSyncRuntime();
  for (const packageName of PI_DYNAMIC_RUNTIME_PACKAGES) {
    completeDynamicPackageRuntime(packageName);
  }
  rebuildNodePty();
  pruneNodePty();
  pruneTreeSitterBash();
  pruneRuntimeTopLevel();
  pruneRuntimeTree(runtimeDirectory);
  rmSync(path.join(runtimeDirectory, ".next", "cache"), { force: true, recursive: true });
  rmSync(path.join(runtimeDirectory, ".next", "diagnostics"), { force: true, recursive: true });
  rmSync(path.join(runtimeDirectory, ".next", "trace"), { force: true });
  const prunedDuplicateViewerAssets = pruneDuplicatedFileViewerAssets();
  const prunedImageOptimizerPackages = pruneNextImageOptimizer();

  for (const file of ELECTRON_RUNTIME_FILES) {
    copyFileInto(path.join(__dirname, file), path.join(appDirectory, "electron", file));
  }
  copyFileInto(
    path.join(projectRoot, "public", "icon.png"),
    path.join(appDirectory, "public", "icon.png"),
  );
  writeMinimalPackageFiles(projectPackage);
  writeFileSync(
    path.join(runtimeDirectory, "runtime-allowlist.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        nextRuntime: ".next/standalone output file trace",
        serverEntrypoint: "server.mjs",
        externalPackages: compiledAllowlist.externalPackages,
        customServerFiles: tracedFiles,
        dynamicRuntimePackages: PI_DYNAMIC_RUNTIME_PACKAGES,
        prunedDuplicateViewerAssets,
        prunedImageOptimizerPackages,
        electronFiles: ELECTRON_RUNTIME_FILES.map((file) => `electron/${file}`),
        nativeRuntimePackages: ["node-pty", "tree-sitter-bash"],
      },
      null,
      2,
    )}\n`,
  );

  const report = assertDesktopRuntimeBudget(appDirectory);
  console.log(
    `[desktop-runtime] Staged ${formatBytes(report.appBytes)}, ${report.fileCount} files, ${report.dependencyPackages.length} dependency packages.`,
  );
}

if (require.main === module) {
  void preparePackage().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { ELECTRON_RUNTIME_FILES, preparePackage };
