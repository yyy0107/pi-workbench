import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB_ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const WEB_SOURCE_ROOT = path.join(WEB_ROOT, "src");
const APPLICATION_RUNTIME_PROVIDER_EXPORT =
  /^\s*export\s+function\s+WorkbenchAssistantRuntimeProvider\b/mu;
const CONCRETE_RUNTIME_IMPORT =
  /(?:from\s+|import\s*\()\s*["'](?:@\/runtime\/pi|@workbench\/agent-runtime-pi(?:[-/]|["'])|\.\.\/pi)(?:\/|["'])?/;
const PI_CONTRIBUTION_INSTALLATION = "@workbench/agent-runtime-pi-contributions/installation";
const FORBIDDEN_PRODUCTION_DEPENDENCIES = Object.freeze([
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "@workbench/agent-runtime-pi-server",
  "node-pty",
  "tree-sitter",
  "tree-sitter-bash",
  "ws",
]);

async function sourceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(filename)));
    else if (entry.isFile() && /\.(?:ts|tsx)$/u.test(entry.name)) files.push(filename);
  }
  return files;
}

async function applicationRuntimeProviderOwner(): Promise<{
  readonly filename: string;
  readonly source: string;
}> {
  const matches: Array<{ readonly filename: string; readonly source: string }> = [];
  for (const filename of await sourceFiles(WEB_SOURCE_ROOT)) {
    const source = await readFile(filename, "utf8");
    if (APPLICATION_RUNTIME_PROVIDER_EXPORT.test(source)) matches.push({ filename, source });
  }
  assert.equal(
    matches.length,
    1,
    `Expected one Web application Runtime provider owner, found: ${matches
      .map(({ filename }) => path.relative(WEB_ROOT, filename).split(path.sep).join("/"))
      .join(", ")}`,
  );
  return matches[0]!;
}

test("@workbench/web declares only browser/server-safe production dependencies", async () => {
  const manifest = JSON.parse(await readFile(path.join(WEB_ROOT, "package.json"), "utf8")) as {
    readonly name?: string;
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly devDependencies?: Readonly<Record<string, string>>;
  };
  assert.equal(manifest.name, "@workbench/web");
  assert.equal(manifest.dependencies?.["@workbench/settings-server"], "workspace:*");
  assert.equal(manifest.dependencies?.["@workbench/agent-runtime-pi-contributions"], "workspace:*");
  assert.equal(manifest.devDependencies?.["@workbench/agent-runtime-pi-shared"], "workspace:*");
  for (const packageName of FORBIDDEN_PRODUCTION_DEPENDENCIES) {
    assert.equal(manifest.dependencies?.[packageName], undefined, packageName);
  }
});

test("Web production source does not construct Pi settings or import native/Pi Server SDKs", async () => {
  const violations: string[] = [];
  for (const filename of await sourceFiles(WEB_SOURCE_ROOT)) {
    const source = await readFile(filename, "utf8");
    const relativeFilename = path.relative(WEB_ROOT, filename).split(path.sep).join("/");
    if (/\bgetAgentDir\b/u.test(source)) violations.push(`${relativeFilename}: getAgentDir`);
    for (const packageName of FORBIDDEN_PRODUCTION_DEPENDENCIES) {
      const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      if (
        new RegExp(
          `(?:from\\s*|import\\s*\\(|require\\s*\\()\\s*["']${escaped}(?:[/"'])`,
          "u",
        ).test(source)
      ) {
        violations.push(`${relativeFilename}: ${packageName}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("the Web application Runtime provider selects through explicit installation modules", async () => {
  const { source } = await applicationRuntimeProviderOwner();

  assert.equal(
    CONCRETE_RUNTIME_IMPORT.test(source.replaceAll(PI_CONTRIBUTION_INSTALLATION, "")),
    false,
  );
  assert.match(source, /from\s+["']\.\/installed-agent-runtime["']/u);
  assert.match(source, new RegExp(`from\\s+["']${PI_CONTRIBUTION_INSTALLATION}["']`, "u"));
});
