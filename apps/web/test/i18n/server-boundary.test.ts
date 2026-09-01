import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Web server i18n composes only the server-safe Shell runtime entry", async () => {
  const [server, appBundle] = await Promise.all([
    readFile(new URL("../../src/i18n/server.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/app/i18n/bundle.ts", import.meta.url), "utf8"),
  ]);

  for (const source of [server, appBundle]) {
    assert.match(source, /@workbench\/shell\/i18n\/runtime/u);
    assert.doesNotMatch(source, /from\s+["']@workbench\/shell\/i18n["']/u);
  }
});
