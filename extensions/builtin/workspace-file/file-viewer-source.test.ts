import assert from "node:assert/strict";
import test from "node:test";

import { isFileViewerVideoType, resolveFileViewerType } from "./file-viewer-source";

test("resolves File Viewer types from file extensions instead of MIME types", () => {
  assert.equal(resolveFileViewerType("photo.jpeg"), "jpeg");
  assert.equal(resolveFileViewerType("/workspace/PHOTO.JPG?version=1"), "jpg");
  assert.equal(resolveFileViewerType("document.pdf"), "pdf");
  assert.equal(resolveFileViewerType("image/jpeg"), "");
});

test("recognizes the types handled by File Viewer's video renderer", () => {
  assert.equal(isFileViewerVideoType("mp4"), true);
  assert.equal(isFileViewerVideoType("WEBM"), true);
  assert.equal(isFileViewerVideoType("m3u8"), true);
  assert.equal(isFileViewerVideoType("mp3"), false);
  assert.equal(isFileViewerVideoType("pdf"), false);
});
