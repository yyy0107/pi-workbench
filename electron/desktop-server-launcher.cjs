const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

function loadStandaloneConfig(runtimeRoot) {
  const manifestPath = path.join(runtimeRoot, ".next", "required-server-files.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!manifest || typeof manifest !== "object" || !manifest.config) {
    throw new Error(`Next.js runtime manifest has no serialized config: ${manifestPath}`);
  }
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(manifest.config);
}

async function launch() {
  const runtimeRoot = process.cwd();
  const configuredEntry = process.argv[2];
  const serverEntry = configuredEntry
    ? path.resolve(runtimeRoot, configuredEntry)
    : path.join(__dirname, "server.mjs");
  if (!existsSync(serverEntry)) {
    throw new Error(`Missing precompiled Workbench server: ${serverEntry}`);
  }

  loadStandaloneConfig(runtimeRoot);
  await import(pathToFileURL(serverEntry).href);
}

void launch().catch((error) => {
  console.error("Failed to launch the precompiled Workbench server.", error);
  process.exitCode = 1;
});
