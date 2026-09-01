import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_ROOT = path.join(PACKAGE_ROOT, "src");
const PUBLIC_ROOT = path.join(SOURCE_ROOT, "public");

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(absolute) : [absolute];
  });
}

test("publishes only explicit feature facades", () => {
  const manifest = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")) as {
    exports: Record<string, { types: string; import: string }>;
    sideEffects?: unknown;
  };
  const required = [
    "./installation",
    "./errors",
    "./host",
    "./resources",
    "./configuration",
    "./workspace",
    "./execution",
    "./external-import",
    "./context-trace",
    "./interactions",
    "./side-chat",
    "./message-metadata",
  ];

  assert.equal(manifest.exports["."], undefined);
  assert.equal(manifest.sideEffects, undefined);
  for (const subpath of required) {
    const target = manifest.exports[subpath];
    assert.ok(target, `missing ${subpath}`);
    assert.equal(target.types, target.import);
    assert.match(target.import, /^\.\/src\/public\/[^/]+\.tsx?$/);
    assert.ok(existsSync(path.join(PACKAGE_ROOT, target.import)));
  }

  for (const file of filesUnder(PUBLIC_ROOT)) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /export\s+\*\s+from/);
    assert.doesNotMatch(source, /\bPiSessionManager\b.*from\s+["']\.\.\/runtime\/manager["']/);
    assert.doesNotMatch(source, /\b(callPiRpc|respondPiRpc|createPiRpcId|PiRpcCallOptions)\b/);
  }
});

test("keeps package source independent from the application and Pi server", () => {
  const forbidden = [
    /from\s+["']@\//,
    /from\s+["']next(?:\/|["'])/,
    /from\s+["']zustand(?:\/|["'])/,
    /from\s+["']@earendil-works\/pi-coding-agent(?:\/|["'])/,
  ];

  for (const file of [...filesUnder(SOURCE_ROOT), ...filesUnder(path.join(PACKAGE_ROOT, "test"))]) {
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    const source = readFileSync(file, "utf8");
    for (const pattern of forbidden) {
      assert.doesNotMatch(
        source,
        pattern,
        `${path.relative(PACKAGE_ROOT, file)} violates ${pattern}`,
      );
    }
  }
});
