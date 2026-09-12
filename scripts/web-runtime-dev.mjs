import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuntimeConnectedWebMode } from "@workbench/host-contracts/runtime-connected-web-control";

import { runWebRuntimeOrchestrator } from "./web-runtime-orchestrator.mjs";
import { runManagedWebRuntimeWatch } from "./web-runtime-watch.mjs";
import workbenchPaths from "./workbench-paths.cjs";

const { createWorkbenchPaths } = workbenchPaths;
const HOT_ARGUMENT = "--hot";
const PORT_ARGUMENT = "--port";

export function parseWebRuntimeDevOptions(argv = process.argv.slice(2)) {
  const arguments_ = argv[0] === "--" ? argv.slice(1) : argv;
  let hot = false;
  let port;
  let portSpecified = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === HOT_ARGUMENT && !hot) {
      hot = true;
      continue;
    }
    if (argument === PORT_ARGUMENT && !portSpecified) {
      portSpecified = true;
      port = arguments_[index + 1];
      index += 1;
      continue;
    }
    if (argument.startsWith(`${PORT_ARGUMENT}=`) && !portSpecified) {
      portSpecified = true;
      port = argument.slice(PORT_ARGUMENT.length + 1);
      continue;
    }
    throw new Error(`Usage: web-runtime-dev.mjs [${HOT_ARGUMENT}] [${PORT_ARGUMENT} <port>]`);
  }
  if (!portSpecified) return Object.freeze({ hot });
  const parsedPort = Number(port);
  if (
    !/^\d+$/u.test(port ?? "") ||
    !Number.isInteger(parsedPort) ||
    parsedPort < 1 ||
    parsedPort > 65_535
  ) {
    throw new Error(`${PORT_ARGUMENT} must be an integer from 1 to 65535.`);
  }
  return Object.freeze({ hot, port: parsedPort });
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
  environment = process.env,
  build = runProductionBuild,
  startHot = runManagedWebRuntimeWatch,
  startProduction = (orchestratorOptions) => runWebRuntimeOrchestrator(orchestratorOptions),
} = {}) {
  const developmentEnvironment =
    options.port === undefined ? environment : { ...environment, PORT: String(options.port) };
  if (options.hot) return startHot({ environment: developmentEnvironment });
  if (build() !== 0) return 1;
  return startProduction({
    mode: RuntimeConnectedWebMode.production,
    environment: developmentEnvironment,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runWebRuntimeDev();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Workbench development failed.");
    process.exitCode = 1;
  }
}
