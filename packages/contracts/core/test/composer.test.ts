import assert from "node:assert/strict";
import test from "node:test";

import { detectManagedImageMediaType } from "../src/composer";

test("detects supported raster image signatures", () => {
  assert.equal(
    detectManagedImageMediaType([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    "image/png",
  );
  assert.equal(detectManagedImageMediaType([0xff, 0xd8, 0xff]), "image/jpeg");
  assert.equal(detectManagedImageMediaType([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), "image/gif");
  assert.equal(
    detectManagedImageMediaType([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
    "image/webp",
  );
  assert.equal(detectManagedImageMediaType([0x25, 0x50, 0x44, 0x46]), undefined);
});
