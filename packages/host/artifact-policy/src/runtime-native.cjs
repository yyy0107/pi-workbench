const { createHash } = require("node:crypto");
const {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} = require("node:fs");
const path = require("node:path");

const NATIVE_RUNTIME_PACKAGES = Object.freeze(["node-pty", "tree-sitter", "tree-sitter-bash"]);
const NODE_PTY_NATIVE_BUILD_MANIFEST_ENV = "WORKBENCH_NODE_PTY_NATIVE_BUILD_MANIFEST";
const NODE_PTY_NATIVE_BUILD_MANIFEST_KIND = "workbench-node-pty-native-build";

function toPosixPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function isPathInside(rootDirectory, candidatePath) {
  const relativePath = path.relative(path.resolve(rootDirectory), path.resolve(candidatePath));
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

function assertPathInside(rootDirectory, candidatePath, label) {
  if (!isPathInside(rootDirectory, candidatePath)) {
    throw new Error(`${label} escapes the runtime artifact: ${candidatePath}.`);
  }
  return candidatePath;
}

function isNativeRuntimeFile(filePath) {
  const basename = path.basename(filePath).toLowerCase();
  return (
    basename === "spawn-helper" ||
    /\.(?:dll|dylib|exe|node)$/u.test(basename) ||
    /\.so(?:\.\d+)*$/u.test(basename)
  );
}

function nodePtyPolicy(target) {
  if (target.platform === "darwin") {
    return [
      { file: "pty.node", role: "pty-addon", selected: true, executable: false },
      { file: "spawn-helper", role: "pty-spawn-helper", selected: false, executable: true },
    ];
  }
  if (target.platform === "linux") {
    return [{ file: "pty.node", role: "pty-addon", selected: true, executable: false }];
  }
  if (target.platform === "win32") {
    return [
      { file: "conpty.node", role: "conpty-addon", selected: true, executable: false },
      {
        file: "conpty_console_list.node",
        role: "conpty-console-list-addon",
        selected: true,
        executable: false,
      },
      { file: "pty.node", role: "winpty-addon", selected: true, executable: false },
      { file: "winpty-agent.exe", role: "winpty-agent", selected: false, executable: false },
      { file: "winpty.dll", role: "winpty-library", selected: false, executable: false },
      {
        file: "conpty/conpty.dll",
        role: "conpty-library",
        selected: false,
        executable: false,
      },
      {
        file: "conpty/OpenConsole.exe",
        role: "conpty-host",
        selected: false,
        executable: false,
      },
    ];
  }
  throw new Error(`node-pty has no native policy for ${target.platform}.`);
}

function expectedNativeRuntimeFiles(target) {
  const tuple = `${target.platform}-${target.arch}`;
  return [
    ...nodePtyPolicy(target).map((item) => ({
      packageName: "node-pty",
      relativePath: `build/Release/${item.file}`,
      role: item.role,
      selected: item.selected,
      executable: item.executable,
    })),
    {
      packageName: "tree-sitter",
      relativePath: `prebuilds/${tuple}/tree-sitter.node`,
      role: "parser-runtime-addon",
      selected: true,
      executable: false,
    },
    {
      packageName: "tree-sitter-bash",
      relativePath: `prebuilds/${tuple}/tree-sitter-bash.node`,
      role: "bash-grammar-addon",
      selected: true,
      executable: false,
    },
  ];
}

/** Exact package subtrees that a target adapter may change before shared pruning/inventory. */
function nativeMaterializationMutationPolicy(target) {
  return Object.freeze(
    [
      ...new Map(
        expectedNativeRuntimeFiles(target).map((file) => [
          `${file.packageName}\0${file.relativePath.split("/")[0]}`,
          Object.freeze({
            packageName: file.packageName,
            relativeRoot: file.relativePath.split("/")[0],
          }),
        ]),
      ).values(),
    ].sort((left, right) =>
      `${left.packageName}/${left.relativeRoot}`.localeCompare(
        `${right.packageName}/${right.relativeRoot}`,
      ),
    ),
  );
}

function materializeNodePtyPrebuild(packageDirectory, target, expected) {
  const releaseDirectory = path.join(packageDirectory, "build", "Release");
  if (
    expected.every((item) => {
      const destination = path.join(packageDirectory, item.relativePath);
      return existsSync(destination) && lstatSync(destination).isFile();
    })
  ) {
    return;
  }

  const prebuildDirectory = path.join(
    packageDirectory,
    "prebuilds",
    `${target.platform}-${target.arch}`,
  );
  const sources = expected.map((item) => {
    const source = path.join(
      prebuildDirectory,
      item.relativePath.replace(/^build\/Release\//u, ""),
    );
    if (!existsSync(source) || !lstatSync(source).isFile()) {
      throw new Error(`node-pty is missing target prebuild ${source}.`);
    }
    assertPathInside(packageDirectory, realpathSync(source), "node-pty target prebuild");
    return { item, source };
  });

  rmSync(releaseDirectory, { force: true, recursive: true });
  mkdirSync(releaseDirectory, { recursive: true });
  for (const { item, source } of sources) {
    const destination = path.join(packageDirectory, item.relativePath);
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(source, destination);
    chmodSync(destination, lstatSync(source).mode & 0o777);
  }
}

function exactObjectKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} has unexpected fields.`);
  }
}

function verifyNodePtyNativeBuildManifest(
  packageDirectory,
  target,
  manifestPath,
  { repositoryRoot } = {},
) {
  if (!manifestPath) return undefined;
  if (!path.isAbsolute(manifestPath)) {
    throw new Error(`${NODE_PTY_NATIVE_BUILD_MANIFEST_ENV} must be an absolute path.`);
  }
  const resolvedManifest = realpathSync(manifestPath);
  if (repositoryRoot) {
    assertPathInside(
      realpathSync(repositoryRoot),
      resolvedManifest,
      "node-pty native build manifest",
    );
  }
  const value = JSON.parse(readFileSync(resolvedManifest, "utf8"));
  exactObjectKeys(
    value,
    ["files", "kind", "package", "schemaVersion", "sourceBuild", "target"],
    "node-pty native build manifest",
  );
  if (
    value.schemaVersion !== 1 ||
    value.kind !== NODE_PTY_NATIVE_BUILD_MANIFEST_KIND ||
    value.sourceBuild !== true
  ) {
    throw new Error("node-pty native build manifest identity is invalid.");
  }
  exactObjectKeys(value.package, ["name", "version"], "node-pty native build package");
  const packageManifest = JSON.parse(
    readFileSync(path.join(packageDirectory, "package.json"), "utf8"),
  );
  if (value.package.name !== "node-pty" || value.package.version !== packageManifest.version) {
    throw new Error("node-pty native build manifest package version does not match the artifact.");
  }
  exactObjectKeys(
    value.target,
    ["arch", "libc", "platform", "targetTriple"],
    "node-pty native build target",
  );
  const expectedLibc = target.platform === "linux" ? target.libc : "none";
  if (
    value.target.platform !== target.platform ||
    value.target.arch !== target.arch ||
    value.target.libc !== expectedLibc ||
    value.target.targetTriple !== target.targetTriple
  ) {
    throw new Error("node-pty native build manifest target does not match the Runtime artifact.");
  }
  if (!Array.isArray(value.files)) {
    throw new Error("node-pty native build manifest files must be an array.");
  }
  const expected = expectedNativeRuntimeFiles(target).filter(
    ({ packageName }) => packageName === "node-pty",
  );
  const files = new Map();
  for (const file of value.files) {
    exactObjectKeys(file, ["mode", "path", "sha256", "size"], "node-pty native build file");
    if (
      typeof file.path !== "string" ||
      !Number.isSafeInteger(file.size) ||
      file.size < 1 ||
      !Number.isSafeInteger(file.mode) ||
      file.mode < 0 ||
      file.mode > 0o777 ||
      typeof file.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/u.test(file.sha256) ||
      files.has(file.path)
    ) {
      throw new Error("node-pty native build manifest contains an invalid file entry.");
    }
    files.set(file.path, file);
  }
  const expectedPaths = expected.map(({ relativePath }) => relativePath).sort();
  if (JSON.stringify([...files.keys()].sort()) !== JSON.stringify(expectedPaths)) {
    throw new Error("node-pty native build manifest file set does not match the target policy.");
  }
  for (const item of expected) {
    const file = files.get(item.relativePath);
    const filePath = path.join(packageDirectory, ...item.relativePath.split("/"));
    if (!existsSync(filePath) || !lstatSync(filePath).isFile()) {
      throw new Error(`node-pty native build output is missing ${item.relativePath}.`);
    }
    const stats = lstatSync(filePath);
    if (
      stats.size !== file.size ||
      (stats.mode & 0o777) !== file.mode ||
      contentDigest(filePath) !== file.sha256
    ) {
      throw new Error(`node-pty native build output drifted: ${item.relativePath}.`);
    }
    if (item.executable && (stats.mode & 0o111) === 0) {
      throw new Error(`node-pty native build output is not executable: ${item.relativePath}.`);
    }
  }
  return Object.freeze(value);
}

function prunePackageNativeVariants(
  packageDirectory,
  packageName,
  target,
  { nativeBuildManifestPath, repositoryRoot } = {},
) {
  const expected = expectedNativeRuntimeFiles(target).filter(
    (item) => item.packageName === packageName,
  );
  if (expected.length === 0) throw new Error(`No native policy exists for ${packageName}.`);
  if (packageName === "node-pty") {
    materializeNodePtyPrebuild(packageDirectory, target, expected);
    verifyNodePtyNativeBuildManifest(packageDirectory, target, nativeBuildManifestPath, {
      repositoryRoot,
    });
    for (const item of [
      "bin",
      "binding.gyp",
      "deps",
      "prebuilds",
      "scripts",
      "src",
      "third_party",
      "typings",
    ]) {
      rmSync(path.join(packageDirectory, item), { force: true, recursive: true });
    }
    for (const entry of readdirSync(packageDirectory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith("node-addon-api")) {
        rmSync(path.join(packageDirectory, entry.name), { force: true, recursive: true });
      }
    }
    const buildDirectory = path.join(packageDirectory, "build");
    const releaseDirectory = path.join(buildDirectory, "Release");
    if (!existsSync(releaseDirectory)) throw new Error("node-pty is missing build/Release.");
    const allowed = new Set(
      expected.map((item) => item.relativePath.replace(/^build\/Release\//u, "")),
    );
    for (const entry of readdirSync(buildDirectory, { withFileTypes: true })) {
      if (entry.name !== "Release")
        rmSync(path.join(buildDirectory, entry.name), { force: true, recursive: true });
    }
    const pruneRelease = (directory, relativeDirectory = "") => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const relative = toPosixPath(path.join(relativeDirectory, entry.name));
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory() && [...allowed].some((file) => file.startsWith(`${relative}/`))) {
          pruneRelease(absolute, relative);
        } else if (!entry.isFile() || !allowed.has(relative)) {
          rmSync(absolute, { force: true, recursive: true });
        }
      }
    };
    pruneRelease(releaseDirectory);
  } else {
    const tuple = `${target.platform}-${target.arch}`;
    const prebuilds = path.join(packageDirectory, "prebuilds");
    if (!existsSync(prebuilds)) throw new Error(`${packageName} has no prebuild for ${tuple}.`);
    const targetDirectory = path.join(prebuilds, tuple);
    if (!existsSync(targetDirectory))
      throw new Error(`${packageName} has no prebuild for ${tuple}.`);
    const targetEntries = readdirSync(targetDirectory, { withFileTypes: true });
    const expectedFilename = path.basename(expected[0].relativePath);
    if (
      targetEntries.length !== 1 ||
      targetEntries[0].name !== expectedFilename ||
      !targetEntries[0].isFile()
    ) {
      throw new Error(
        `${packageName} must have exactly one ${tuple} native winner named ${expectedFilename}.`,
      );
    }
    for (const entry of readdirSync(prebuilds, { withFileTypes: true })) {
      if (entry.name !== tuple)
        rmSync(path.join(prebuilds, entry.name), { force: true, recursive: true });
    }
    const selected = path.join(packageDirectory, expected[0].relativePath);
    if (!existsSync(selected) || !lstatSync(selected).isFile()) {
      throw new Error(
        `${packageName} is missing selected native file ${expected[0].relativePath}.`,
      );
    }
    for (const item of [
      "bin",
      "binding.gyp",
      "build",
      "src",
      "vendor",
      "grammar.js",
      "tree-sitter-bash.wasm",
      "tree-sitter.json",
    ]) {
      rmSync(path.join(packageDirectory, item), { force: true, recursive: true });
    }
    if (packageName === "tree-sitter-bash") {
      // Published binding smoke code is not part of the runtime grammar entrypoint. Keep nearby
      // ordinary support files (for example next-test.js) so this remains an exact prune rule.
      rmSync(path.join(packageDirectory, "bindings", "node", "binding_test.js"), {
        force: true,
      });
    }
  }
  for (const entry of readdirSync(packageDirectory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith("node-addon-api")) {
      rmSync(path.join(packageDirectory, entry.name), { force: true, recursive: true });
    }
  }
  for (const expectedFile of expected) {
    const selected = path.join(packageDirectory, expectedFile.relativePath);
    if (!existsSync(selected) || !lstatSync(selected).isFile()) {
      throw new Error(
        `${packageName} is missing selected native file ${expectedFile.relativePath}.`,
      );
    }
  }
  return expected;
}

function collectNativeRuntimeFiles(directory, files = []) {
  if (!existsSync(directory)) return files;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) collectNativeRuntimeFiles(absolutePath, files);
    else if (entry.isFile() && isNativeRuntimeFile(absolutePath)) files.push(absolutePath);
  }
  return files;
}

function contentDigest(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function collectNativeRuntimeInventory(runtimeDirectory) {
  return collectNativeRuntimeFiles(runtimeDirectory)
    .map((filePath) => {
      const realPath = assertPathInside(
        runtimeDirectory,
        realpathSync(filePath),
        "Native runtime file",
      );
      const stats = lstatSync(realPath);
      if (!stats.isFile())
        throw new Error(`Native runtime path is not a regular file: ${filePath}.`);
      return {
        path: toPosixPath(path.relative(runtimeDirectory, filePath)),
        size: stats.size,
        sha256: contentDigest(realPath),
        mode: stats.mode & 0o777,
      };
    })
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

module.exports = {
  NATIVE_RUNTIME_PACKAGES,
  NODE_PTY_NATIVE_BUILD_MANIFEST_ENV,
  NODE_PTY_NATIVE_BUILD_MANIFEST_KIND,
  assertPathInside,
  collectNativeRuntimeFiles,
  collectNativeRuntimeInventory,
  contentDigest,
  expectedNativeRuntimeFiles,
  isNativeRuntimeFile,
  isPathInside,
  nativeMaterializationMutationPolicy,
  nodePtyPolicy,
  prunePackageNativeVariants,
  toPosixPath,
  verifyNodePtyNativeBuildManifest,
};
