import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  FORBIDDEN_LEGACY_PRODUCTION_ROOTS,
  FORBIDDEN_RUNTIME_ROUTE_SOURCE_PATHS,
  FORBIDDEN_TRANSITION_SOURCE_PATHS,
  permanentSourceClosureViolations,
  repositorySourceClosureViolations,
} from "./check-source-closure.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));

test("allows only workspace-owned production source plus exact tooling/evidence/test fixtures", () => {
  assert.deepEqual(
    permanentSourceClosureViolations({
      files: [
        "apps/desktop-electron/scripts/desktop-artifact-support.cjs",
        "apps/web/src/server/runtime-connected-web-host.ts",
        "packages/host/server/src/workbench-http-server.ts",
        "scripts/check-source-closure.mjs",
        "run_scripts/linux/_run.sh",
        "public/browser-worker.js",
        "docs/migration/server.ts",
        "docs/migration/desktop-server-launcher.cjs",
        "apps/web/test/fixtures/server.ts",
        "packages/host/server/test-fixtures/legacy-source.ts",
        "components/button.test.tsx",
        "electron/test-fixtures/main.cjs",
        "fixtures/root-example.ts",
        "scripts/fixtures/desktop-server-launcher.cjs",
      ],
    }),
    [],
  );
});

test("closes every removed root owner and any unknown root production owner", () => {
  const files = [
    ...FORBIDDEN_LEGACY_PRODUCTION_ROOTS.map((root) => `${root}/owner.ts`),
    "new-root/owner.mjs",
    "test-utils/react-dom-environment.ts",
  ];
  const violations = permanentSourceClosureViolations({ files });
  for (const root of FORBIDDEN_LEGACY_PRODUCTION_ROOTS) {
    assert.ok(
      violations.includes(`removed legacy production source is forbidden: ${root}/owner.ts`),
      root,
    );
  }
  assert.ok(
    violations.includes(
      "production source must be owned by apps/** or packages/**: new-root/owner.mjs",
    ),
  );
  assert.ok(
    violations.includes(
      "removed legacy production source is forbidden: test-utils/react-dom-environment.ts",
    ),
  );
});

test("forbids every removed route, delegator, supervisor, and launcher reappearance", () => {
  const relocatedTransitionNames = [
    "apps/web/src/server/development-external-runtime-main.ts",
    "packages/host/server/src/development-external-runtime.ts",
    "run_scripts/linux/desktop-server-launcher.cjs",
    "apps/desktop-electron/scripts/build-desktop-server.cjs",
    "packages/workbench/host-contracts/src/development-web-control.ts",
  ];
  const files = [...FORBIDDEN_TRANSITION_SOURCE_PATHS, ...relocatedTransitionNames];
  const violations = permanentSourceClosureViolations({ files });
  for (const file of files) {
    assert.ok(
      violations.includes(`removed transition production source is forbidden: ${file}`),
      file,
    );
  }
  assert.deepEqual(
    FORBIDDEN_RUNTIME_ROUTE_SOURCE_PATHS.filter(
      (file) => !FORBIDDEN_TRANSITION_SOURCE_PATHS.includes(file),
    ),
    [],
  );
});

test("rejects source symlinks without treating resources, evidence, tests, or fixtures as source", () => {
  assert.deepEqual(
    permanentSourceClosureViolations({
      files: [
        "apps/web/src/linked-source",
        "components",
        "new-root",
        "public/assets/current",
        "docs/migration/legacy-source",
        "apps/web/test/fixtures/linked-source",
      ],
      symbolicLinks: [
        "apps/web/src/linked-source",
        "components",
        "new-root",
        "public/assets/current",
        "docs/migration/legacy-source",
        "apps/web/test/fixtures/linked-source",
      ],
    }),
    [
      "production source symlink is forbidden: apps/web/src/linked-source",
      "production source symlink is forbidden: new-root",
      "removed legacy production root is forbidden: components",
    ],
  );
});

test("the actual repository has no root or transition production source closure", () => {
  assert.deepEqual(repositorySourceClosureViolations(REPOSITORY_ROOT), []);
});

test("the workspace dependency gate invokes the permanent source closure exactly once", async () => {
  const manifest = JSON.parse(await readFile(path.join(REPOSITORY_ROOT, "package.json"), "utf8"));
  const command = manifest.scripts["check:workspace-dependencies"];
  assert.equal(
    command,
    "node scripts/check-workspace-dependencies.mjs && node scripts/check-transport-boundaries.mjs && node scripts/check-runtime-host-ownership.mjs && node scripts/check-source-closure.mjs",
  );
  assert.equal(command.match(/check-source-closure\.mjs/gu)?.length, 1);
});
