import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const BUILTIN_ROOT = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(BUILTIN_ROOT, "../..");
const COMPONENTS_ROOT = resolve(PROJECT_ROOT, "components");
const PLATFORM_API_ROOT = resolve(PROJECT_ROOT, "platform/extensions/api");
const RIGHT_WORKSPACE_ROOT = resolve(PROJECT_ROOT, "components/right-workspace");
const RUNTIME_ROOT = resolve(PROJECT_ROOT, "runtime");
const EXTENSION_PUBLIC_ENTRY = resolve(PROJECT_ROOT, "platform/extensions/index.ts");

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.[cm]?tsx?$/.test(entry.name) || /\.(?:test|spec)\.[cm]?tsx?$/.test(entry.name)) {
      return [];
    }
    return [path];
  });
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

function builtinFeatureForTarget(sourcePath: string, specifier: string): string | undefined {
  let target: string | undefined;
  if (specifier.startsWith("@/extensions/builtin/")) {
    target = resolve(PROJECT_ROOT, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    target = resolve(dirname(sourcePath), specifier);
  }
  if (!target) return undefined;

  const targetRelative = relative(BUILTIN_ROOT, target);
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

test("built-in contributions do not import sibling feature internals", () => {
  const violations: string[] = [];

  for (const sourcePath of sourceFiles(BUILTIN_ROOT)) {
    const sourceRelative = relative(BUILTIN_ROOT, sourcePath);
    const sourceFeature = sourceRelative.split(sep)[0];
    for (const specifier of moduleSpecifiers(sourcePath)) {
      const targetFeature = builtinFeatureForTarget(sourcePath, specifier);
      if (targetFeature && targetFeature !== sourceFeature) {
        violations.push(`${sourceRelative} -> ${specifier}`);
      }
      if (specifier.startsWith("@/platform/extensions/")) {
        violations.push(`${sourceRelative} -> ${specifier} (use @/platform/extensions)`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("RightWorkspace core does not import business extensions", () => {
  const violations = sourceFiles(RIGHT_WORKSPACE_ROOT).flatMap((sourcePath) =>
    moduleSpecifiers(sourcePath).flatMap((specifier) => {
      const target = specifier.startsWith("@/")
        ? resolve(PROJECT_ROOT, specifier.slice(2))
        : specifier.startsWith(".")
          ? resolve(dirname(sourcePath), specifier)
          : undefined;
      return target?.startsWith(`${resolve(PROJECT_ROOT, "extensions")}${sep}`)
        ? [`${relative(PROJECT_ROOT, sourcePath)} -> ${specifier}`]
        : [];
    }),
  );

  assert.deepEqual(violations, []);
});

test("generic components do not depend on concrete built-in extensions", () => {
  assert.deepEqual(crossLayerImports(COMPONENTS_ROOT, BUILTIN_ROOT), []);
});

test("runtime does not depend on component implementations", () => {
  assert.deepEqual(crossLayerImports(RUNTIME_ROOT, COMPONENTS_ROOT), []);
});

test("public extension API contracts do not depend on product runtime", () => {
  assert.deepEqual(crossLayerImports(PLATFORM_API_ROOT, RUNTIME_ROOT), []);
});

test("the public extension barrel does not export host implementations", () => {
  const internalExports = new Set([
    "./extension-manager",
    "./extension-provider",
    "./internal",
    "./registries",
  ]);
  assert.deepEqual(
    moduleSpecifiers(EXTENSION_PUBLIC_ENTRY).filter((specifier) => internalExports.has(specifier)),
    [],
  );
});
