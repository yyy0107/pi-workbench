import assert from "node:assert/strict";
import test from "node:test";
import { WORKSPACE_FILE_EDITABLE_SIZE_LIMIT } from "@workbench/agent-runtime-contracts/runtime-capabilities";
import { readFileLinkText, unsavedFileLinkContent } from "./file-link-content";

test("copying file links prefers current buffers and keeps runtime text validation for disk reads", async () => {
  assert.equal(unsavedFileLinkContent(), undefined);
  assert.equal(
    unsavedFileLinkContent({ content: "old disk", savedContent: "old disk" }),
    undefined,
  );
  assert.equal(unsavedFileLinkContent({ content: "", savedContent: "old disk" }), "");
  assert.equal(
    unsavedFileLinkContent({ content: "unsaved edit", savedContent: "old disk" }),
    "unsaved edit",
  );
  const calls: string[] = [];
  const files: Parameters<typeof readFileLinkText>[0] = {
    readFile: async (path) => {
      calls.push(`read:${path}`);
      if (path.endsWith(".bin")) throw new Error("unsupported encoding");
      return {
        absolutePath: path,
        name: "notes.txt",
        content: "saved content",
        encoding: "utf-8",
        version: "v1",
        size: 13,
        modifiedAt: 1,
      };
    },
    streamFileText: async (path, { onChunk }) => {
      calls.push(`stream:${path}`);
      onChunk({ text: "large ", loadedBytes: 6 });
      onChunk({ text: "文本", loadedBytes: 12 });
      return { loadedBytes: 12 };
    },
  };
  assert.equal(
    await readFileLinkText(files, "/outside/notes.txt", 13, "unsaved edit"),
    "unsaved edit",
  );
  assert.equal(await readFileLinkText(files, "/outside/notes.txt", 13, ""), "");
  assert.deepEqual(calls, []);
  assert.equal(await readFileLinkText(files, "/outside/notes.txt", 13), "saved content");
  assert.equal(
    await readFileLinkText(files, "/outside/large.txt", WORKSPACE_FILE_EDITABLE_SIZE_LIMIT + 1),
    "large 文本",
  );
  await assert.rejects(
    () => readFileLinkText(files, "/outside/file.bin", 10),
    /unsupported encoding/,
  );
  assert.deepEqual(calls, [
    "read:/outside/notes.txt",
    "stream:/outside/large.txt",
    "read:/outside/file.bin",
  ]);
});
