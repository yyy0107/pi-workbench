import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

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

export function piResourceWatchExcludes({ agentDir = resolveAgentDir(), root = projectRoot } = {}) {
  // Pi reloads these resources inside AgentSession. Watching the same files here would turn an
  // extension install/remove into a full custom-server restart and disconnect every browser.
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

async function main() {
  const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"));
  const excludeArgs = piResourceWatchExcludes().flatMap((pattern) => ["--exclude", pattern]);
  const child = spawn(
    process.execPath,
    [tsxCli, "watch", ...excludeArgs, path.join(projectRoot, "server.ts"), "--dev"],
    {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit",
    },
  );

  const relaySignal = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  const onSigint = () => relaySignal("SIGINT");
  const onSigterm = () => relaySignal("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  child.once("error", (error) => {
    console.error("Failed to start the Workbench development server.", error);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
