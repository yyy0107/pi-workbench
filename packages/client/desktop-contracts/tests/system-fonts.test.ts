import assert from "node:assert/strict";
import test from "node:test";

import { readDesktopSystemFontsPort } from "../src/system-fonts";

test("reads the narrow desktop system-font capability", async () => {
  const port = { getFontFamilies: async () => ["中文字体", "Noto Sans"] };
  assert.equal(readDesktopSystemFontsPort(port), port);
  assert.deepEqual(await readDesktopSystemFontsPort(port)?.getFontFamilies(), [
    "中文字体",
    "Noto Sans",
  ]);
  for (const invalid of [undefined, null, [], {}, { getFontFamilies: true }]) {
    assert.equal(readDesktopSystemFontsPort(invalid), undefined);
  }
});
