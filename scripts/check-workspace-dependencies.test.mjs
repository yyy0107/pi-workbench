import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseWorkspacePackagePatterns,
  workspaceDependencyViolations,
} from "./check-workspace-dependencies.mjs";

const WORKSPACE_YAML = `packages:
  - "packages/contracts/*"
  - "packages/server/*"
  - "packages/agent-runtime/core/*"
  - "packages/agent-runtime/adapters/pi/*"
  - "packages/terminal/*"
  - "apps/*"

allowBuilds:
  esbuild: true
`;

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "workbench-workspace-boundary-"));
  await writeFile(path.join(root, "pnpm-workspace.yaml"), WORKSPACE_YAML);
  return root;
}

async function packageFixture(root, relativeDirectory, manifest, sources = {}) {
  const directory = path.join(root, relativeDirectory);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const [relativeFile, source] of Object.entries(sources)) {
    const filename = path.join(directory, relativeFile);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, source);
  }
}

test("reads only exact package entries from the pnpm workspace packages section", () => {
  assert.deepEqual(parseWorkspacePackagePatterns(WORKSPACE_YAML), [
    "packages/contracts/*",
    "packages/server/*",
    "packages/agent-runtime/core/*",
    "packages/agent-runtime/adapters/pi/*",
    "packages/terminal/*",
    "apps/*",
  ]);
});

test("accepts declared production, peer, development, builtin, and workspace imports", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await packageFixture(root, "packages/contracts/base", {
    name: "@workbench/base",
    private: true,
  });
  await packageFixture(
    root,
    "packages/agent-runtime/core/client",
    {
      name: "@workbench/client",
      private: true,
      dependencies: { "@workbench/base": "workspace:*" },
      peerDependencies: { react: "^19.0.0" },
      devDependencies: { typescript: "^7.0.0" },
    },
    {
      "src/index.ts":
        'import "node:assert";\nimport "./internal";\nimport "@workbench/base";\nimport type { ReactNode } from "react";\nexport type Value = ReactNode;\n',
      "src/internal.ts": "export const internal = true;\n",
      "test/index.test.ts": 'import ts from "typescript";\nvoid ts;\n',
    },
  );

  assert.deepEqual(await workspaceDependencyViolations(root), []);
});

test("rejects undeclared bare imports and development dependencies used by src", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await packageFixture(
    root,
    "packages/contracts/example",
    {
      name: "@workbench/example",
      private: true,
      devDependencies: { react: "^19.0.0" },
    },
    { "src/index.ts": 'import "react";\nimport "missing-package";\n' },
  );

  const violations = await workspaceDependencyViolations(root);
  assert.equal(violations.length, 2);
  assert.ok(violations.some((violation) => violation.includes("react is imported from src/")));
  assert.ok(violations.some((violation) => violation.includes("missing-package is imported")));
});

test("rejects workspace source internals and non-workspace dependency protocols", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await packageFixture(root, "packages/contracts/base", {
    name: "@workbench/base",
    private: true,
  });
  await packageFixture(
    root,
    "packages/agent-runtime/core/client",
    {
      name: "@workbench/client",
      private: true,
      dependencies: { "@workbench/base": "0.1.0" },
    },
    { "src/index.ts": 'export * from "@workbench/base/src/internal";\n' },
  );

  const violations = await workspaceDependencyViolations(root);
  assert.ok(violations.some((violation) => violation.includes("must use the workspace: protocol")));
  assert.ok(
    violations.some((violation) => violation.includes("do not import workspace source internals")),
  );
});

test("rejects imports of unknown Workbench packages", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await packageFixture(
    root,
    "packages/contracts/example",
    { name: "@workbench/example", private: true },
    { "src/index.ts": 'export * from "@workbench/not-installed";\n' },
  );

  const violations = await workspaceDependencyViolations(root);
  assert.ok(
    violations.some((violation) =>
      violation.includes("unknown Workbench workspace package @workbench/not-installed"),
    ),
  );
});

test("rejects production dependency cycles while allowing one-way package layering", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await packageFixture(root, "packages/contracts/base", {
    name: "@workbench/base",
    private: true,
    dependencies: { "@workbench/client": "workspace:*" },
  });
  await packageFixture(root, "packages/agent-runtime/core/client", {
    name: "@workbench/client",
    private: true,
    dependencies: { "@workbench/base": "workspace:*" },
  });

  const violations = await workspaceDependencyViolations(root);
  assert.ok(
    violations.includes(
      "workspace production dependency cycle: @workbench/base -> @workbench/client -> @workbench/base",
    ),
  );
});

test("rejects package source dependencies on app source through every supported boundary", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await packageFixture(
    root,
    "apps/web",
    { name: "@workbench/web", private: true },
    { "src/entry.ts": "export const web = true;\n" },
  );
  await packageFixture(
    root,
    "packages/contracts/consumer",
    {
      name: "@workbench/consumer",
      private: true,
      dependencies: { "@workbench/web": "workspace:*" },
    },
    {
      "src/static-import.ts": 'import "@workbench/web";\n',
      "src/dynamic-import.ts": 'void import("@workbench/web");\n',
      "src/require.ts": 'require("@workbench/web");\n',
      "src/relative-import.ts": 'import "../../../apps/web/src/entry";\n',
      "src/filesystem-read.ts":
        'await readFile(path.join(repositoryRoot, "apps", "web", "src", "entry.ts"));',
      "src/new-url-read.ts":
        'await readFile(new URL("../../../apps/web/src/entry.ts", import.meta.url));',
      "test/consumer.test.ts": 'import "@workbench/web";\n',
    },
  );

  const violations = await workspaceDependencyViolations(root);
  const packageBoundaryViolations = violations.filter((violation) =>
    violation.includes("packages must not depend on app source (apps/web)"),
  );
  assert.equal(packageBoundaryViolations.length, 7, JSON.stringify(violations, null, 2));
  assert.ok(packageBoundaryViolations.some((violation) => violation.includes("@workbench/web")));
  assert.ok(
    packageBoundaryViolations.some((violation) =>
      violation.includes("../../../apps/web/src/entry"),
    ),
  );
  assert.ok(
    packageBoundaryViolations.some((violation) => violation.includes("apps/web/src/entry.ts")),
  );
  assert.equal(
    violations.some((violation) => violation.includes("unknown Workbench workspace package")),
    false,
  );
});

test("rejects app-to-app source dependencies while allowing internal and package dependencies", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await packageFixture(
    root,
    "packages/contracts/base",
    { name: "@workbench/base", private: true },
    { "src/index.ts": "export const base = true;\n" },
  );
  await packageFixture(
    root,
    "apps/web",
    {
      name: "@workbench/web",
      private: true,
      dependencies: { "@workbench/base": "workspace:*" },
    },
    {
      "src/internal.ts": "export const internal = true;\n",
      "src/index.ts": [
        'import "./internal";',
        'import "@workbench/base";',
        'import "@workbench/desktop";',
        'import "../../desktop/src/entry";',
        'await readFile(new URL("../../desktop/src/entry.ts", import.meta.url));',
      ].join("\n"),
      "test/web.test.ts": 'await readFile(new URL("../src/internal.ts", import.meta.url));\n',
    },
  );
  await packageFixture(
    root,
    "apps/desktop",
    { name: "@workbench/desktop", private: true },
    { "src/entry.ts": "export const desktop = true;\n" },
  );

  const violations = await workspaceDependencyViolations(root);
  const appBoundaryViolations = violations.filter((violation) =>
    violation.includes("apps must not depend on another app source (apps/desktop)"),
  );
  assert.equal(appBoundaryViolations.length, 3, JSON.stringify(violations, null, 2));
  assert.ok(appBoundaryViolations.some((violation) => violation.includes("@workbench/desktop")));
  assert.ok(
    appBoundaryViolations.some((violation) => violation.includes("../../desktop/src/entry")),
  );
  assert.ok(
    appBoundaryViolations.some((violation) => violation.includes("../../desktop/src/entry.ts")),
  );
  assert.equal(
    violations.some((violation) => violation.includes("apps/web)")),
    false,
  );
});

test("rejects unused package-to-app manifest dependencies, including development dependencies", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await packageFixture(root, "apps/web", { name: "@workbench/web", private: true });
  await packageFixture(root, "packages/contracts/consumer", {
    name: "@workbench/consumer",
    private: true,
    devDependencies: { "@workbench/web": "workspace:*" },
  });

  const violations = await workspaceDependencyViolations(root);
  assert.deepEqual(violations, [
    "packages/contracts/consumer/package.json: packages must not declare app dependency (apps/web)",
  ]);
});

test("rejects unused app-to-app manifest dependencies", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await packageFixture(root, "apps/desktop", { name: "@workbench/desktop", private: true });
  await packageFixture(root, "apps/web", {
    name: "@workbench/web",
    private: true,
    dependencies: { "@workbench/desktop": "workspace:*" },
  });

  const violations = await workspaceDependencyViolations(root);
  assert.deepEqual(violations, [
    "apps/web/package.json: apps must not declare another app dependency (apps/desktop)",
  ]);
});

test("applies manifest and source dependency checks to apps while allowing app-to-package layering", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await packageFixture(
    root,
    "packages/contracts/base",
    { name: "@workbench/base", private: true },
    { "src/index.ts": "export const base = true;\n" },
  );
  await packageFixture(
    root,
    "apps/web",
    {
      name: "@workbench/web",
      private: true,
      dependencies: { "@workbench/base": "workspace:*" },
    },
    {
      "src/index.ts": 'import "./internal";\nimport "@workbench/base";\n',
      "src/internal.ts": "export const internal = true;\n",
    },
  );

  assert.deepEqual(await workspaceDependencyViolations(root), []);
});

test("rejects undeclared app imports and non-workspace app-to-package dependency protocols", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await packageFixture(root, "packages/contracts/base", { name: "@workbench/base", private: true });
  await packageFixture(
    root,
    "apps/web",
    {
      name: "@workbench/web",
      private: true,
      dependencies: { "@workbench/base": "0.1.0" },
    },
    {
      "src/index.ts":
        'import "@workbench/base";\nimport "@workbench/base/src/internal";\nimport "react";\n',
    },
  );

  const violations = await workspaceDependencyViolations(root);
  assert.deepEqual(violations, [
    "apps/web/package.json: @workbench/base must use the workspace: protocol",
    "apps/web/src/index.ts: do not import workspace source internals (@workbench/base/src/internal)",
    "apps/web/src/index.ts: react is imported from src/ but is not declared in the package manifest",
  ]);
});
