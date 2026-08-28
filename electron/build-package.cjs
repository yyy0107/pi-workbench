const path = require("node:path");

const { preparePackage } = require("./prepare-package.cjs");
const { assertPackagedOutputBudget, formatBytes } = require("./desktop-runtime-budget.cjs");
const { runNodeScript } = require("./process-runner.cjs");

const projectRoot = path.resolve(__dirname, "..");
const electronBuilderCli = require.resolve("electron-builder/cli.js");

async function main() {
  await preparePackage();
  runNodeScript(electronBuilderCli, process.argv.slice(2), {
    cwd: projectRoot,
    env: process.env,
    label: "electron-builder",
    stdio: "inherit",
  });
  const report = assertPackagedOutputBudget(path.join(projectRoot, "dist-electron"), {
    requireArtifact: !process.argv.includes("--dir"),
  });
  console.log(
    `[desktop-runtime] Packaged app budget passed: ${formatBytes(report.runtimeReport.appBytes)}, ${report.runtimeReport.fileCount} files${report.artifactBytes === undefined ? "" : `, artifact ${formatBytes(report.artifactBytes)}`}.`,
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
