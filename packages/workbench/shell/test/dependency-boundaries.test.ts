import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_ROOT = path.join(PACKAGE_ROOT, "src");
const PRODUCTION_SOURCE = /(?<!\.(?:test|spec))\.[cm]?[jt]sx?$/u;
const IMPORT_SOURCE = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/gu;
const REMOVED_UI_PACKAGE_PREFIX = ["@assistant", "ui/"].join("-");
const REMOVED_UI_DIRECTORY = ["assistant", "ui/"].join("-");
const REMOVED_UI_HOOK = ["use", "Aui"].join("");

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(absolute) : [absolute];
  });
}

function productionFilesUnder(directory: string): string[] {
  return filesUnder(directory).filter((file) => PRODUCTION_SOURCE.test(file));
}

function importSources(file: string): readonly string[] {
  return Array.from(readFileSync(file, "utf8").matchAll(IMPORT_SOURCE), (match) => match[1] ?? "");
}

function packageRelative(file: string): string {
  return path.relative(PACKAGE_ROOT, file).replaceAll(path.sep, "/");
}

function resolvedSourcePath(file: string, source: string): string | undefined {
  if (!source.startsWith(".")) return undefined;
  return path
    .relative(SOURCE_ROOT, path.resolve(path.dirname(file), source))
    .replaceAll(path.sep, "/");
}

function assertNoImports(
  files: readonly string[],
  isForbidden: (source: string, file: string) => boolean,
): void {
  for (const file of files) {
    for (const source of importSources(file)) {
      assert.equal(
        isForbidden(source, file),
        false,
        `${packageRelative(file)} must not import ${source}`,
      );
    }
  }
}

test("generic Shell source never imports the concrete Pi runtime", () => {
  assertNoImports(productionFilesUnder(SOURCE_ROOT), (source) =>
    source.startsWith("@workbench/agent-runtime-pi"),
  );

  const manifest = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  const packageNames = Object.keys({
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.peerDependencies,
  });
  assert.deepEqual(
    packageNames.filter((name) => name.startsWith("@workbench/agent-runtime-pi")),
    [],
  );
});

test("shared UI foundations do not depend on chat, elements, or a conversation runtime", () => {
  assertNoImports(productionFilesUnder(path.join(SOURCE_ROOT, "ui")), (source, file) => {
    if (
      source.startsWith(REMOVED_UI_PACKAGE_PREFIX) ||
      source.startsWith("@workbench/agent-runtime")
    ) {
      return true;
    }

    const resolved = resolvedSourcePath(file, source);
    return (
      resolved?.startsWith(REMOVED_UI_DIRECTORY) === true ||
      resolved?.startsWith("chat/") === true ||
      resolved?.startsWith("elements/") === true ||
      resolved?.startsWith("runtime-connection/") === true
    );
  });
});

test("RightWorkspace core remains independent from conversation and Agent runtimes", () => {
  const boundaryAdapters = new Set([
    "right-workspace/right-workspace-persistence.ts",
    "right-workspace/right-workspace-prompt-feedback.ts",
  ]);
  const coreFiles = productionFilesUnder(path.join(SOURCE_ROOT, "right-workspace")).filter(
    (file) => !boundaryAdapters.has(packageRelative(file).replace(/^src\//u, "")),
  );

  assertNoImports(coreFiles, (source) => {
    return (
      source.startsWith(REMOVED_UI_PACKAGE_PREFIX) || source.startsWith("@workbench/agent-runtime")
    );
  });
});

test("AI presentation leaves do not read session, transport, or external store state", () => {
  const elementFiles = productionFilesUnder(path.join(SOURCE_ROOT, "elements"));
  const forbiddenModuleSegment = /(?:^|[/.-])(?:session|transport|store)(?:[/.-]|$)/u;

  assertNoImports(elementFiles, (source) => {
    return (
      source.startsWith(REMOVED_UI_PACKAGE_PREFIX) ||
      source.startsWith("@workbench/agent-runtime") ||
      source === "zustand" ||
      source.startsWith("zustand/") ||
      forbiddenModuleSegment.test(source)
    );
  });

  for (const file of elementFiles) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(
      source,
      new RegExp(
        `\\b(?:${REMOVED_UI_HOOK}|useStore|useSession|useTransport|useWorkbenchAgent)\\w*\\s*\\(`,
        "u",
      ),
      packageRelative(file),
    );
  }
});

test("fallback and built-in message renderers share the Workbench Block host and leaves", () => {
  const owners = [
    path.join(SOURCE_ROOT, "chat", "message-parts.tsx"),
    path.join(
      SOURCE_ROOT,
      "extensions",
      "builtin",
      "message-presentation",
      "message-presentation.tsx",
    ),
  ];

  for (const owner of owners) {
    const source = readFileSync(owner, "utf8");
    assert.ok(
      importSources(owner).some((source) => source.endsWith("/renderers/message-blocks")),
      packageRelative(owner),
    );
    assert.ok(
      importSources(owner).includes("@workbench/extension-host/hosts/renderer-host"),
      packageRelative(owner),
    );
    assert.doesNotMatch(
      source,
      new RegExp(
        `${REMOVED_UI_PACKAGE_PREFIX}|\\b(?:MessagePrimitive|${REMOVED_UI_HOOK})\\w*`,
        "u",
      ),
      packageRelative(owner),
    );
  }
});
