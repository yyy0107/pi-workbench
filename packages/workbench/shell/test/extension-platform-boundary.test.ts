import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const shellRoot = fileURLToPath(new URL("../", import.meta.url));

async function readSourceTree(directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  const sources = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return readSourceTree(target);
      if (!entry.isFile() || !/\.[cm]?[jt]sx?$/u.test(entry.name)) return "";
      return readFile(target, "utf8");
    }),
  );
  return sources.join("\n");
}

test("removes component-extension installation and right-panel compatibility APIs", async () => {
  const [manifestSource, shellSource] = await Promise.all([
    readFile(path.join(shellRoot, "package.json"), "utf8"),
    readSourceTree(path.join(shellRoot, "src")),
  ]);
  const manifest = JSON.parse(manifestSource) as {
    dependencies?: Record<string, string>;
    exports: Record<string, unknown>;
  };

  assert.equal("./component-extensions" in manifest.exports, false);
  assert.equal("@assistant-ui/react-generative-ui" in (manifest.dependencies ?? {}), false);
  for (const removedApi of [
    "@workbench/shell/component-extensions",
    "component-extension-installation",
    "createWorkbenchExtensionPrefix",
    "useInstalledComponentExtensions",
    "panel.right",
  ]) {
    assert.equal(shellSource.includes(removedApi), false, removedApi);
  }
});
