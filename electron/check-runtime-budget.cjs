const path = require("node:path");

const { assertDesktopRuntimeBudget, formatBytes } = require("./desktop-runtime-budget.cjs");

const projectRoot = path.resolve(__dirname, "..");
const appDirectory = path.resolve(
  projectRoot,
  process.argv[2] ?? path.join(".electron-build", "app"),
);

try {
  const report = assertDesktopRuntimeBudget(appDirectory);
  console.log(
    [
      "[desktop-runtime] Budget passed",
      `app=${formatBytes(report.appBytes)}`,
      `node_modules=${formatBytes(report.nodeModulesBytes)}`,
      `files=${report.fileCount}`,
      `packages=${report.dependencyPackages.length}`,
    ].join(" "),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
