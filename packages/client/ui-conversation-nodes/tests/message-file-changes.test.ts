import assert from "node:assert/strict";
import test from "node:test";

import { messageFileChangeDisplayPath } from "../lib/message-file-changes";

test("shows a root file relative to the project", () => {
  assert.equal(messageFileChangeDisplayPath("example.ts"), "./example.ts");
});

test("shows a nested file relative to the project", () => {
  assert.equal(
    messageFileChangeDisplayPath("packages/client/src/example.ts"),
    "./packages/client/src/example.ts",
  );
});

test("normalizes Windows relative path separators", () => {
  assert.equal(
    messageFileChangeDisplayPath("packages\\client\\example.ts"),
    "./packages/client/example.ts",
  );
});

test("does not duplicate an existing relative path prefix", () => {
  assert.equal(messageFileChangeDisplayPath("./src/example.ts"), "./src/example.ts");
});
