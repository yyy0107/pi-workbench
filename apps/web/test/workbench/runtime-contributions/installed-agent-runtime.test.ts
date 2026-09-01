import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import { installedWorkbenchExtensionPrefix } from "@/workbench/runtime-contributions/installed-workbench-extensions";

const repositoryRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const IGNORED_DIRECTORIES = new Set([
  ".desktop-build",
  ".electron-build",
  ".git",
  ".next",
  "dist-electron",
  "node_modules",
]);
const PI_ADAPTER_PREFIX = "packages/agent-runtime/adapters/pi/";
const PI_CONTRIBUTIONS_PREFIX = "packages/agent-runtime/adapters/pi/contributions/";
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
    ["@workbench/agent-runtime-pi-server/legacy"],
  ],
  [
    "apps/runtime-node/src/installed-runtime-service.ts",
    ["@workbench/agent-runtime-pi-protocol/stream", "@workbench/agent-runtime-pi-server/websocket"],
  ],
  [
    "apps/runtime-node/test/installed-pi-server-rpc.test.ts",
    ["@workbench/agent-runtime-pi-protocol/rpc", "@workbench/agent-runtime-pi-server/legacy"],
  ],
  [
    "apps/runtime-node/test/session-extension-lifecycle.test.ts",
    [
      "@workbench/agent-runtime-pi-server/installation",
      "@workbench/agent-runtime-pi-server/legacy",
    ],
  ],
]);

/** The Web composition can select Pi's browser adapter, but never Pi's server adapter. */
const APPLICATION_COMPOSITION_PI_IMPORTS = new Map<string, readonly string[]>([
  [
    "apps/desktop-renderer/src/desktop/desktop-workbench.tsx",
    [
      "@workbench/agent-runtime-pi-client/installation",
      "@workbench/agent-runtime-pi-client/workbench-settings",
    ],
  ],
  [
    "apps/web/src/workbench/providers/installed-agent-runtime.tsx",
    ["@workbench/agent-runtime-pi-client/installation"],
  ],
  [
    "apps/web/test/workbench/providers/installed-agent-runtime.test.tsx",
    [
      "@workbench/agent-runtime-pi-client/installation",
      "@workbench/agent-runtime-pi-shared/descriptor",
    ],
  ],
  [
    "apps/web/src/workbench/providers/installed-workbench-settings.ts",
    ["@workbench/agent-runtime-pi-client/workbench-settings"],
  ],
]);

const DIRECT_PI_PACKAGE_IMPORT =
  /(?:\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?|\b(?:import|require)\s*\()\s*["'](@workbench\/agent-runtime-pi-(?:client|protocol|server|shared)(?:\/[^"']*)?)["']/gu;
function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(absolutePath));
    else if (entry.isFile() && /\.[cm]?tsx?$/u.test(entry.name)) files.push(absolutePath);
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
  // never pull the Pi server adapter into the Web graph.
  if (file.startsWith(PI_CONTRIBUTIONS_PREFIX)) {
    return (
      PI_CLIENT_OR_SHARED_PREFIXES.some((prefix) => specifier.startsWith(prefix)) ||
      specifier.startsWith("@workbench/agent-runtime-pi-protocol/")
    );
  }

  // Pi adapter implementation and its tests own the full Pi package family.
  if (file.startsWith(PI_ADAPTER_PREFIX)) return true;

  if (permitsExactImport(RUNTIME_NODE_PI_IMPORTS, file, specifier)) return true;
  return permitsExactImport(APPLICATION_COMPOSITION_PI_IMPORTS, file, specifier);
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

test("preserves the product-owned cross-package extension activation order", () => {
  assert.equal(Object.isFrozen(installedWorkbenchExtensionPrefix), true);
  const ids = installedWorkbenchExtensionPrefix.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, [
    "workbench.brand",
    "workbench.appearance",
    "workbench.locale-selector",
    "workbench.hardware-acceleration",
    "workbench.message-presentation",
    "workbench.message-actions",
    "workbench.user-message-index",
    "workbench.message-queue",
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
    "workbench.image-understanding",
    "workbench.skills",
    "workbench.pi-extensions",
    "workbench.toolbox",
    "workbench.automations",
    "workbench.model-selector",
    "workbench.connection-status",
    "workbench.context-trace",
    "workbench.external-session-import",
    "workbench.token-usage",
    "workbench.workspace-file",
  ]);
});

test("keeps the Pi Web contribution leaf independent of root aliases and host internals", () => {
  const contributionsRoot = path.join(
    repositoryRoot,
    "packages/agent-runtime/adapters/pi/contributions",
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

test("confines direct Pi package imports to adapter and explicit application composition", () => {
  const sources = new Map(
    sourceFiles(repositoryRoot).map((file) => [
      path.relative(repositoryRoot, file).split(path.sep).join("/"),
      readFileSync(file, "utf8"),
    ]),
  );

  assert.deepEqual(directPiPackageImportViolations(sources), []);
});

test("rejects Pi server packages from Web, root UI, and non-owner Runtime application modules", () => {
  const piServerInstallation = ["@workbench", "agent-runtime-pi-server/installation"].join("/");
  const piClientInstallation = ["@workbench", "agent-runtime-pi-client/installation"].join("/");
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
      "packages/agent-runtime/adapters/pi/contributions/illegal-server-reexport.ts",
      `export * from "${piServerInstallation}";`,
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
    `packages/agent-runtime/adapters/pi/contributions/illegal-server-reexport.ts: direct Pi package import is outside its owner boundary (${piServerInstallation})`,
  ]);
});
