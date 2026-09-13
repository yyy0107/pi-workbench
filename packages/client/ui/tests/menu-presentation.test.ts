import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("dropdown and context menus share the same presentation variants", async () => {
  const [dropdown, contextMenu] = await Promise.all([
    readFile(new URL("../src/components/dropdown-menu.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/context-menu.tsx", import.meta.url), "utf8"),
  ]);

  for (const source of [dropdown, contextMenu]) {
    assert.match(source, /menuPopupStyles/u);
    assert.match(source, /menuItemStyles/u);
    assert.match(source, /menuSeparatorStyles/u);
  }
});
