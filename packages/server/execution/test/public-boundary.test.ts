import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ExecutionEngine } from "@workbench/execution-server/engine";
import { ExecutionError } from "@workbench/execution-server/errors";
import { ExecutionNodeExecutorRegistry } from "@workbench/execution-server/node-executor";
import { ExecutionRepository } from "@workbench/execution-server/repository";
import { ExecutionService } from "@workbench/execution-server/service";
import { WorkbenchCommandExecutionNodeExecutor } from "@workbench/execution-server/terminal-command-executor";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_ROOT = path.join(PACKAGE_ROOT, "src");
const REQUIRED_EXPORTS = [
  "./engine",
  "./errors",
  "./node-executor",
  "./repository",
  "./service",
  "./terminal-command-executor",
];
const FORBIDDEN_SOURCE = [
  /from\s+["']@\//u,
  /from\s+["']next(?:\/|["'])/u,
  /from\s+["']react(?:\/|["'])/u,
  /from\s+["']@assistant-ui\//u,
  /from\s+["']@earendil-works\/pi(?:-|\/|["'])/u,
  /from\s+["']@workbench\/agent-runtime-pi-server(?:\/|["'])/u,
  /(?:^|[^\w/])workbench\/server\/pi\//u,
  /(?:^|[^\w/])app\//u,
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(file)
      : entry.isFile() && file.endsWith(".ts")
        ? [file]
        : [];
  });
}

test("publishes exactly the Execution server capability subpaths", () => {
  assert.equal(typeof ExecutionError, "function");
  assert.equal(typeof ExecutionNodeExecutorRegistry, "function");
  assert.equal(typeof ExecutionEngine, "function");
  assert.equal(typeof ExecutionRepository, "function");
  assert.equal(typeof ExecutionService, "function");
  assert.equal(typeof WorkbenchCommandExecutionNodeExecutor, "function");

  const manifest = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")) as {
    exports: Record<string, unknown>;
    dependencies: Record<string, string>;
  };
  assert.deepEqual(Object.keys(manifest.exports).sort(), REQUIRED_EXPORTS);
  assert.equal(
    Object.keys(manifest.exports).some((entry) => entry.includes("*")),
    false,
  );
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), [
    "@workbench/execution-contracts",
    "@workbench/server-core",
    "@workbench/terminal-server",
  ]);
  assert.equal(manifest.exports["./compiler"], undefined);
  assert.equal(manifest.exports["."], undefined);
});

test("Execution server source stays package-owned and runtime-neutral", () => {
  for (const file of sourceFiles(SOURCE_ROOT)) {
    const source = readFileSync(file, "utf8");
    for (const forbidden of FORBIDDEN_SOURCE) {
      assert.doesNotMatch(
        source,
        forbidden,
        `${path.relative(PACKAGE_ROOT, file)} violates ${forbidden}`,
      );
    }
  }

  const terminalAdapter = readFileSync(
    path.join(SOURCE_ROOT, "terminal-command-executor.ts"),
    "utf8",
  );
  assert.match(
    terminalAdapter,
    /@workbench\/terminal-server\/(?:bash-command-policy|tool-sessions)/u,
  );
  for (const file of sourceFiles(SOURCE_ROOT)) {
    if (path.basename(file) === "terminal-command-executor.ts") continue;
    assert.doesNotMatch(readFileSync(file, "utf8"), /@workbench\/terminal-server\//u);
  }
});
