import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SHELL_SOURCE_ROOT = resolve(PROJECT_ROOT, "packages/workbench/shell/src");
const SHELL_BUILTIN_ROOT = resolve(SHELL_SOURCE_ROOT, "extensions/builtin");
const PI_BUILTIN_ROOT = resolve(
  PROJECT_ROOT,
  "packages/agent-runtime/adapters/pi/contributions/src/extensions",
);
const BUILTIN_ROOTS = [SHELL_BUILTIN_ROOT, PI_BUILTIN_ROOT];
const SHARED_BUILTIN_TARGETS = new Set([resolve(PI_BUILTIN_ROOT, "project-trust-dialog-copy")]);
const INSTALLABLE_ROOT = resolve(SHELL_SOURCE_ROOT, "extensions/installable");
const COMPONENT_ROOTS = [
  resolve(SHELL_SOURCE_ROOT, "assistant-ui"),
  resolve(SHELL_SOURCE_ROOT, "chat"),
  resolve(SHELL_SOURCE_ROOT, "elements"),
  resolve(SHELL_SOURCE_ROOT, "right-workspace"),
  resolve(SHELL_SOURCE_ROOT, "ui"),
  resolve(SHELL_SOURCE_ROOT, "workspace-file-tree"),
];
const PLATFORM_API_ROOT = resolve(PROJECT_ROOT, "packages/extension-platform/sdk/src/api");
const RIGHT_WORKSPACE_ROOTS = [resolve(SHELL_SOURCE_ROOT, "right-workspace")];
const LEGACY_RIGHT_WORKSPACE_GENERIC_SOURCES = [
  "components/right-workspace/workspace-context.tsx",
  "components/right-workspace/workspace-surface-runtime-host.tsx",
  "components/right-workspace/feedback/feedback-store.ts",
  "components/right-workspace/feedback/feedback-types.ts",
];
const RUNTIME_ROOTS = [
  resolve(PROJECT_ROOT, "apps/runtime-node/src"),
  resolve(PROJECT_ROOT, "packages/agent-runtime"),
  resolve(PROJECT_ROOT, "packages/server"),
  resolve(PROJECT_ROOT, "packages/terminal"),
];
const EXTENSION_PUBLIC_ENTRY = resolve(
  PROJECT_ROOT,
  "packages/extension-platform/sdk/src/index.ts",
);
const EXTENSION_AUTHORING_ENTRY = resolve(
  PROJECT_ROOT,
  "packages/extension-platform/sdk/src/authoring.ts",
);
const ALLOWED_EXTENSION_SUBPATHS = new Set([
  "@workbench/extension-sdk",
  "@workbench/extension-host",
  "@workbench/extension-host/hosts/extension-error-boundary",
  "@workbench/extension-host/hosts/renderer-host",
]);
const HOST_ROOT_RUNTIME_IMPORTS = new Set([
  "ExtensionErrorDetails",
  "ExtensionErrorHandler",
  "ExtensionErrorSource",
  "useCommandService",
  "useComposerCommandRegistry",
  "useExtensionErrorReporter",
  "useMainViewRegistry",
  "useMainViewService",
  "useNavigationService",
  "usePanelRegistry",
  "usePanelService",
  "useSettingsRegistry",
  "useWorkbenchExtensions",
]);
const IGNORED_SOURCE_DIRECTORIES = new Set([".git", ".next", "coverage", "dist", "node_modules"]);

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && IGNORED_SOURCE_DIRECTORIES.has(entry.name)) return [];
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.[cm]?tsx?$/.test(entry.name) || /\.(?:test|spec)\.[cm]?tsx?$/.test(entry.name)) {
      return [];
    }
    return [path];
  });
}

function namedImports(path: string, packageName: string): readonly string[] {
  const source = readFileSync(path, "utf8");
  const names: string[] = [];
  const pattern = new RegExp(
    `\\bimport\\s+(?:type\\s+)?\\{([^;]*?)\\}\\s+from\\s+["']${packageName.replaceAll("/", "\\/")}["']`,
    "gs",
  );
  for (const match of source.matchAll(pattern)) {
    for (const item of match[1]?.split(",") ?? []) {
      const name = item
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0];
      if (name) names.push(name);
    }
  }
  return names;
}

function moduleSpecifiers(path: string): readonly string[] {
  const source = readFileSync(path, "utf8");
  const specifiers: string[] = [];
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) specifiers.push(match[1]);
    }
  }
  return specifiers;
}

function builtinFeatureForTarget(
  sourcePath: string,
  specifier: string,
  builtinRoot: string,
): string | undefined {
  let target: string | undefined;
  if (specifier.startsWith(".")) {
    target = resolve(dirname(sourcePath), specifier);
  }
  if (!target) return undefined;
  if (SHARED_BUILTIN_TARGETS.has(target)) return undefined;

  const targetRelative = relative(builtinRoot, target);
  if (targetRelative.startsWith("..") || targetRelative === "") return undefined;
  return targetRelative.split(sep)[0];
}

function projectTarget(sourcePath: string, specifier: string): string | undefined {
  if (specifier.startsWith("@/")) return resolve(PROJECT_ROOT, specifier.slice(2));
  if (specifier.startsWith(".")) return resolve(dirname(sourcePath), specifier);
  return undefined;
}

function crossLayerImports(sourceRoot: string, targetRoot: string): string[] {
  return sourceFiles(sourceRoot).flatMap((sourcePath) =>
    moduleSpecifiers(sourcePath).flatMap((specifier) => {
      const target = projectTarget(sourcePath, specifier);
      return target?.startsWith(`${targetRoot}${sep}`) || target === targetRoot
        ? [`${relative(PROJECT_ROOT, sourcePath)} -> ${specifier}`]
        : [];
    }),
  );
}

function crossLayerImportsBetween(sourceRoots: readonly string[], targetRoots: readonly string[]) {
  return sourceRoots.flatMap((sourceRoot) =>
    targetRoots.flatMap((targetRoot) => crossLayerImports(sourceRoot, targetRoot)),
  );
}

test("built-in contributions do not import sibling feature internals", () => {
  const violations: string[] = [];

  for (const builtinRoot of BUILTIN_ROOTS) {
    for (const sourcePath of sourceFiles(builtinRoot)) {
      const sourceRelative = relative(builtinRoot, sourcePath);
      const sourceFeature = sourceRelative.split(sep)[0];
      for (const specifier of moduleSpecifiers(sourcePath)) {
        const targetFeature = builtinFeatureForTarget(sourcePath, specifier, builtinRoot);
        if (targetFeature && targetFeature !== sourceFeature) {
          violations.push(`${relative(PROJECT_ROOT, sourcePath)} -> ${specifier}`);
        }
        if (
          specifier.startsWith("@workbench/extension-") &&
          !ALLOWED_EXTENSION_SUBPATHS.has(specifier)
        ) {
          violations.push(
            `${relative(PROJECT_ROOT, sourcePath)} -> ${specifier} (use an approved public extension entry)`,
          );
        }
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("all business extension modules use only public SDK contracts and Host runtime hooks", () => {
  const violations: string[] = [];

  for (const sourcePath of [...BUILTIN_ROOTS, INSTALLABLE_ROOT].flatMap(sourceFiles)) {
    const sourceRelative = relative(PROJECT_ROOT, sourcePath);
    for (const specifier of moduleSpecifiers(sourcePath)) {
      if (
        specifier.startsWith("@workbench/extension-") &&
        !ALLOWED_EXTENSION_SUBPATHS.has(specifier)
      ) {
        violations.push(`${sourceRelative} -> ${specifier} (use an approved public entry)`);
      }
    }
    for (const imported of namedImports(sourcePath, "@workbench/extension-host")) {
      if (!HOST_ROOT_RUNTIME_IMPORTS.has(imported)) {
        violations.push(
          `${sourceRelative} -> @workbench/extension-host#${imported} (contracts belong to extension-sdk)`,
        );
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("production consumers import contracts from SDK instead of the Host runtime barrel", () => {
  const violations = sourceFiles(PROJECT_ROOT).flatMap((sourcePath) => {
    const sourceRelative = relative(PROJECT_ROOT, sourcePath);
    return namedImports(sourcePath, "@workbench/extension-host").flatMap((imported) =>
      HOST_ROOT_RUNTIME_IMPORTS.has(imported)
        ? []
        : [`${sourceRelative} -> @workbench/extension-host#${imported}`],
    );
  });

  assert.deepEqual(violations, []);
});

test("extension definitions use the pure authoring entry", () => {
  const violations = [...BUILTIN_ROOTS, INSTALLABLE_ROOT].flatMap((root) =>
    sourceFiles(root)
      .filter((sourcePath) => /(?:^|[\\/])extension\.tsx?$/.test(sourcePath))
      .flatMap((sourcePath) => {
        const specifiers = moduleSpecifiers(sourcePath);
        return specifiers.includes("@workbench/extension-host") ||
          !specifiers.includes("@workbench/extension-sdk")
          ? [relative(PROJECT_ROOT, sourcePath)]
          : [];
      }),
  );

  assert.deepEqual(violations, []);
});

test("RightWorkspace package primitives do not import business extensions", () => {
  const violations = RIGHT_WORKSPACE_ROOTS.flatMap(sourceFiles).flatMap((sourcePath) =>
    moduleSpecifiers(sourcePath).flatMap((specifier) => {
      const target = specifier.startsWith("@/")
        ? resolve(PROJECT_ROOT, specifier.slice(2))
        : specifier.startsWith(".")
          ? resolve(dirname(sourcePath), specifier)
          : undefined;
      return target &&
        BUILTIN_ROOTS.some(
          (builtinRoot) => target === builtinRoot || target.startsWith(`${builtinRoot}${sep}`),
        )
        ? [`${relative(PROJECT_ROOT, sourcePath)} -> ${specifier}`]
        : [];
    }),
  );

  assert.deepEqual(violations, []);
});

test("RightWorkspace generic React and feedback owners have no legacy root source", () => {
  assert.deepEqual(
    LEGACY_RIGHT_WORKSPACE_GENERIC_SOURCES.filter((source) =>
      existsSync(resolve(PROJECT_ROOT, source)),
    ),
    [],
  );
});

test("generic components do not depend on concrete built-in extensions", () => {
  assert.deepEqual(crossLayerImportsBetween(COMPONENT_ROOTS, BUILTIN_ROOTS), []);
});

test("runtime does not depend on component implementations", () => {
  assert.deepEqual(crossLayerImportsBetween(RUNTIME_ROOTS, COMPONENT_ROOTS), []);
});

test("public extension API contracts do not depend on product runtime", () => {
  assert.deepEqual(crossLayerImportsBetween([PLATFORM_API_ROOT], RUNTIME_ROOTS), []);
});

test("the public extension barrel does not export host implementations", () => {
  const internalExports = new Set([
    "./extension-manager",
    "./extension-provider",
    "./hosts",
    "./internal",
    "./registries",
  ]);
  assert.deepEqual(
    moduleSpecifiers(EXTENSION_PUBLIC_ENTRY).filter((specifier) => internalExports.has(specifier)),
    [],
  );
});

test("Host barrels do not re-export SDK authoring or lifecycle internals", () => {
  const hostEntry = resolve(PROJECT_ROOT, "packages/extension-platform/host/src/index.ts");
  const hostInternalEntry = resolve(
    PROJECT_ROOT,
    "packages/extension-platform/host/src/internal.ts",
  );

  assert.deepEqual(
    moduleSpecifiers(hostEntry).filter((specifier) =>
      specifier.startsWith("@workbench/extension-sdk"),
    ),
    [],
  );
  assert.deepEqual(
    moduleSpecifiers(hostInternalEntry).filter((specifier) =>
      specifier.startsWith("@workbench/extension-sdk"),
    ),
    [],
  );
});

test("only Shell i18n infrastructure imports the opaque SDK descriptor factory", () => {
  const allowed = new Set(["packages/workbench/shell/src/i18n/runtime.ts"]);
  const violations = sourceFiles(PROJECT_ROOT).flatMap((sourcePath) => {
    if (
      !namedImports(sourcePath, "@workbench/extension-sdk/internal").includes(
        "createLocalizableMessageDescriptor",
      )
    ) {
      return [];
    }
    const sourceRelative = relative(PROJECT_ROOT, sourcePath);
    return allowed.has(sourceRelative) ? [] : [sourceRelative];
  });

  assert.deepEqual(violations, []);
});

test("the extension authoring entry does not export host or runtime implementations", () => {
  const forbiddenExports = new Set([
    "./extension-context",
    "./extension-manager",
    "./extension-provider",
    "./hosts",
    "./internal",
    "./registries",
  ]);
  assert.deepEqual(
    moduleSpecifiers(EXTENSION_AUTHORING_ENTRY).filter((specifier) =>
      forbiddenExports.has(specifier),
    ),
    [],
  );
});

test("the extension authoring entry loads without host implementations", async () => {
  const authoring =
    (await import("@workbench/extension-sdk")) as typeof import("@workbench/extension-sdk");

  assert.equal(typeof authoring.defineExtension, "function");
});
