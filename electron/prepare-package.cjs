const { cpSync, existsSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const stagingRoot = path.join(projectRoot, ".electron-build");
const appDirectory = path.join(stagingRoot, "app");
const nextBuildDirectory = path.join(projectRoot, ".next");

if (!existsSync(path.join(nextBuildDirectory, "BUILD_ID"))) {
  throw new Error("Missing .next production output. Run `pnpm build` before packaging Electron.");
}

rmSync(stagingRoot, { force: true, recursive: true });

const pnpmExecutable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const deploy = spawnSync(
  pnpmExecutable,
  ["--filter", "workbench-ui", "deploy", "--prod", "--legacy", appDirectory],
  {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  },
);

if (deploy.error) throw deploy.error;
if (deploy.status !== 0) {
  throw new Error(`pnpm deploy failed with exit code ${deploy.status ?? "unknown"}.`);
}

cpSync(nextBuildDirectory, path.join(appDirectory, ".next"), { recursive: true });

const packagePath = path.join(appDirectory, "package.json");
const appPackage = JSON.parse(readFileSync(packagePath, "utf8"));
delete appPackage.build;
delete appPackage.devDependencies;
writeFileSync(packagePath, `${JSON.stringify(appPackage, null, 2)}\n`);

const electronVersion = require("electron/package.json").version;
const electronRebuildCli = path.join(path.dirname(require.resolve("@electron/rebuild")), "cli.js");
const rebuild = spawnSync(
  process.execPath,
  [
    electronRebuildCli,
    "--force",
    "--which-module",
    "node-pty",
    "--module-dir",
    appDirectory,
    "--version",
    electronVersion,
  ],
  {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  },
);

if (rebuild.error) throw rebuild.error;
if (rebuild.status !== 0) {
  throw new Error(`electron-rebuild failed with exit code ${rebuild.status ?? "unknown"}.`);
}
