import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("surface helpers have moved out of the AI elements public boundary", async () => {
  const elementsIndex = await readFile(
    new URL("../src/elements/index.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(elementsIndex, /surfaces/u);
  await assert.rejects(access(new URL("../src/elements/surfaces.tsx", import.meta.url)));
});

test("dropdown and context menus share the same presentation variants", async () => {
  const [dropdown, contextMenu] = await Promise.all([
    readFile(new URL("../src/ui/dropdown-menu.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/ui/context-menu.tsx", import.meta.url), "utf8"),
  ]);

  for (const source of [dropdown, contextMenu]) {
    assert.match(source, /menuPopupStyles/u);
    assert.match(source, /menuItemStyles/u);
    assert.match(source, /menuSeparatorStyles/u);
  }
});
