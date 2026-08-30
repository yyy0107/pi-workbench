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
  - "packages/agent-runtime/core/*"

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
    "packages/agent-runtime/core/*",
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
        'import "node:assert";\nimport "@workbench/base";\nimport type { ReactNode } from "react";\nexport type Value = ReactNode;\n',
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
