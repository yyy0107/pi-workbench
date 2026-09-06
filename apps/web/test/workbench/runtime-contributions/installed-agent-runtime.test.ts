import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import { piWorkbenchExtensions as installedWorkbenchExtensions } from "@workbench/pi-product/application";

const repositoryRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const IGNORED_DIRECTORIES = new Set([
  ".desktop-build",
  ".electron-build",
  ".git",
  ".next",
  "build",
  "coverage",
  "dist",
  "dist-electron",
  "node_modules",
  "out",
]);
const PI_IMPLEMENTATION_PREFIX = "packages/agent-runtime/runtimes/pi/";
const PI_CONTRIBUTIONS_PREFIX = "packages/agent-runtime/runtimes/pi/contributions/";
const LEGACY_PI_IMPLEMENTATION_PATH = ["packages", "agent-runtime", "adapters", "pi"] as const;
const LEGACY_PI_FACADE_PATH = [
  "apps",
  "web",
  "src",
  "workbench",
  "runtime-contributions",
  "pi",
] as const;
const PI_CLIENT_OR_SHARED_PREFIXES = [
  "@workbench/agent-runtime-pi-client/",
  "@workbench/agent-runtime-pi-shared/",
];

/**
 * The Runtime Node application is the one selected server implementation. Its Pi imports are
 * deliberately closed to the concrete composition/host files below: adding a Pi import to an
 * unrelated application module must be an explicit architecture decision, not a prefix match.
 */
const RUNTIME_NODE_PI_IMPORTS = new Map<string, readonly string[]>([
  [
    "apps/runtime-node/test/runtime-http-router.test.ts",
    ["@workbench/agent-runtime-pi-server/http", "@workbench/agent-runtime-pi-server/legacy"],
  ],
  [
    "apps/runtime-node/scripts/build-runtime-artifact.ts",
    ["@workbench/agent-runtime-pi-protocol/stream"],
  ],
  [
    "apps/runtime-node/src/composition/installed-automation.ts",
    ["@workbench/agent-runtime-pi-server/installation"],
  ],
  [
    "apps/runtime-node/src/composition/installed-pi-server.ts",
    [
      "@workbench/agent-runtime-pi-server/http",
      "@workbench/agent-runtime-pi-server/installation",
      "@workbench/agent-runtime-pi-server/legacy",
    ],
  ],
  [
    "apps/runtime-node/src/installed-api-only-runtime-host.ts",
    [
      "@workbench/agent-runtime-pi-server/installation",
      "@workbench/agent-runtime-pi-server/legacy",
    ],
  ],
  [
    "apps/runtime-node/test/installed-api-only-runtime-host.test.ts",
    ["@workbench/agent-runtime-pi-server/installation"],
  ],
  [
    "apps/runtime-node/src/installed-runtime-service.ts",
    ["@workbench/agent-runtime-pi-protocol/stream", "@workbench/agent-runtime-pi-server/websocket"],
  ],
  [
    "apps/runtime-node/test/installed-pi-server-rpc.test.ts",
    ["@workbench/agent-runtime-pi-protocol/rpc"],
  ],
  [
    "apps/runtime-node/test/session-extension-lifecycle.test.ts",
    [
      "@workbench/agent-runtime-pi-server/installation",
      "@workbench/agent-runtime-pi-server/legacy",
    ],
  ],
]);

/** Application composition can select Pi packages only at these exact seams. */
const APPLICATION_COMPOSITION_PI_IMPORTS = new Map<string, readonly string[]>([
  [
    "apps/desktop-electron/scripts/runtime-artifact-admission.cjs",
    ["@workbench/agent-runtime-pi-protocol/stream"],
  ],
  [
    "apps/web/src/server/runtime-connected-web-host.ts",
    ["@workbench/agent-runtime-pi-protocol/stream"],
  ],
  [
    "packages/workbench/pi-product/src/runtime-provider.tsx",
    ["@workbench/agent-runtime-pi-contributions/installation"],
  ],
  [
    "packages/workbench/pi-product/src/installation.tsx",
    ["@workbench/agent-runtime-pi-client/installation"],
  ],
  [
    "packages/workbench/pi-product/test/installed-agent-runtime.test.tsx",
    [
      "@workbench/agent-runtime-pi-client/installation",
      "@workbench/agent-runtime-pi-shared/descriptor",
    ],
  ],
  [
    "packages/workbench/pi-product/src/application.tsx",
    ["@workbench/agent-runtime-pi-contributions/installation"],
  ],
  [
    "packages/workbench/pi-product/src/extensions.ts",
    ["@workbench/agent-runtime-pi-contributions/installation"],
  ],
]);
const BOUNDARY_TEST_PI_IMPORTS = new Map<string, readonly string[]>([
  [
    "scripts/public-composition-imports.test.mjs",
    ["@workbench/agent-runtime-pi-contributions/installation"],
  ],
]);

const DIRECT_PI_PACKAGE_IMPORT =
  /(?:\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?|\b(?:import|require)\s*\()\s*["'](@workbench\/agent-runtime-pi-[a-z0-9-]+(?:\/[^"']*)?)["']/gu;
function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(absolutePath));
    else if (entry.isFile() && /\.[cm]?[jt]sx?$/u.test(entry.name)) files.push(absolutePath);
  }
  return files;
}

function packageManifestFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...packageManifestFiles(absolutePath));
    else if (entry.isFile() && entry.name === "package.json") files.push(absolutePath);
  }
  return files;
}

function directPiPackageImports(source: string): string[] {
  return [...source.matchAll(DIRECT_PI_PACKAGE_IMPORT)].map(([, specifier]) => specifier);
}

function permitsExactImport(
  imports: ReadonlyMap<string, readonly string[]>,
  file: string,
  specifier: string,
): boolean {
  return imports.get(file)?.includes(specifier) ?? false;
}

function isPermittedPiPackageImport(file: string, specifier: string): boolean {
  // The browser-only Pi contribution bundle may use Pi's browser/client contracts, but it must
  // never pull the Pi server implementation into the Web graph.
  if (file.startsWith(PI_CONTRIBUTIONS_PREFIX)) {
    return (
      PI_CLIENT_OR_SHARED_PREFIXES.some((prefix) => specifier.startsWith(prefix)) ||
      specifier.startsWith("@workbench/agent-runtime-pi-protocol/")
    );
  }

  // The concrete Pi implementation and its tests own the full Pi package family.
  if (file.startsWith(PI_IMPLEMENTATION_PREFIX)) return true;

  if (permitsExactImport(RUNTIME_NODE_PI_IMPORTS, file, specifier)) return true;
  if (permitsExactImport(APPLICATION_COMPOSITION_PI_IMPORTS, file, specifier)) return true;
  return permitsExactImport(BOUNDARY_TEST_PI_IMPORTS, file, specifier);
}

function directPiPackageImportViolations(sources: ReadonlyMap<string, string>): readonly string[] {
  return [...sources]
    .flatMap(([file, source]) =>
      directPiPackageImports(source)
        .filter((specifier) => !isPermittedPiPackageImport(file, specifier))
        .map(
          (specifier) =>
            `${file}: direct Pi package import is outside its owner boundary (${specifier})`,
        ),
    )
    .sort();
}

function piPackageManifestViolations(): readonly string[] {
  return packageManifestFiles(repositoryRoot)
    .flatMap((manifestPath) => {
      const file = path.relative(repositoryRoot, manifestPath).split(path.sep).join("/");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      const dependencies = {
        ...manifest.dependencies,
        ...manifest.devDependencies,
        ...manifest.optionalDependencies,
        ...manifest.peerDependencies,
      };
      return Object.keys(dependencies)
        .filter((dependency) => dependency.startsWith("@workbench/agent-runtime-pi-"))
        .filter(
          (dependency) =>
            !file.startsWith("apps/") &&
            !file.startsWith(PI_IMPLEMENTATION_PREFIX) &&
            file !== "packages/workbench/pi-product/package.json" &&
            !(
              file === "package.json" && dependency === "@workbench/agent-runtime-pi-contributions"
            ),
        )
        .map(
          (dependency) =>
            `${file}: Pi package dependency is outside its owner boundary (${dependency})`,
        );
    })
    .sort();
}

test("preserves the product-owned cross-package extension activation order", () => {
  assert.equal(Object.isFrozen(installedWorkbenchExtensions), true);
  const ids = installedWorkbenchExtensions.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, [
    "workbench.brand",
    "workbench.workspace-sidebar",
    "workbench.appearance",
    "workbench.locale-selector",
    "workbench.message-presentation",
    "workbench.message-actions",
    "workbench.user-message-index",
    "workbench.message-queue",
    "workbench.todo-panel",
    "workbench.archived-chats",
    "workbench.workspace-explorer",
    "workbench.workspace-review",
    "workbench.workspace-browser",
    "workbench.workspace-artifact",
    "workbench.terminal",
    "workbench.workspace-directory-picker",
    "workbench.git-branch",
    "workbench.settings",
    "workbench.agent-configuration",
    "workbench.interactive-requests",
    "workbench.side-chat",
    "workbench.setting-model-config",
    "workbench.pi.settings-action",
    "workbench.image-understanding",
    "workbench.toolbox",
    "workbench.automations",
    "workbench.model-selector",
    "workbench.connection-status",
    "workbench.context-trace",
    "workbench.about",
    "workbench.token-usage",
    "workbench.workspace-file",
  ]);
});

test("keeps the Pi Web contribution leaf independent of root aliases and host internals", () => {
  const contributionsRoot = path.join(
    repositoryRoot,
    "packages/agent-runtime/runtimes/pi/contributions",
  );
  const violations = sourceFiles(contributionsRoot)
    .map(
      (file) =>
        [
          path.relative(repositoryRoot, file).split(path.sep).join("/"),
          readFileSync(file, "utf8"),
        ] as const,
    )
    .flatMap(([file, source]) => {
      const forbidden = [
        /(?:from\s+|import\()["']@\//u.test(source) ? "root alias" : undefined,
        source.includes("@workbench/extension-host/internal")
          ? "extension-host internal"
          : undefined,
        /(?:from\s+|import\()["']next\//u.test(source) ? "Next runtime import" : undefined,
      ].filter((value): value is string => value !== undefined);
      return forbidden.map((value) => `${file}: ${value}`);
    })
    .sort();

  assert.deepEqual(violations, []);
  assert.equal(existsSync(path.join(repositoryRoot, ...LEGACY_PI_FACADE_PATH)), false);
});

test("keeps Pi under the Runtime implementation path without structural Adapter names", () => {
  const implementationRoot = path.join(repositoryRoot, PI_IMPLEMENTATION_PREFIX);
  assert.equal(existsSync(implementationRoot), true);
  assert.equal(existsSync(path.join(repositoryRoot, ...LEGACY_PI_IMPLEMENTATION_PATH)), false);

  const allowedAdapterFiles = new Set([
    "server/src/attachment-understanding/providers/ocr-adapter.ts",
    "server/test/attachment-understanding/providers/ocr-adapter.test.ts",
  ]);
  const forbiddenIdentifiers = [
    ["createPiAgentServer", "Adapter"].join(""),
    ["PiAgentServer", "AdapterDependencies"].join(""),
    ["createPiAgentExecution", "Adapter"].join(""),
    ["createPiAgentThreadStore", "Adapter"].join(""),
    ["ExternalSessionSource", "Adapter"].join(""),
    ...["Codex", "ClaudeCode", "Cursor"].map((source) => `${source}SessionAdapter`),
  ];
  const violations = sourceFiles(implementationRoot).flatMap((file) => {
    const relativeFile = path.relative(implementationRoot, file).split(path.sep).join("/");
    const source = readFileSync(file, "utf8");
    return [
      ...(!allowedAdapterFiles.has(relativeFile) && /-adapter(?:\.test)?\.[cm]?[jt]sx?$/u.test(file)
        ? [`${relativeFile}: structural Adapter filename`]
        : []),
      ...forbiddenIdentifiers
        .filter((identifier) => source.includes(identifier))
        .map((identifier) => `${relativeFile}: ${identifier}`),
    ];
  });

  assert.deepEqual(violations.sort(), []);
});

test("confines Pi packages to the implementation and explicit application composition", () => {
  const sources = new Map(
    sourceFiles(repositoryRoot).map((file) => [
      path.relative(repositoryRoot, file).split(path.sep).join("/"),
      readFileSync(file, "utf8"),
    ]),
  );

  assert.deepEqual(directPiPackageImportViolations(sources), []);
  assert.deepEqual(piPackageManifestViolations(), []);
});

test("rejects Pi packages outside the implementation and exact composition allowlist", () => {
  const piServerInstallation = ["@workbench", "agent-runtime-pi-server/installation"].join("/");
  const piClientInstallation = ["@workbench", "agent-runtime-pi-client/installation"].join("/");
  const piContributionsInstallation = [
    "@workbench",
    "agent-runtime-pi-contributions/installation",
  ].join("/");
  const piProtocolStream = ["@workbench", "agent-runtime-pi-protocol/stream"].join("/");
  const sources = new Map<string, string>([
    ["apps/web/src/app/illegal-pi-server.ts", `import "${piServerInstallation}";`],
    ["app/illegal-pi-server.ts", `import "${piServerInstallation}";`],
    ["components/illegal-pi-client.tsx", `export * from "${piClientInstallation}";`],
    [
      "apps/runtime-node/src/not-a-composition-owner.ts",
      `const pi = await import("${piServerInstallation}"); void pi;`,
    ],
    ["apps/runtime-node/scripts/build-runtime-artifact.ts", `import "${piServerInstallation}";`],
    [
      "apps/web/src/server/runtime-sidecar-child.ts",
      `const pi = require("${piServerInstallation}"); import { STREAM_PATHS } from "${piProtocolStream}"; void pi; void STREAM_PATHS;`,
    ],
    [
      "packages/agent-runtime/runtimes/pi/contributions/illegal-server-reexport.ts",
      `export * from "${piServerInstallation}";`,
    ],
    [
      "packages/agent-runtime/core/contracts/src/illegal-pi-protocol.ts",
      `export * from "${piProtocolStream}";`,
    ],
    [
      "packages/extension-platform/host/src/illegal-pi-client.ts",
      `import "${piClientInstallation}";`,
    ],
    [
      "packages/extension-platform/sdk/src/illegal-pi-contribution.ts",
      `export * from "${piContributionsInstallation}";`,
    ],
    ["packages/host/artifact-policy/src/illegal-pi-policy.cjs", `require("${piProtocolStream}");`],
    [
      "packages/workbench/shell/src/extensions/illegal-pi-client.tsx",
      `import "${piClientInstallation}";`,
    ],
  ]);

  assert.deepEqual(directPiPackageImportViolations(sources), [
    `app/illegal-pi-server.ts: direct Pi package import is outside its owner boundary (${piServerInstallation})`,
    `apps/runtime-node/scripts/build-runtime-artifact.ts: direct Pi package import is outside its owner boundary (${piServerInstallation})`,
    `apps/runtime-node/src/not-a-composition-owner.ts: direct Pi package import is outside its owner boundary (${piServerInstallation})`,
    `apps/web/src/app/illegal-pi-server.ts: direct Pi package import is outside its owner boundary (${piServerInstallation})`,
    `apps/web/src/server/runtime-sidecar-child.ts: direct Pi package import is outside its owner boundary (${piProtocolStream})`,
    `apps/web/src/server/runtime-sidecar-child.ts: direct Pi package import is outside its owner boundary (${piServerInstallation})`,
    `components/illegal-pi-client.tsx: direct Pi package import is outside its owner boundary (${piClientInstallation})`,
    `packages/agent-runtime/core/contracts/src/illegal-pi-protocol.ts: direct Pi package import is outside its owner boundary (${piProtocolStream})`,
    `packages/agent-runtime/runtimes/pi/contributions/illegal-server-reexport.ts: direct Pi package import is outside its owner boundary (${piServerInstallation})`,
    `packages/extension-platform/host/src/illegal-pi-client.ts: direct Pi package import is outside its owner boundary (${piClientInstallation})`,
    `packages/extension-platform/sdk/src/illegal-pi-contribution.ts: direct Pi package import is outside its owner boundary (${piContributionsInstallation})`,
    `packages/host/artifact-policy/src/illegal-pi-policy.cjs: direct Pi package import is outside its owner boundary (${piProtocolStream})`,
    `packages/workbench/shell/src/extensions/illegal-pi-client.tsx: direct Pi package import is outside its owner boundary (${piClientInstallation})`,
  ]);
});
