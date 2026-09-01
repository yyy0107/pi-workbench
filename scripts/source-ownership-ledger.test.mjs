import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  isRootProductionSource,
  isRootProductionSourceReference,
  ownershipViolations,
  sourceClosureViolations,
  sourceOwnershipLedger,
  versionControlledFiles,
} from "./source-ownership-ledger.mjs";

test("version-controlled candidates are stable before and after staging", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workbench-source-ledger-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  await mkdir(path.join(root, "app"), { recursive: true });
  await writeFile(path.join(root, ".gitignore"), "ignored.ts\n");
  await writeFile(path.join(root, "app/page.tsx"), "export default function Page() {}\n");
  await writeFile(path.join(root, "middleware.ts"), "export const middleware = true;\n");
  await writeFile(path.join(root, "ignored.ts"), "export const ignored = true;\n");
  execFileSync("git", ["add", ".gitignore", "app/page.tsx"], { cwd: root });

  const before = versionControlledFiles(root);
  execFileSync("git", ["add", "middleware.ts"], { cwd: root });

  assert.deepEqual(versionControlledFiles(root), before);
  assert.deepEqual(before, [".gitignore", "app/page.tsx", "middleware.ts"]);

  await rm(path.join(root, "app/page.tsx"));
  assert.deepEqual(versionControlledFiles(root), [".gitignore", "middleware.ts"]);
});

test("selects only tracked root production source and excludes tests/tooling", () => {
  assert.equal(isRootProductionSource("app/page.tsx"), true);
  assert.equal(isRootProductionSource("electron/main.cjs"), true);
  assert.equal(isRootProductionSource("server.ts"), true);
  assert.equal(isRootProductionSource("run_scripts/linux/launch.cjs"), false);
  assert.equal(isRootProductionSource("components/button.test.tsx"), false);
  assert.equal(isRootProductionSource("scripts/task.mjs"), false);
  assert.equal(isRootProductionSource("packages/example/src/index.ts"), false);
  assert.equal(isRootProductionSource("docs/example.ts"), false);
  assert.equal(isRootProductionSource("middleware.ts"), true);
  assert.equal(isRootProductionSource("new-root/feature.ts"), true);
  assert.equal(isRootProductionSource(".agents/skills/tool.cjs"), false);
  assert.equal(isRootProductionSourceReference("components/button"), true);
  assert.equal(isRootProductionSourceReference("new-root/feature.ts"), true);
  assert.equal(isRootProductionSourceReference("scripts/task.mjs"), false);
  assert.equal(isRootProductionSourceReference("apps/web/src/page.tsx"), false);
});

test("assigns only the remaining transitional root sources an auditable owner record", () => {
  const files = [
    "runtime/server/http/workbench-http-server.ts",
    "runtime/server/installed-api-only-runtime-host.ts",
    "runtime/server/installed-runtime-service.ts",
    "runtime/server/runtime-control-stdout.ts",
    "runtime/server/runtime-rpc-warmup.ts",
    "electron/main.cjs",
    "apps/web/src/app/page.tsx",
    "apps/web/src/server.ts",
  ];
  const records = sourceOwnershipLedger({ files });
  assert.equal(records.length, files.length - 2);
  assert.deepEqual(ownershipViolations(records), []);
  assert.deepEqual(
    records.find((record) => record.file === "runtime/server/http/workbench-http-server.ts"),
    {
      file: "runtime/server/http/workbench-http-server.ts",
      environment: "node",
      consumers: ["runtime-node"],
      targetOwner: "packages/host/server",
      migrationPhase: 2,
    },
  );
  for (const file of [
    "runtime/server/installed-api-only-runtime-host.ts",
    "runtime/server/installed-runtime-service.ts",
    "runtime/server/runtime-control-stdout.ts",
    "runtime/server/runtime-rpc-warmup.ts",
  ]) {
    assert.deepEqual(
      records.find((record) => record.file === file),
      {
        file,
        environment: "node",
        consumers: ["runtime-node"],
        targetOwner: "apps/runtime-node",
        migrationPhase: 4,
      },
    );
  }
  assert.deepEqual(
    records.find((record) => record.file === "electron/main.cjs"),
    {
      file: "electron/main.cjs",
      environment: "desktop",
      consumers: ["desktop-electron"],
      targetOwner: "apps/desktop-electron",
      migrationPhase: 7,
    },
  );
});

test("relocated Web roots cannot silently reappear under their legacy paths", () => {
  const files = [
    "app/page.tsx",
    "components/button.tsx",
    "i18n/server.ts",
    "server.ts",
    "workbench/server/next-web-handler.ts",
  ];
  const records = sourceOwnershipLedger({ files });
  assert.equal(records.length, files.length);
  const violations = ownershipViolations(records);
  for (const file of files) {
    assert.ok(violations.includes(`unassigned targetOwner: ${file}`), file);
  }
  assert.deepEqual(
    sourceClosureViolations({ files, mode: "strict" }),
    files.map((file) => `root production source is forbidden in strict mode: ${file}`),
  );
});

test("unknown root production source is never silently omitted from ownership", () => {
  const files = ["middleware.ts", "new-root/feature.ts"];
  const records = sourceOwnershipLedger({ files });

  assert.deepEqual(
    records.map((record) => record.file),
    files,
  );
  assert.deepEqual(ownershipViolations(records), [
    "unassigned environment: middleware.ts",
    "unassigned targetOwner: middleware.ts",
    "unassigned migrationPhase: middleware.ts",
    "unassigned consumers: middleware.ts",
    "unassigned environment: new-root/feature.ts",
    "unassigned targetOwner: new-root/feature.ts",
    "unassigned migrationPhase: new-root/feature.ts",
    "unassigned consumers: new-root/feature.ts",
  ]);
  assert.deepEqual(sourceClosureViolations({ files, mode: "strict" }), [
    "root production source is forbidden in strict mode: middleware.ts",
    "root production source is forbidden in strict mode: new-root/feature.ts",
  ]);
});

test("phase-0 closure detects stale records while strict mode closes transitional roots", () => {
  const files = ["electron/main.cjs", "runtime/server/http/workbench-http-server.ts"];
  const ledger = sourceOwnershipLedger({ files });
  assert.deepEqual(sourceClosureViolations({ files, ledger }), []);
  assert.deepEqual(sourceClosureViolations({ files, ledger: ledger.slice(0, 1) }), [
    "root production source is missing from the ownership ledger: runtime/server/http/workbench-http-server.ts",
  ]);
  assert.deepEqual(sourceClosureViolations({ files, mode: "strict", ledger }), [
    "root production source is forbidden in strict mode: electron/main.cjs",
    "root production source is forbidden in strict mode: runtime/server/http/workbench-http-server.ts",
  ]);
});
