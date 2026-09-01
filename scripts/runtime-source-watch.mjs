import { homedir } from "node:os";
import path from "node:path";

import workbenchPaths from "./workbench-paths.cjs";

const { createWorkbenchPaths } = workbenchPaths;

function normalizeWatchPattern(filePath) {
  return filePath.split(path.sep).join("/");
}

function nestedPiDirectoryPattern(filePath) {
  const filesystemRoot = normalizeWatchPattern(path.parse(path.resolve(filePath)).root).replace(
    /\/$/,
    "",
  );
  return `${filesystemRoot}/**/.pi/**`;
}

function resolveAgentDir() {
  const configured = process.env.PI_CODING_AGENT_DIR?.trim();
  if (!configured) return path.join(homedir(), ".pi", "agent");
  if (configured === "~") return homedir();
  if (configured.startsWith("~/") || configured.startsWith("~\\")) {
    return path.resolve(homedir(), configured.slice(2));
  }
  return path.resolve(configured);
}

export function piResourceWatchExcludes({
  agentDir = resolveAgentDir(),
  root = createWorkbenchPaths().repositoryRoot,
} = {}) {
  // Pi reloads these resources inside AgentSession. Watching the same files here would turn an
  // extension install/remove into a full Workbench server restart and disconnect every browser.
  const absolutePiPatterns = new Set(
    [agentDir, root].map((filePath) => nestedPiDirectoryPattern(filePath)),
  );
  return [
    `${normalizeWatchPattern(path.resolve(agentDir))}/**`,
    `${normalizeWatchPattern(path.resolve(root, ".pi"))}/**`,
    ...absolutePiPatterns,
    "**/.pi/**",
  ];
}

export function runtimeSourceWatchIncludes({ paths = createWorkbenchPaths() } = {}) {
  return [
    `${normalizeWatchPattern(paths.runtimeAppRoot)}/src/**/*.{ts,tsx,js,jsx,mjs,cjs,json}`,
    `${normalizeWatchPattern(paths.webSourceRoot)}/server/**/*.{ts,tsx,js,jsx,mjs,cjs,json}`,
    `${normalizeWatchPattern(paths.webSourceRoot)}/runtime-connected-web-main.ts`,
    `${normalizeWatchPattern(paths.repositoryRoot)}/packages/**/src/**/*.{ts,tsx,js,jsx,mjs,cjs,json}`,
    `${normalizeWatchPattern(paths.runtimeAppRoot)}/package.json`,
    `${normalizeWatchPattern(paths.webRoot)}/package.json`,
    `${normalizeWatchPattern(paths.repositoryRoot)}/packages/**/package.json`,
  ];
}

function runtimeSourceWatchExcludes(paths) {
  return [
    `${normalizeWatchPattern(paths.runtimeAppRoot)}/test/**`,
    `${normalizeWatchPattern(paths.repositoryRoot)}/packages/**/test/**`,
    `${normalizeWatchPattern(paths.repositoryRoot)}/packages/**/{build,dist,node_modules}/**`,
    `${normalizeWatchPattern(paths.runtimeArtifactRoot)}/**`,
  ];
}

/**
 * Browser and Electron development managers restart the Runtime on the same source boundary. Keep
 * the globs here so neither entrypoint can drift; Pi resources remain Runtime-owned reload inputs.
 */
export function createRuntimeSourceWatchArguments({
  paths = createWorkbenchPaths(),
  agentDir = resolveAgentDir(),
} = {}) {
  return [
    ...runtimeSourceWatchIncludes({ paths }).flatMap((pattern) => ["--include", pattern]),
    ...[
      ...piResourceWatchExcludes({ agentDir, root: paths.repositoryRoot }),
      ...runtimeSourceWatchExcludes(paths),
    ].flatMap((pattern) => ["--exclude", pattern]),
  ];
}
