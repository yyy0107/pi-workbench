// Executes the same admitted native Runtime tree under Node or Electron-as-Node.
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { lstatSync, realpathSync, readFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const path = require("node:path");

const RESULT_PREFIX = "WORKBENCH_NATIVE_SMOKE=";
const PTY_SENTINEL = "__workbench_native_pty_smoke__";

function runtimeArgument(arguments_ = process.argv.slice(2)) {
  if (arguments_.length !== 2 || arguments_[0] !== "--runtime") {
    throw new Error("Usage: native-runtime-smoke.cjs --runtime <runtime-artifact-directory>");
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

function currentRuntimeTarget() {
  const libc = currentLibc();
  const common = {
    platform: process.platform,
    arch: process.arch,
    targetTriple: targetTriple(process.platform, process.arch, libc),
    libc,
    nodeVersion: process.versions.node,
    nodeModuleAbi: Number(process.versions.modules),
    napiVersion: Number(process.versions.napi),
  };
  return process.versions.electron
    ? { runtimeFlavor: "electron-node", ...common, electronVersion: process.versions.electron }
    : { runtimeFlavor: "node", ...common };
}

function interactiveShell() {
  if (process.platform === "win32") {
    return {
      executable: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/q"],
      input: `echo ${PTY_SENTINEL}\r\nexit\r\n`,
    };
  }
  return {
    executable: "/bin/sh",
    args: [],
    input: `printf '%s\\n' '${PTY_SENTINEL}'\nexit\n`,
  };
}

function longRunningShell() {
  if (process.platform === "win32") {
    return {
      executable: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", "ping -n 30 127.0.0.1 >nul"],
    };
  }
  return { executable: "/bin/sh", args: ["-lc", "sleep 30"] };
}

function ptyOptions(runtimeDirectory, options) {
  return {
    cols: 80,
    cwd: runtimeDirectory,
    env: { ...process.env, TERM: "xterm" },
    name: "xterm",
    rows: 24,
    ...options,
  };
}

function smokeInteractivePty(nodePty, runtimeDirectory, options = {}) {
  const shell = interactiveShell();
  return new Promise((resolve, reject) => {
    let output = "";
    let terminal;
    const timeout = setTimeout(() => {
      try {
        terminal?.kill();
      } catch {}
      reject(new Error("node-pty interactive smoke timed out."));
    }, 10_000);
    try {
      terminal = nodePty.spawn(shell.executable, shell.args, ptyOptions(runtimeDirectory, options));
      terminal.resize(100, 30);
      terminal.write(shell.input);
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
        assert.equal(exitCode, 0, `node-pty interactive smoke exited with ${exitCode}.`);
        assert.match(output, new RegExp(PTY_SENTINEL, "u"));
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

function smokeTerminatedPty(nodePty, runtimeDirectory, options = {}) {
  const shell = longRunningShell();
  return new Promise((resolve, reject) => {
    let terminal;
    const timeout = setTimeout(() => {
      try {
        terminal?.kill();
      } catch {}
      reject(new Error("node-pty termination smoke timed out."));
    }, 10_000);
    try {
      terminal = nodePty.spawn(shell.executable, shell.args, ptyOptions(runtimeDirectory, options));
      terminal.onExit(() => {
        clearTimeout(timeout);
        resolve();
      });
      setTimeout(() => {
        try {
          // node-pty's ConPTY kill path races its console-list helper with native teardown and can
          // print a benign AttachConsole failure. Terminating the live shell still exercises the
          // forced-exit event while allowing node-pty to perform its normal native cleanup.
          if (process.platform === "win32") process.kill(terminal.pid);
          else terminal.kill();
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      }, 100);
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
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
  const target = currentRuntimeTarget();
  assert.deepEqual(
    target,
    manifest.target,
    "The staged Runtime artifact target must match the executing runtime.",
  );
  assert.deepEqual(inventory.target, manifest.target, "The native inventory target changed.");
  for (const file of inventory.files) {
    const absolutePath = path.join(runtimeDirectory, ...file.path.split("/"));
    const stats = lstatSync(absolutePath);
    assert.equal(stats.isFile(), true, `${file.path} is not a regular file.`);
    assert.equal(stats.size, file.size, `${file.path} size changed after inventory.`);
    assert.equal(stats.mode & 0o777, file.mode, `${file.path} mode changed after staging.`);
    assert.equal(
      createHash("sha256").update(readFileSync(absolutePath)).digest("hex"),
      file.sha256,
      `${file.path} content changed after inventory.`,
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

  const variants =
    process.platform === "win32" ? [{ useConpty: true }, { useConpty: false }] : [{}];
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
  }
  for (const options of variants) {
    await smokeInteractivePty(nodePty, runtimeDirectory, options);
    await smokeTerminatedPty(nodePty, runtimeDirectory, options);
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
  await new Promise((resolve, reject) =>
    process.stdout.write(
      `${RESULT_PREFIX}${JSON.stringify({ target, loadedNativePaths, lifecycle: "passed" })}\n`,
      (error) => (error ? reject(error) : resolve()),
    ),
  );
}

if (require.main === module) {
  void main().then(
    () => process.exit(0),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}

module.exports = {
  PTY_SENTINEL,
  currentLibc,
  currentRuntimeTarget,
  runtimeArgument,
  smokeInteractivePty,
  smokeTerminatedPty,
  targetTriple,
};
