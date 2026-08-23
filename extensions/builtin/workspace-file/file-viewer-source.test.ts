import assert from "node:assert/strict";
import test from "node:test";

import { resolveFileViewerType } from "./file-viewer-source";

test("resolves File Viewer types from file extensions instead of MIME types", () => {
  assert.equal(resolveFileViewerType("photo.jpeg"), "jpeg");
  assert.equal(resolveFileViewerType("/workspace/PHOTO.JPG?version=1"), "jpg");
  assert.equal(resolveFileViewerType("document.pdf"), "pdf");
  assert.equal(resolveFileViewerType("image/jpeg"), "");
});
