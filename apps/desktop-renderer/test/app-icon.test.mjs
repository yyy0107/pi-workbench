import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("renderer owns a high-resolution native PNG icon", () => {
  const icon = readFileSync(new URL("../public/app-icon.png", import.meta.url));
  assert.equal(icon.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(icon.readUInt32BE(16), 1024);
  assert.equal(icon.readUInt32BE(20), 1024);
});
