const { cpSync, existsSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const { runNodeScript, runPackageManager } = require("./process-runner.cjs");

const projectRoot = path.resolve(__dirname, "..");
const stagingRoot = path.join(projectRoot, ".electron-build");
const appDirectory = path.join(stagingRoot, "app");
const nextBuildDirectory = path.join(projectRoot, ".next");

function preparePackage() {
  if (!existsSync(path.join(nextBuildDirectory, "BUILD_ID"))) {
    throw new Error("Missing .next production output. Run `pnpm build` before packaging Electron.");
  }

  rmSync(stagingRoot, { force: true, recursive: true });

  runPackageManager(
    [
      "--config.inject-workspace-packages=true",
      "--filter",
      "workbench-ui",
      "deploy",
      "--prod",
      appDirectory,
    ],
    {
      cwd: projectRoot,
      env: process.env,
      label: "pnpm deploy",
      stdio: "inherit",
    },
  );

  cpSync(nextBuildDirectory, path.join(appDirectory, ".next"), { recursive: true });

  const packagePath = path.join(appDirectory, "package.json");
  const appPackage = JSON.parse(readFileSync(packagePath, "utf8"));
  delete appPackage.build;
  delete appPackage.devDependencies;
  writeFileSync(packagePath, `${JSON.stringify(appPackage, null, 2)}\n`);

  const electronVersion = require("electron/package.json").version;
  const electronRebuildCli = path.join(
    path.dirname(require.resolve("@electron/rebuild")),
    "cli.js",
  );
  runNodeScript(
    electronRebuildCli,
    [
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
      label: "electron-rebuild",
      stdio: "inherit",
    },
  );
}

if (require.main === module) {
  preparePackage();
}

module.exports = { preparePackage };
