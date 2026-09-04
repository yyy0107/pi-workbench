import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the Terminal palette and observer share the owning Workbench Shell", async () => {
  const source = await readFile(new URL("./terminal-surface.tsx", import.meta.url), "utf8");

  assert.equal(source.match(/resolveWorkbenchShellOwner\(container\)/gu)?.length, 2);
  assert.match(source, /observer\.observe\(root,/u);
  assert.doesNotMatch(source, /ownerDocument\.documentElement/u);
});
