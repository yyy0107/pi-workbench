import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  migrationPathInventory,
  phaseZeroMetadata,
  phaseZeroSnapshotViolations,
} from "./migration-path-inventory.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));

async function fixture(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), "workbench-migration-inventory-"));
  for (const [file, source] of Object.entries(files)) {
    const destination = path.join(root, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, source);
  }
  return root;
}

test("records only production migration coupling evidence with stable categories", async (t) => {
  const root = await fixture({
    "apps/web/src/client.ts": [
      'fetch("/api/session.list");',
      "new WebSocket(window.location.origin);",
      'await import("./feature");',
      'const asset = new URL("./worker.wasm", import.meta.url);',
    ].join("\n"),
    "apps/web/src/client.test.ts": 'fetch("/api/app-test-only");',
    "apps/runtime-node/package.json": JSON.stringify({
      optionalDependencies: { "tree-sitter-bash": "1.0.0" },
    }),
    "electron/build.cjs": 'const output = ".next/standalone"; require("./server");',
    "packages/agent-runtime/client/src/transport.ts":
      "const socket = new WebSocket(window.location.origin);",
    "packages/agent-runtime/client/test/transport.test.ts":
      'const socket = new WebSocket("ws://test-only");',
    "package.json": JSON.stringify({ dependencies: { "node-pty": "1.0.0" } }),
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  const inventory = await migrationPathInventory({
    repositoryRoot: root,
    files: [
      "apps/runtime-node/package.json",
      "apps/web/src/client.ts",
      "apps/web/src/client.test.ts",
      "electron/build.cjs",
      "package.json",
      "packages/agent-runtime/client/src/transport.ts",
      "packages/agent-runtime/client/test/transport.test.ts",
    ],
  });
  assert.deepEqual(
    inventory.map((entry) => entry.category),
    [
      "dynamic-module-load",
      "dynamic-module-load",
      "hardcoded-api-path",
      "native-package",
      "native-package",
      "next-output-path",
      "runtime-asset",
      "websocket-origin",
      "websocket-origin",
      "window-location",
      "window-location",
    ],
  );
  assert.equal(
    inventory.some((entry) => entry.file === "apps/web/src/client.test.ts"),
    false,
  );
  assert.deepEqual(
    inventory.find((entry) => entry.file === "apps/runtime-node/package.json"),
    {
      category: "native-package",
      file: "apps/runtime-node/package.json",
      line: 1,
      detail: "optionalDependencies:tree-sitter-bash",
    },
  );
  assert.equal(
    inventory.some(
      (entry) => entry.file === "packages/agent-runtime/client/test/transport.test.ts",
    ),
    false,
  );
  assert.deepEqual(
    inventory.find((entry) => entry.category === "native-package" && entry.file === "package.json"),
    { category: "native-package", file: "package.json", line: 1, detail: "dependencies:node-pty" },
  );
});

test("checked Phase 0 metadata snapshot detects inventory or ownership drift", async () => {
  const snapshot = JSON.parse(
    await readFile(
      path.join(REPOSITORY_ROOT, "docs/migration/phase-0-repository-inventory.json"),
      "utf8",
    ),
  );
  assert.deepEqual(phaseZeroSnapshotViolations(snapshot, await phaseZeroMetadata()), []);
});

test("baseline revision is generation evidence, not a permanent snapshot gate", async (t) => {
  const root = await fixture({ "apps/web/src/client.ts": 'fetch("/api/session.list");' });
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = ["apps/web/src/client.ts"];
  const atFirstRevision = await phaseZeroMetadata({
    repositoryRoot: root,
    files,
    revision: "first",
  });
  const atSecondRevision = await phaseZeroMetadata({
    repositoryRoot: root,
    files,
    revision: "second",
  });
  assert.notEqual(atFirstRevision.baselineRevision, atSecondRevision.baselineRevision);
  assert.deepEqual(phaseZeroSnapshotViolations(atFirstRevision, atSecondRevision), []);
});
