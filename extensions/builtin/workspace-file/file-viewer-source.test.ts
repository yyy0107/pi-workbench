import assert from "node:assert/strict";
import test from "node:test";

import {
  isFileViewerVideoType,
  isNativeMediaPreviewType,
  resolveFileViewerType,
} from "./file-viewer-source";

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

test("recognizes media types that the browser can stream without buffering the full file", () => {
  assert.equal(isNativeMediaPreviewType("video/mp4"), true);
  assert.equal(isNativeMediaPreviewType("audio/mpeg"), true);
  assert.equal(isNativeMediaPreviewType(" VIDEO/WEBM "), true);
  assert.equal(isNativeMediaPreviewType("application/pdf"), false);
  assert.equal(isNativeMediaPreviewType("image/png"), false);
});
