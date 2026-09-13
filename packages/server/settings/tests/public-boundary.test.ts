import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { configuredWorkbenchSettingsFile } from "@workbench/settings-server/file";
import { WorkbenchSettingsService } from "@workbench/settings-server/service";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));

test("publishes exactly the Settings server capability subpaths", () => {
  assert.equal(typeof configuredWorkbenchSettingsFile, "function");
  assert.equal(typeof WorkbenchSettingsService, "function");

  const manifest = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")) as {
    exports: Record<string, unknown>;
    dependencies: Record<string, string>;
  };
  assert.deepEqual(Object.keys(manifest.exports).sort(), ["./file", "./rpc", "./service"]);
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), [
    "@workbench/agent-runtime-contracts",
    "@workbench/contracts",
    "@workbench/host-server",
    "@workbench/server-core",
  ]);
  assert.equal(manifest.exports["."], undefined);
});
