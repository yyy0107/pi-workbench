import assert from "node:assert/strict";
import test from "node:test";

import { splitFileName } from "./file-name-parts";

test("splits a file name so its extension can remain visible", () => {
  assert.deepEqual(splitFileName("你究竟是恨我这张脸.mp4"), {
    stem: "你究竟是恨我这张脸",
    extension: ".mp4",
  });
  assert.deepEqual(splitFileName("archive.tar.gz"), {
    stem: "archive.tar",
    extension: ".gz",
  });
});

test("keeps extensionless, dotfile, and trailing-dot names intact", () => {
  assert.deepEqual(splitFileName("README"), { stem: "README", extension: "" });
  assert.deepEqual(splitFileName(".gitignore"), { stem: ".gitignore", extension: "" });
  assert.deepEqual(splitFileName("recording."), { stem: "recording.", extension: "" });
});
