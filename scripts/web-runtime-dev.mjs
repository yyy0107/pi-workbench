import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuntimeConnectedWebMode } from "@workbench/host-contracts/runtime-connected-web-control";

import { runWebRuntimeOrchestrator } from "./web-runtime-orchestrator.mjs";
import { runManagedWebRuntimeWatch } from "./web-runtime-watch.mjs";
import workbenchPaths from "./workbench-paths.cjs";

const { createWorkbenchPaths } = workbenchPaths;
const HOT_ARGUMENT = "--hot";

export function parseWebRuntimeDevOptions(argv = process.argv.slice(2)) {
  if (argv.length === 0) return Object.freeze({ hot: false });
  if (argv.length === 1 && argv[0] === HOT_ARGUMENT) return Object.freeze({ hot: true });
  throw new Error(`Usage: web-runtime-dev.mjs [${HOT_ARGUMENT}]`);
}

export function runProductionBuild({
  paths = createWorkbenchPaths(),
  environment = process.env,
  spawnSyncImpl = spawnSync,
} = {}) {
  const result = spawnSyncImpl("pnpm", ["build"], {
    cwd: paths.repositoryRoot,
    env: environment,
    shell: process.platform === "win32",
    stdio: "inherit",
    windowsHide: false,
  });
  if (result.error) throw result.error;
  return result.status === 0 && result.signal === null ? 0 : 1;
}

export async function runWebRuntimeDev({
  options = parseWebRuntimeDevOptions(),
  build = runProductionBuild,
  startHot = runManagedWebRuntimeWatch,
  startProduction = () => runWebRuntimeOrchestrator({ mode: RuntimeConnectedWebMode.production }),
} = {}) {
  if (options.hot) return startHot();
  if (build() !== 0) return 1;
  return startProduction();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runWebRuntimeDev();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Workbench development failed.");
    process.exitCode = 1;
  }
}
