import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseWorkspacePackagePatterns } from "./check-workspace-dependencies.mjs";
import { testGlobs } from "./run-typescript-tests.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));

async function json(relativeFile) {
  return JSON.parse(await readFile(path.join(REPOSITORY_ROOT, relativeFile), "utf8"));
}

test("uses exact, non-overlapping workspace leaf patterns", async () => {
  const source = await readFile(path.join(REPOSITORY_ROOT, "pnpm-workspace.yaml"), "utf8");
  assert.deepEqual(parseWorkspacePackagePatterns(source), [
    "apps/*",
    "packages/contracts/*",
    "packages/server/*",
    "packages/agent-runtime/core/*",
    "packages/agent-runtime/adapters/pi/*",
    "packages/extension-platform/*",
    "packages/host/*",
    "packages/terminal/*",
    "packages/workbench/*",
  ]);
});

test("keeps Next and the root alias out of the shared TypeScript config", async () => {
  const base = await json("tsconfig.base.json");
  assert.equal(base.compilerOptions.paths, undefined);
  assert.equal(base.compilerOptions.plugins, undefined);
  assert.equal(base.compilerOptions.noEmit, true);
  assert.equal(base.compilerOptions.strict, true);
});

test("the tooling-only root has no empty application TypeScript project", async () => {
  await assert.rejects(readFile(path.join(REPOSITORY_ROOT, "tsconfig.json"), "utf8"), {
    code: "ENOENT",
  });
});

test("root package scripts run app and package checks without recursively selecting the root", async () => {
  const manifest = await json("package.json");
  assert.match(manifest.scripts.prebuild, /prepare-workbench-build\.cjs/u);
  assert.equal(manifest.scripts["icons:sync"], "pnpm --filter @workbench/web run icons:sync");
  assert.equal(
    manifest.scripts["file-viewer:sync"],
    "pnpm --filter @workbench/web run file-viewer:sync",
  );
  assert.equal(
    manifest.scripts.build,
    "pnpm --filter @workbench/runtime-node build && pnpm --filter @workbench/web build && pnpm --filter @workbench/desktop-electron run build",
  );
  assert.equal(
    manifest.scripts["electron:dev"],
    "pnpm --filter @workbench/desktop-electron build && node scripts/electron-dev-orchestrator.mjs",
  );
  assert.equal(manifest.scripts.typecheck, "pnpm typecheck:apps && pnpm typecheck:packages");
  assert.equal(manifest.scripts.test, "pnpm test:root && pnpm test:apps && pnpm test:packages");
  assert.match(manifest.scripts["typecheck:apps"], /--filter '\.\/apps\/\*\*'/);
  assert.match(manifest.scripts["test:apps"], /--filter '\.\/apps\/\*\*'/);
  assert.match(manifest.scripts["typecheck:packages"], /--filter '\.\/packages\/\*\*'/);
  assert.match(manifest.scripts["test:packages"], /--filter '\.\/packages\/\*\*'/);
  assert.equal(manifest.scripts["typecheck:root"], undefined);
  assert.doesNotMatch(manifest.scripts["test:root"], /recursive|\s-r\s/);
});

test("the root manifest owns repository tooling only and does not depend on hoisting", async () => {
  const manifest = await json("package.json");
  assert.equal(manifest.dependencies, undefined);
  assert.deepEqual(manifest.devDependencies, {
    "@workbench/agent-runtime-pi-contributions": "workspace:*",
    "@workbench/extension-sdk": "workspace:*",
    "@workbench/host-contracts": "workspace:*",
    "@workbench/host-server": "workspace:*",
    "@workbench/shell": "workspace:*",
    oxfmt: "^0.62.0",
    oxlint: "^1.77.0",
    tsx: "^4.23.12",
  });
  await assert.rejects(readFile(path.join(REPOSITORY_ROOT, ".npmrc"), "utf8"), {
    code: "ENOENT",
  });
});

test("the Web app owns its asset synchronization and standalone support tools", async () => {
  const rootManifest = await json("package.json");
  const webManifest = await json("apps/web/package.json");
  assert.equal(webManifest.scripts["icons:sync"], "node scripts/sync-material-icon-theme.mjs");
  assert.equal(webManifest.scripts["file-viewer:sync"], "node scripts/sync-file-viewer-assets.mjs");
  assert.equal(webManifest.scripts["smoke:standalone"], "node scripts/web-standalone-smoke.cjs");
  assert.equal(webManifest.devDependencies["file-viewer-copy-assets"], "2.3.0");
  assert.equal(webManifest.devDependencies["material-icon-theme"], "^5.37.0");
  assert.equal(rootManifest.dependencies?.["material-icon-theme"], undefined);
  assert.equal(rootManifest.devDependencies["file-viewer-copy-assets"], undefined);
});

test("the central test runner leaves app-owned tests to workspace scripts", async () => {
  const runnerSource = await readFile(
    path.join(REPOSITORY_ROOT, "scripts/run-typescript-tests.mjs"),
    "utf8",
  );
  const globs = await testGlobs();
  const webGlobs = await testGlobs({
    projectDirectory: path.join(REPOSITORY_ROOT, "apps", "web"),
  });
  assert.equal(runnerSource.includes("process.cwd()"), false);
  for (const directory of ["run_scripts", "scripts"]) {
    assert.ok(
      globs.includes(`${directory}/**/*.{test,spec}.{js,cjs,mjs,ts,cts,mts,jsx,tsx}`),
      `${directory} tests must remain in the root test suite`,
    );
  }
  assert.equal(
    globs.some((glob) => glob.startsWith("packages/")),
    false,
  );
  assert.equal(
    globs.some((glob) => glob.startsWith("apps/")),
    false,
  );
  assert.equal(
    globs.some((glob) => glob.startsWith("electron/")),
    false,
  );
  assert.ok(webGlobs.includes("apps/web/test/**/*.{test,spec}.{js,cjs,mjs,ts,cts,mts,jsx,tsx}"));
});
