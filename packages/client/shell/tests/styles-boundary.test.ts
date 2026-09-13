import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageRoot = new URL("../", import.meta.url);

test("Shell keeps a public entry and colocates scoped renderer styles", async () => {
  const styles = await readFile(new URL("src/styles.css", packageRoot), "utf8");

  const tokens = await readFile(new URL("../../client/ui/src/tokens.css", packageRoot), "utf8");
  assert.match(tokens, /--control-hit-default:/);
  assert.match(tokens, /--color-info:/);
  assert.match(tokens, /--color-success:/);
  assert.match(tokens, /--color-warning:/);
  assert.match(tokens, /--color-danger:/);
  assert.match(tokens, /:where\(:focus-visible,/);
  assert.doesNotMatch(tokens, /var\(----/);
  assert.doesNotMatch(tokens, /outline:\s*none\s*!important/);
  assert.doesNotMatch(tokens, /--sidebar-row-height:|--composer-radius:/);
  assert.match(styles, /@import "@workbench\/ui\/components\.css"/);
  assert.match(styles, /@import "@workbench\/conversation\/styles\.css"/);
  assert.match(styles, /@import "@workbench\/markdown\/styles\.css"/);
  const markdown = await readFile(
    new URL("../../client/markdown/src/markdown.css", packageRoot),
    "utf8",
  );
  assert.match(markdown, /\.aui-markdown/);
  const code = await readFile(
    new URL("../../client/code-highlighting/src/code-block.css", packageRoot),
    "utf8",
  );
  assert.match(code, /\.aui-codex-code-header/);
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
