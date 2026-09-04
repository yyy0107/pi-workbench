import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultFileViewMode,
  isFileViewerPreviewFile,
  isImagePreviewFile,
  isMarkdownFile,
  resolveFileViewMode,
  toggleFileViewMode,
} from "./file-view-mode";

test("recognizes Markdown file names without treating MDX as plain Markdown", () => {
  assert.equal(isMarkdownFile("/workspace/README.md"), true);
  assert.equal(isMarkdownFile("/workspace/notes.MARKDOWN"), true);
  assert.equal(isMarkdownFile("/workspace/page.mdx"), false);
  assert.equal(isMarkdownFile("/workspace/index.ts"), false);
});

test("recognizes the lightweight and office viewer formats", () => {
  for (const path of [
    "photo.PNG",
    "photo.jpeg",
    "document.pdf",
    "report.xlsx",
    "clip.mp4",
    "brief.docx",
  ]) {
    assert.equal(isFileViewerPreviewFile(path), true, path);
  }
  assert.equal(isFileViewerPreviewFile("archive.zip"), false);
  assert.equal(isFileViewerPreviewFile("index.ts"), false);
});

test("routes image media types and image extensions to the native image preview", () => {
  assert.equal(isImagePreviewFile("photo.bin", "image/jpeg"), true);
  assert.equal(isImagePreviewFile("diagram.svg", "text/plain"), true);
  assert.equal(isImagePreviewFile("document.pdf", "application/pdf"), false);
});

test("preview mode is available for Markdown and assembled viewer formats", () => {
  assert.equal(resolveFileViewMode("README.md", "preview"), "preview");
  assert.equal(resolveFileViewMode("README.md", undefined), "source");
  assert.equal(resolveFileViewMode("diagram.svg", "preview"), "preview");
  assert.equal(resolveFileViewMode("document.pdf", "preview"), "preview");
  assert.equal(resolveFileViewMode("index.ts", "preview"), "source");
  assert.equal(defaultFileViewMode("document.pdf", null), "preview");
  assert.equal(defaultFileViewMode("document.pdf", "utf-8"), "source");
  assert.equal(defaultFileViewMode("archive.zip", null), "source");
  assert.equal(toggleFileViewMode("source"), "preview");
  assert.equal(toggleFileViewMode("preview"), "source");
});

test("diff mode is available for every file type", () => {
  assert.equal(resolveFileViewMode("README.md", "diff"), "diff");
  assert.equal(resolveFileViewMode("index.ts", "diff"), "diff");
});
