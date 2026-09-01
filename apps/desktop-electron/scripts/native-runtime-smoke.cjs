const assert = require("node:assert/strict");
const { lstatSync, realpathSync, readFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const path = require("node:path");

const RESULT_PREFIX = "WORKBENCH_NATIVE_SMOKE=";
const PTY_SENTINEL = "__workbench_native_pty_smoke__";

function runtimeArgument(arguments_ = process.argv.slice(2)) {
  if (arguments_.length !== 2 || arguments_[0] !== "--runtime") {
    throw new Error("Usage: native-runtime-smoke.cjs --runtime <desktop-runtime-directory>");
  }
  return path.resolve(arguments_[1]);
}

function isPathInside(rootDirectory, candidatePath) {
  const relativePath = path.relative(rootDirectory, candidatePath);
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

function currentLibc() {
  if (process.platform !== "linux") return "none";
  return process.report?.getReport?.().header?.glibcVersionRuntime ? "glibc" : "musl";
}

function targetTriple(platform, arch, libc) {
  if (platform === "darwin") {
    return arch === "x64" ? "x86_64-apple-darwin" : "aarch64-apple-darwin";
  }
  if (platform === "win32") {
    return arch === "x64" ? "x86_64-pc-windows-msvc" : "aarch64-pc-windows-msvc";
  }
  const cpu = arch === "x64" ? "x86_64" : "aarch64";
  return `${cpu}-unknown-linux-${libc === "glibc" ? "gnu" : "musl"}`;
}

function currentElectronTarget() {
  const libc = currentLibc();
  return {
    runtimeFlavor: "electron-node",
    platform: process.platform,
    arch: process.arch,
    targetTriple: targetTriple(process.platform, process.arch, libc),
    libc,
    nodeVersion: process.versions.node,
    nodeModuleAbi: Number(process.versions.modules),
    napiVersion: Number(process.versions.napi),
    electronVersion: process.versions.electron,
  };
}

function smokePty(nodePty, runtimeDirectory, options = {}) {
  const windows = process.platform === "win32";
  const executable = windows ? process.env.ComSpec || "cmd.exe" : "/bin/sh";
  const args = windows
    ? ["/d", "/s", "/c", `echo ${PTY_SENTINEL}`]
    : ["-lc", `printf '%s\\n' '${PTY_SENTINEL}'`];

  return new Promise((resolve, reject) => {
    let output = "";
    let terminal;
    const timeout = setTimeout(() => {
      try {
        terminal?.kill();
      } catch {}
      reject(new Error("node-pty smoke timed out."));
    }, 10_000);

    try {
      terminal = nodePty.spawn(executable, args, {
        cols: 80,
        cwd: runtimeDirectory,
        env: { ...process.env, TERM: "xterm" },
        name: "xterm",
        rows: 24,
        ...options,
      });
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
      return;
    }
    terminal.onData((data) => {
      output += data;
    });
    terminal.onExit(({ exitCode }) => {
      clearTimeout(timeout);
      try {
        assert.equal(exitCode, 0, `node-pty smoke exited with ${exitCode}.`);
        assert.match(output, new RegExp(PTY_SENTINEL, "u"));
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function main() {
  const runtimeDirectory = runtimeArgument();
  const manifest = JSON.parse(
    readFileSync(path.join(runtimeDirectory, "artifact-manifest.json"), "utf8"),
  );
  const inventory = JSON.parse(
    readFileSync(path.join(runtimeDirectory, manifest.nativeInventory.path), "utf8"),
  );
  const target = currentElectronTarget();
  assert.deepEqual(
    target,
    manifest.target,
    "The staged Runtime artifact target must match Electron's embedded Node runtime.",
  );
  assert.deepEqual(inventory.target, manifest.target, "The native inventory target changed.");
  for (const file of inventory.files) {
    const absolutePath = path.join(runtimeDirectory, ...file.path.split("/"));
    assert.equal(
      lstatSync(absolutePath).mode & 0o777,
      file.mode,
      `${file.path} mode changed after staging.`,
    );
  }

  const requireFromRuntime = createRequire(path.join(runtimeDirectory, manifest.entrypoint));
  const Parser = requireFromRuntime("tree-sitter");
  const Bash = requireFromRuntime("tree-sitter-bash");
  const nodePty = requireFromRuntime("node-pty");

  const parser = new Parser();
  parser.setLanguage(Bash);
  const tree = parser.parse("echo native_gate");
  assert.equal(tree.rootNode.type, "program");
  assert.equal(tree.rootNode.hasError, false);
  if (process.platform === "win32") {
    const nodePtyRoot = path.dirname(path.dirname(requireFromRuntime.resolve("node-pty")));
    const nativeLoader = require(path.join(nodePtyRoot, "lib", "utils.js"));
    const expectedRoot = path.join(nodePtyRoot, "build", "Release");
    for (const addon of ["conpty", "conpty_console_list", "pty"]) {
      const loaded = nativeLoader.loadNativeModule(addon);
      assert.equal(
        path.resolve(path.join(nodePtyRoot, "lib"), loaded.dir),
        expectedRoot,
        `${addon} loaded from a different node-pty native root.`,
      );
    }
    await smokePty(nodePty, runtimeDirectory, { useConpty: true });
    await smokePty(nodePty, runtimeDirectory, { useConpty: false });
  } else {
    await smokePty(nodePty, runtimeDirectory);
  }

  const loadedNativePaths = Object.keys(require.cache)
    .filter((filePath) => filePath.endsWith(".node"))
    .map((filePath) => realpathSync(filePath))
    .map((filePath) => {
      if (!isPathInside(runtimeDirectory, filePath)) {
        throw new Error(`Native addon loaded from outside staged runtime: ${filePath}.`);
      }
      return path.relative(runtimeDirectory, filePath).split(path.sep).join("/");
    })
    .sort();

  tree.delete?.();
  parser.delete?.();
  process.stdout.write(`${RESULT_PREFIX}${JSON.stringify({ target, loadedNativePaths })}\n`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

module.exports = {
  PTY_SENTINEL,
  currentElectronTarget,
  currentLibc,
  runtimeArgument,
  smokePty,
  targetTriple,
};
