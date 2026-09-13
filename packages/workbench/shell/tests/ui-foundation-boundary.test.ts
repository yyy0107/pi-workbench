import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("surface helpers have moved out of the AI elements public boundary", async () => {
  const elementsIndex = await readFile(
    new URL("../../../conversation/conversation/src/elements/index.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(elementsIndex, /surfaces/u);
  await assert.rejects(
    access(
      new URL("../../../conversation/conversation/src/elements/surfaces.tsx", import.meta.url),
    ),
  );
});
