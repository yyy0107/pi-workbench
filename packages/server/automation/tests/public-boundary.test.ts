import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { AutomationError } from "@workbench/automation-server/errors";
import { AutomationRepository } from "@workbench/automation-server/repository";
import { AutomationService } from "@workbench/automation-server/service";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));

test("publishes exactly the Automation server capability subpaths", () => {
  assert.equal(typeof AutomationError, "function");
  assert.equal(typeof AutomationRepository, "function");
  assert.equal(typeof AutomationService, "function");

  const manifest = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")) as {
    exports: Record<string, unknown>;
    dependencies: Record<string, string>;
  };
  assert.deepEqual(Object.keys(manifest.exports).sort(), [
    "./errors",
    "./repository",
    "./rpc",
    "./service",
  ]);
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), [
    "@workbench/automation-contracts",
    "@workbench/host-server",
    "@workbench/server-core",
    "cron-parser",
  ]);
  assert.equal(manifest.exports["."], undefined);
});
