import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { currentNodeArtifactTarget, outputDirectoryForTarget } from "./build-runtime-artifact";

const script = fileURLToPath(new URL("../../../scripts/native-runtime-smoke.cjs", import.meta.url));
const runtimeDirectory = outputDirectoryForTarget(currentNodeArtifactTarget());
const result = spawnSync(process.execPath, [script, "--runtime", runtimeDirectory], {
  cwd: path.resolve(fileURLToPath(new URL("../../../", import.meta.url))),
  env: process.env,
  stdio: "inherit",
  timeout: 30_000,
  windowsHide: true,
});

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`Node Runtime native smoke failed with exit code ${result.status ?? "unknown"}.`);
}
