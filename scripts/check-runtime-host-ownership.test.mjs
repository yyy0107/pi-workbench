import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  INSTALLED_PI_COMPOSITION_OWNER,
  installedPiCompositionViolations,
  moduleReferences,
  runtimeApplicationBoundaryViolations,
  runtimeHostOwnershipViolations,
} from "./check-runtime-host-ownership.mjs";
import {
  FORBIDDEN_RUNTIME_ROUTE_SOURCE_PATHS,
  permanentSourceClosureViolations,
} from "./check-source-closure.mjs";

test("removed Runtime transition routes are forbidden instead of required", () => {
  const files = [
    ...FORBIDDEN_RUNTIME_ROUTE_SOURCE_PATHS,
    "apps/web/src/server/runtime-api-route-delegator.ts",
  ];
  assert.deepEqual(
    permanentSourceClosureViolations({ files }),
    files.map((file) => `removed transition production source is forbidden: ${file}`).sort(),
  );
});

test("allows only the installed Pi composition owner to construct/access the Runtime graph", () => {
  const owner = [
    "createPiRuntimeHttpRouter();",
    "createDefaultPiRpcRouteGroups();",
    "createPiRpcRouter();",
    "createPiAgentServerInstallation();",
    "getStreamHub();",
  ].join("\n");
  const unsafe = [
    "createPiRuntimeHttpRouter();",
    "createDefaultPiRpcRouteGroups();",
    "createPiRpcRouter();",
    "getInteractiveResponseRegistry();",
    "getStreamHub();",
    "new InteractiveResponseRegistry();",
  ].join("\n");
  assert.deepEqual(
    installedPiCompositionViolations(
      new Map([
        [INSTALLED_PI_COMPOSITION_OWNER, owner],
        ["apps/web/src/server.ts", "// getStreamHub()"],
      ]),
    ),
    [],
  );
  const violations = installedPiCompositionViolations(
    new Map([["apps/web/src/server.ts", unsafe]]),
  );
  assert.equal(violations.length, 6, JSON.stringify(violations, null, 2));
  assert.ok(violations.every((violation) => violation.includes(INSTALLED_PI_COMPOSITION_OWNER)));

  assert.deepEqual(
    installedPiCompositionViolations(
      new Map([
        [
          INSTALLED_PI_COMPOSITION_OWNER,
          "createPiRuntimeHttpRouter(); createPiRuntimeHttpRouter();",
        ],
      ]),
    ),
    [
      `${INSTALLED_PI_COMPOSITION_OWNER}: installed Pi composition must call createPiRuntimeHttpRouter once, found 2`,
    ],
  );
});

test("resolves protected factory and registry import aliases before enforcing ownership", () => {
  const unsafe = [
    'import { createPiRuntimeHttpRouter as makeRouter, InteractiveResponseRegistry as Registry } from "@workbench/agent-runtime-pi-server";',
    "makeRouter();",
    "new Registry();",
  ].join("\n");
  assert.deepEqual(
    installedPiCompositionViolations(new Map([["apps/web/src/server.ts", unsafe]])),
    [
      `apps/web/src/server.ts: only ${INSTALLED_PI_COMPOSITION_OWNER} may call InteractiveResponseRegistry to create/access the installed Pi Runtime graph`,
      `apps/web/src/server.ts: only ${INSTALLED_PI_COMPOSITION_OWNER} may call createPiRuntimeHttpRouter to create/access the installed Pi Runtime graph`,
    ],
  );

  const owner = [
    'import { createPiRuntimeHttpRouter as makeRouter } from "@workbench/agent-runtime-pi-server";',
    "makeRouter();",
    "makeRouter();",
  ].join("\n");
  assert.deepEqual(
    installedPiCompositionViolations(new Map([[INSTALLED_PI_COMPOSITION_OWNER, owner]])),
    [
      `${INSTALLED_PI_COMPOSITION_OWNER}: installed Pi composition must call createPiRuntimeHttpRouter once, found 2`,
    ],
  );
});

test("rejects namespace, CommonJS, assignment, and re-export factory aliases", () => {
  const bypasses = [
    [
      'import * as runtimeFactories from "@workbench/agent-runtime-pi-server";',
      "runtimeFactories.createPiRuntimeHttpRouter();",
    ].join("\n"),
    [
      'const { createPiRuntimeHttpRouter: makeRouter } = require("@workbench/agent-runtime-pi-server");',
      "makeRouter();",
    ].join("\n"),
    "const makeRouter = createPiRuntimeHttpRouter;\nmakeRouter();",
    'export { createPiRuntimeHttpRouter as makeRouter } from "@workbench/agent-runtime-pi-server";',
  ];
  for (const bypass of bypasses) {
    const violations = installedPiCompositionViolations(
      new Map([["apps/web/src/server.ts", bypass]]),
    );
    assert.ok(
      violations.some((violation) => violation.includes("createPiRuntimeHttpRouter")),
      bypass,
    );
  }

  assert.ok(
    installedPiCompositionViolations(
      new Map([
        ["apps/web/src/server.ts", "(await import(moduleName)).createPiRuntimeHttpRouter();"],
      ]),
    ).some((violation) => violation.includes("createPiRuntimeHttpRouter")),
  );
});

test("module reference extraction is source-aware across static/export/dynamic/require forms", () => {
  const references = moduleReferences(
    [
      'import "static";',
      'export * from "exported";',
      'void import("dynamic");',
      'require("required");',
      '// import "comment";',
      'const label = "require(\\\"string\\\")";',
    ].join("\n"),
  );
  assert.deepEqual(
    references.map((reference) => [reference.kind, reference.specifier]),
    [
      ["import", "static"],
      ["export", "exported"],
      ["dynamic import", "dynamic"],
      ["require", "required"],
    ],
  );
});

test("keeps the Runtime app graph one-way and physically owned by apps/runtime-node", () => {
  assert.equal(
    INSTALLED_PI_COMPOSITION_OWNER,
    "apps/runtime-node/src/composition/installed-pi-server.ts",
  );
  assert.deepEqual(
    runtimeApplicationBoundaryViolations(
      new Map([
        ["apps/web/src/server.ts", 'import "../../runtime-node/src/main";'],
        [
          "apps/runtime-node/src/main.ts",
          'import "../../../apps/web/src/server/workbench-settings";',
        ],
      ]),
    ),
    [
      "apps/web/src/server.ts: Application/supervisor source must not import the Runtime application graph (../../runtime-node/src/main)",
      "apps/runtime-node/src/main.ts: Runtime application source must not import another application source (../../../apps/web/src/server/workbench-settings)",
    ],
  );
});

test("rejects Electron production source imports of the Runtime app graph", () => {
  assert.deepEqual(
    runtimeApplicationBoundaryViolations(
      new Map([
        [
          "apps/desktop-electron/scripts/native-runtime.cjs",
          'require("../../runtime-node/scripts/build-runtime-artifact.ts");',
        ],
      ]),
    ),
    [
      "apps/desktop-electron/scripts/native-runtime.cjs: Application/supervisor source must not import the Runtime application graph (../../runtime-node/scripts/build-runtime-artifact.ts)",
    ],
  );
});

test("evaluates only exact path.join/path.resolve dirname module references across app boundaries", () => {
  const violations = runtimeApplicationBoundaryViolations(
    new Map([
      [
        "apps/desktop-electron/scripts/native-runtime.cjs",
        'require(path.join(__dirname, "../../runtime-node/scripts/build-runtime-artifact.ts"));',
      ],
      [
        "apps/runtime-node/scripts/escape-web.ts",
        'void import(path.resolve(__dirname, "../../web/src/server.ts"));',
      ],
      [
        "apps/runtime-node/scripts/escape-desktop.ts",
        'require(path.join(__dirname, "../../desktop-electron/src/main.cjs"));',
      ],
      [
        "apps/runtime-node/scripts/absolute-resolve.ts",
        'require(path.resolve(__dirname, "/external/apps/web/server.ts"));',
      ],
      [
        "apps/runtime-node/scripts/local.ts",
        'require(path.join(__dirname, "./local-helper.cjs"));',
      ],
    ]),
  );
  assert.equal(violations.length, 4);
  assert.ok(violations.some((violation) => violation.includes("build-runtime-artifact.ts")));
  assert.ok(violations.some((violation) => violation.includes("../../web/src/server.ts")));
  assert.ok(violations.some((violation) => violation.includes("desktop-electron/src/main.cjs")));
  assert.ok(violations.some((violation) => violation.includes("/external/apps/web/server.ts")));
  assert.equal(
    violations.some((violation) => violation.includes("local-helper")),
    false,
  );
});

test("allows only the two exact audited non-literal module signatures", () => {
  assert.deepEqual(
    runtimeApplicationBoundaryViolations(
      new Map([
        [
          "apps/desktop-electron/scripts/native-runtime-smoke.cjs",
          'require(path.join(nodePtyRoot, "lib", "utils.js"));',
        ],
        ["apps/desktop-electron/src/packaged-runtime-lifecycle.cjs", "require(supportPath);"],
      ]),
    ),
    [],
  );

  for (const [filename, source] of [
    [
      "apps/desktop-electron/scripts/native-runtime-smoke.cjs",
      'require(path.join(nodePtyRoot, "lib", dynamicName));',
    ],
    [
      "apps/desktop-electron/src/packaged-runtime-lifecycle.cjs",
      "require(supportPath); require(supportPath);",
    ],
    ["apps/runtime-node/scripts/unknown.cjs", "require(runtimeSourcePath);"],
  ]) {
    assert.ok(runtimeApplicationBoundaryViolations(new Map([[filename, source]])).length > 0);
  }
});

test("repository ownership scan includes Runtime scripts and catches computed app escapes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workbench-runtime-script-guard-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  async function write(relativeFilename, source) {
    const filename = path.join(root, relativeFilename);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, source);
  }
  await write("apps/web/src/server/runtime-connected-web-host.ts", "export {};");
  await write(
    "apps/runtime-node/scripts/escape.cjs",
    'require(path.join(__dirname, "../../desktop-electron/src/main.cjs"));',
  );
  const violations = await runtimeHostOwnershipViolations(root);
  assert.ok(
    violations.some(
      (violation) =>
        violation.includes("apps/runtime-node/scripts/escape.cjs") &&
        violation.includes("desktop-electron/src/main.cjs"),
    ),
  );
});

test("reports nonliteral dynamic import and require expressions", () => {
  assert.deepEqual(
    moduleReferences("void import(moduleName); require(resolveModule());").map((reference) => [
      reference.kind,
      reference.specifier,
      reference.literal,
    ]),
    [
      ["dynamic import", "<non-literal>", false],
      ["require", "<non-literal>", false],
    ],
  );
});

test("resolves trusted createRequire and module.require loader forms without matching shadowed locals", () => {
  const references = moduleReferences(
    [
      'import { createRequire as makeRequire } from "node:module";',
      'import * as nodeModule from "node:module";',
      "const assigned = makeRequire(__filename);",
      'assigned("assigned");',
      'makeRequire(import.meta.url)("direct");',
      'nodeModule.createRequire(import.meta.url)("namespace");',
      "const moduleLoader = module.require.bind(module);",
      'moduleLoader("module-alias");',
      'module.require("module-direct");',
      "const { require: destructuredLoader } = module;",
      'destructuredLoader("module-destructured");',
    ].join("\n"),
  );
  assert.deepEqual(
    references.map((reference) => [reference.kind, reference.specifier]),
    [
      ["import", "node:module"],
      ["import", "node:module"],
      ["require", "assigned"],
      ["require", "direct"],
      ["require", "namespace"],
      ["require", "module-alias"],
      ["require", "module-direct"],
      ["require", "module-destructured"],
    ],
  );

  assert.deepEqual(
    moduleReferences(
      [
        "function createRequire() { return () => undefined; }",
        'createRequire(__filename)("shadowed-factory");',
        "function invoke(module) {",
        "  const load = module.require;",
        '  load("shadowed-module");',
        "}",
      ].join("\n"),
    ),
    [],
  );
});

test("resolves loader trust per lexical scope across CJS, assignments, and direct calls", () => {
  const references = moduleReferences(
    [
      'import { createRequire } from "node:module";',
      'import * as importedModule from "node:module";',
      'const requiredModule = require("node:module");',
      "const requiredAlias = requiredModule;",
      "const { createRequire: destructuredFactory } = requiredAlias;",
      "const assignedFactory = importedModule.createRequire;",
      "let assignedLoader;",
      "assignedLoader = assignedFactory(import.meta.url);",
      'assignedLoader("assigned-loader");',
      'destructuredFactory(__filename)("cjs-destructured");',
      'require("node:module").createRequire(import.meta.url)("cjs-direct");',
      'module.require("node:module").createRequire(import.meta.url)("module-cjs-direct");',
      "const moduleAlias = module;",
      "const directModuleLoader = moduleAlias.require;",
      "const boundModuleLoader = module.require.bind(moduleAlias);",
      'directModuleLoader("module-assigned");',
      'boundModuleLoader("module-bound");',
      "function shadowed(createRequire, importedModule, module, require, assignedLoader) {",
      '  createRequire(__filename)("shadowed-factory");',
      '  importedModule.createRequire(__filename)("shadowed-namespace");',
      '  module.require("shadowed-module");',
      '  require("shadowed-require");',
      '  assignedLoader("shadowed-loader");',
      "}",
      "{",
      "  const createRequire = () => () => undefined;",
      '  createRequire(__filename)("block-shadowed");',
      "}",
      'createRequire(import.meta.url)("outer-import");',
      'module.require("outer-module");',
      'require("outer-require");',
    ].join("\n"),
  );
  assert.deepEqual(
    references.map((reference) => reference.specifier),
    [
      "node:module",
      "node:module",
      "node:module",
      "assigned-loader",
      "cjs-destructured",
      "node:module",
      "cjs-direct",
      "node:module",
      "module-cjs-direct",
      "module-assigned",
      "module-bound",
      "outer-import",
      "outer-module",
      "outer-require",
    ],
  );
});

test("keeps arrow, catch, and method loader shadows local", () => {
  assert.deepEqual(
    moduleReferences(
      [
        'import { createRequire } from "node:module";',
        'const invoke = (createRequire) => createRequire(__filename)("arrow-shadowed");',
        'const typedInvoke = (module: Loader): void => module.require("typed-arrow-shadowed");',
        'try {} catch (module) { module.require("catch-shadowed"); }',
        'const holder = { invoke(module) { module.require("method-shadowed"); } };',
        'const typedHolder = { invoke(module: Loader): Promise<{ ok: boolean }> { module.require("typed-method-shadowed"); } };',
        'function typed(module: Loader): { ok: boolean } { module.require("typed-function-shadowed"); return { ok: true }; }',
        'for (const module of modules) { module.require("loop-shadowed"); }',
        'createRequire(import.meta.url)("outer");',
        'module.require("outer-module");',
      ].join("\n"),
    ).map((reference) => reference.specifier),
    ["node:module", "outer", "outer-module"],
  );
});

test("fails closed when a trusted loader is rebound with an unproved receiver", () => {
  const references = moduleReferences(
    [
      "const rebound = module.require.bind(possiblyModule);",
      "rebound(runtimeSourcePath);",
      "const reboundRequire = require.bind(null);",
      "reboundRequire(otherSourcePath);",
    ].join("\n"),
  );
  assert.deepEqual(
    references.map((reference) => [reference.specifier, reference.loaderBase]),
    [
      ["<non-literal>", "unknown"],
      ["<non-literal>", "unknown"],
    ],
  );
});

test("repository ownership scan closes createRequire and module.require application bypasses", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workbench-loader-alias-guard-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  async function write(relativeFilename, source) {
    const filename = path.join(root, relativeFilename);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, source);
  }
  await write("apps/web/src/server/runtime-connected-web-host.ts", "export {};");

  const bypasses = new Map([
    [
      "apps/desktop-electron/scripts/assigned-create-require.cjs",
      [
        'const { createRequire: makeRequire } = require("node:module");',
        "const load = makeRequire(__filename);",
        'load("../../runtime-node/src/main.ts");',
      ].join("\n"),
    ],
    [
      "apps/desktop-electron/src/direct-create-require.mjs",
      [
        'import { createRequire } from "node:module";',
        'createRequire(import.meta.url)("../../runtime-node/src/main.ts");',
      ].join("\n"),
    ],
    [
      "apps/desktop-electron/src/namespace-create-require.mjs",
      [
        'import * as nodeModule from "node:module";',
        "const load = nodeModule.createRequire(import.meta.url);",
        'load("../../runtime-node/src/main.ts");',
      ].join("\n"),
    ],
    [
      "apps/runtime-node/scripts/module-require-desktop.cjs",
      [
        "const load = module.require.bind(module);",
        'load("../../desktop-electron/src/main.cjs");',
      ].join("\n"),
    ],
    [
      "apps/runtime-node/scripts/destructured-module-require-web.cjs",
      ["const { require: load } = module;", 'load("../../web/src/server.ts");'].join("\n"),
    ],
    [
      "apps/runtime-node/scripts/commonjs-create-require-web.cjs",
      [
        'const nodeModule = require("node:module");',
        "const { createRequire: makeRequire } = nodeModule;",
        "const load = makeRequire(__filename);",
        'load("../../web/src/server.ts");',
      ].join("\n"),
    ],
    [
      "apps/desktop-electron/scripts/dynamic-create-require.cjs",
      [
        'const { createRequire } = require("node:module");',
        "const load = createRequire(__filename);",
        "load(runtimeSourcePath);",
      ].join("\n"),
    ],
    [
      "apps/runtime-node/scripts/dynamic-module-require.cjs",
      "const load = module.require;\nload(webSourcePath);",
    ],
  ]);
  for (const [filename, source] of bypasses) await write(filename, source);

  const violations = await runtimeHostOwnershipViolations(root);
  for (const filename of bypasses.keys()) {
    assert.ok(
      violations.some((violation) => violation.includes(filename)),
      `${filename}\n${JSON.stringify(violations, null, 2)}`,
    );
  }
});
