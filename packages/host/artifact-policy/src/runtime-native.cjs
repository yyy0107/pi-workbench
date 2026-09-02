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
    const source = path.join(prebuildDirectory, path.basename(item.relativePath));
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
    copyFileSync(source, destination);
    chmodSync(destination, lstatSync(source).mode & 0o777);
  }
}

function prunePackageNativeVariants(packageDirectory, packageName, target) {
  const expected = expectedNativeRuntimeFiles(target).filter(
    (item) => item.packageName === packageName,
  );
  if (expected.length === 0) throw new Error(`No native policy exists for ${packageName}.`);
  if (packageName === "node-pty") {
    materializeNodePtyPrebuild(packageDirectory, target, expected);
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
    const allowed = new Set(expected.map((item) => path.basename(item.relativePath)));
    for (const entry of readdirSync(buildDirectory, { withFileTypes: true })) {
      if (entry.name !== "Release")
        rmSync(path.join(buildDirectory, entry.name), { force: true, recursive: true });
    }
    for (const entry of readdirSync(releaseDirectory, { withFileTypes: true })) {
      if (!allowed.has(entry.name))
        rmSync(path.join(releaseDirectory, entry.name), { force: true, recursive: true });
    }
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
};
