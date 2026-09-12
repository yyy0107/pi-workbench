import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageRoot = new URL("../", import.meta.url);

test("Shell keeps a public entry and colocates scoped renderer styles", async () => {
  const styles = await readFile(new URL("src/styles.css", packageRoot), "utf8");

  assert.match(styles, /--control-hit-default:/);
  assert.match(styles, /--color-info:/);
  assert.match(styles, /--color-success:/);
  assert.match(styles, /--color-warning:/);
  assert.match(styles, /--color-danger:/);
  assert.match(styles, /:where\(:focus-visible,/);
  assert.doesNotMatch(styles, /var\(----/);
  assert.doesNotMatch(styles, /outline:\s*none\s*!important/);
  assert.doesNotMatch(styles, /--sidebar-row-height:|--composer-radius:/);
  assert.match(styles, /@import "\.\/ui\/sidebar-items\.css"/);
  assert.match(styles, /@import "\.\/chat\/conversation\.css"/);
  assert.match(styles, /@import "\.\/chat\/markdown\/markdown\.css"/);
  const markdown = await readFile(new URL("src/chat/markdown/markdown.css", packageRoot), "utf8");
  assert.match(markdown, /\.aui-markdown/);
  assert.match(markdown, /\.aui-codex-code-header/);
  assert.doesNotMatch(styles, /pi-logo|Pi Working|agent-runtime\/adapters\/pi/i);
});

test("the Shell stylesheet has an explicit side-effectful public export", async () => {
  const manifest = JSON.parse(await readFile(new URL("package.json", packageRoot), "utf8")) as {
    exports: Record<string, unknown>;
    sideEffects: readonly string[];
  };

  assert.equal(manifest.exports["./styles.css"], "./src/styles.css");
  assert.deepEqual(manifest.sideEffects, ["**/*.css"]);
});
