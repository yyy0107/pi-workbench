const path = require("node:path");

const { preparePackage } = require("./prepare-package.cjs");
const { runNodeScript } = require("./process-runner.cjs");

const projectRoot = path.resolve(__dirname, "..");
const electronBuilderCli = require.resolve("electron-builder/cli.js");

preparePackage();
runNodeScript(electronBuilderCli, process.argv.slice(2), {
  cwd: projectRoot,
  env: process.env,
  label: "electron-builder",
  stdio: "inherit",
});
