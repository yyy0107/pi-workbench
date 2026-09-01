const { spawn } = require("node:child_process");
const { realpathSync } = require("node:fs");
const { createRequire } = require("node:module");
const { createServer } = require("node:net");
const path = require("node:path");

const { createWorkbenchPaths } = require("../../../scripts/workbench-paths.cjs");

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not reserve a loopback port for the standalone smoke.");
  }
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

function appendBounded(current, chunk, limit = 64 * 1024) {
  return `${current}${chunk.toString("utf8")}`.slice(-limit);
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    return await fetch(url, { redirect: "manual", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function waitForStandalone({ child, origin, output, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Raw standalone server exited before readiness (${child.exitCode ?? child.signalCode}).\n${output()}`,
      );
    }
    try {
      const response = await fetchWithTimeout(origin, 1_000);
      const body = await response.text();
      if (response.status !== 200) {
        throw new Error(`Raw standalone server returned HTTP ${response.status}.`);
      }
      if (!/<html(?:\s|>)/iu.test(body)) {
        throw new Error("Raw standalone response did not contain an SSR HTML document.");
      }
      return Object.freeze({ status: response.status, bodyBytes: Buffer.byteLength(body) });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.startsWith("Raw standalone server returned") ||
          error.message.startsWith("Raw standalone response"))
      ) {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Raw standalone server did not become ready within ${timeoutMs}ms.\n${output()}`);
}

async function stopChild(child, timeoutMs = 5_000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      timer.unref?.();
    }),
  ]);
  if (exited) return;
  child.kill("SIGKILL");
  await new Promise((resolve) => child.once("exit", resolve));
}

function assertCompletedRuntime(standaloneRoot) {
  const canonicalStandaloneRoot = realpathSync(standaloneRoot);
  const runtimeNextManifest = realpathSync(
    path.join(canonicalStandaloneRoot, "node_modules", "next", "package.json"),
  );
  const runtimeNextRequire = createRequire(runtimeNextManifest);
  const helperModule = runtimeNextRequire.resolve("@swc/helpers/_/_interop_require_default");
  const helperManifest = runtimeNextRequire.resolve("@swc/helpers/package.json");
  const tslibManifest = createRequire(helperManifest).resolve("tslib/package.json");
  for (const [label, resolved] of [
    ["module-sync helper", helperModule],
    ["helper manifest", helperManifest],
    ["tslib manifest", tslibManifest],
  ]) {
    if (!isInside(canonicalStandaloneRoot, resolved)) {
      throw new Error(`Standalone ${label} resolves outside the standalone root: ${resolved}`);
    }
  }
  if (!helperModule.split(path.sep).join("/").includes("/@swc/helpers/esm/")) {
    throw new Error(
      `Node did not select the completed @swc/helpers module-sync branch: ${helperModule}`,
    );
  }
  return Object.freeze({ helperModule, tslibManifest });
}

async function smokeWebStandalone({
  paths = createWorkbenchPaths(),
  timeoutMs = 30_000,
  spawnImpl = spawn,
} = {}) {
  const standaloneRoot = path.resolve(paths.webStandaloneRoot);
  const serverEntry = path.join(paths.webStandaloneAppRoot, "server.js");
  const closure = assertCompletedRuntime(standaloneRoot);
  const port = await reserveLoopbackPort();
  let stdout = "";
  let stderr = "";
  const child = spawnImpl(process.execPath, [serverEntry], {
    cwd: paths.webStandaloneAppRoot,
    env: {
      ...process.env,
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => {
    stdout = appendBounded(stdout, chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr = appendBounded(stderr, chunk);
  });
  const output = () => [stdout, stderr].filter(Boolean).join("\n");
  try {
    const response = await waitForStandalone({
      child,
      origin: `http://127.0.0.1:${port}`,
      output,
      timeoutMs,
    });
    return Object.freeze({
      origin: `http://127.0.0.1:${port}`,
      response,
      closure,
    });
  } finally {
    await stopChild(child);
  }
}

if (require.main === module) {
  void smokeWebStandalone()
    .then((report) => {
      console.log(
        `[web-standalone] Raw server returned HTTP ${report.response.status} with ${report.response.bodyBytes} bytes of SSR HTML; helper=${report.closure.helperModule}.`,
      );
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  assertCompletedRuntime,
  smokeWebStandalone,
};
