import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));

test("panel capability exposes its docks without depending on Shell or terminal UI", async () => {
  const sourceRoot = path.join(packageRoot, "src");
  const sourceFiles = (await readdir(sourceRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.tsx?$/u.test(entry.name))
    .map((entry) => path.join(sourceRoot, entry.name));
  const sources = await Promise.all(sourceFiles.map((file) => readFile(file, "utf8")));
  const productionSource = sources.join("\n");
  const publicSource = await readFile(path.join(sourceRoot, "index.ts"), "utf8");

  for (const forbiddenDependency of ["@workbench/shell", "@workbench/ui-terminal"]) {
    assert.equal(productionSource.includes(forbiddenDependency), false, forbiddenDependency);
  }
  for (const publicCapability of ["PanelLayout", "PanelDock", "TerminalDrawer"]) {
    assert.match(publicSource, new RegExp(`\\b${publicCapability}\\b`, "u"), publicCapability);
  }
  assert.match(
    await readFile(path.join(sourceRoot, "panel-container.tsx"), "utf8"),
    /\.\.\/lib\/panel-dimensions/u,
  );
});
