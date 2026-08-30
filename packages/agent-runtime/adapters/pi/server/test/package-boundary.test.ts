import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../../../", import.meta.url));
const PUBLIC_EXPORTS = ["./installation", "./http", "./websocket", "./legacy"];

async function sourceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(candidate)));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(candidate);
  }
  return files;
}

test("publishes only the four bounded Pi server entry points", async () => {
  const manifest = JSON.parse(await readFile(path.join(PACKAGE_ROOT, "package.json"), "utf8")) as {
    exports: Record<string, unknown>;
    sideEffects?: unknown;
  };

  assert.deepEqual(Object.keys(manifest.exports), PUBLIC_EXPORTS);
  assert.equal(manifest.exports["."], undefined);
  assert.equal(manifest.exports["./src/*"], undefined);
  assert.notEqual(manifest.sideEffects, false);

  for (const file of await sourceFiles(path.join(PACKAGE_ROOT, "src/public"))) {
    assert.doesNotMatch(await readFile(file, "utf8"), /export\s+\*/u);
  }
});

test("Pi server production sources cannot reach back into the Workbench application", async () => {
  const violations: string[] = [];
  for (const file of await sourceFiles(path.join(PACKAGE_ROOT, "src"))) {
    const source = await readFile(file, "utf8");
    if (
      /(?:from\s+|import\()["']@\//u.test(source) ||
      /runtime\/pi\/server/u.test(source) ||
      /@workbench\/agent-runtime-pi-server\/src/u.test(source)
    ) {
      violations.push(path.relative(PACKAGE_ROOT, file));
    }
  }
  assert.deepEqual(violations, []);
});

test("the former application-owned Pi server source tree cannot return", async () => {
  await assert.rejects(access(path.join(REPOSITORY_ROOT, "runtime/pi/server")), { code: "ENOENT" });
});
