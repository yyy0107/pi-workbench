const path = require("node:path");
const { spawnSync } = require("node:child_process");

const JAVASCRIPT_EXTENSIONS = new Set([".cjs", ".js", ".mjs"]);

function packageManagerInvocation(
  args,
  { env = process.env, nodeExecutable = process.execPath } = {},
) {
  const packageManagerExecutable = env.npm_execpath;
  if (!packageManagerExecutable) {
    throw new Error(
      "Missing npm_execpath. Run Electron packaging through `pnpm electron:pack` or `pnpm electron:dist`.",
    );
  }

  const extension = path.extname(packageManagerExecutable).toLowerCase();
  if (JAVASCRIPT_EXTENSIONS.has(extension)) {
    return {
      args: [packageManagerExecutable, ...args],
      command: nodeExecutable,
    };
  }

  if (extension === ".bat" || extension === ".cmd") {
    throw new Error(
      `Expected pnpm's executable or JavaScript CLI entry, but npm_execpath points to a Windows batch shim: ${packageManagerExecutable}`,
    );
  }

  return {
    args,
    command: packageManagerExecutable,
  };
}

function runProcess(command, args, { label = command, ...options } = {}) {
  const result = spawnSync(command, args, options);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}.`);
  }
}

function runNodeScript(scriptPath, args, options) {
  runProcess(process.execPath, [scriptPath, ...args], options);
}

function runPackageManager(args, options = {}) {
  const invocation = packageManagerInvocation(args, { env: options.env });
  runProcess(invocation.command, invocation.args, options);
}

module.exports = {
  packageManagerInvocation,
  runNodeScript,
  runPackageManager,
  runProcess,
};
