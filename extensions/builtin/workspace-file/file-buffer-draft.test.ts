import assert from "node:assert/strict";
import test from "node:test";

import {
  clearFileBufferDraft,
  readFileBufferDraft,
  writeFileBufferDraft,
  type FileBufferDraftStorage,
} from "./file-buffer-draft";

class MemoryStorage implements FileBufferDraftStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

test("restores an unsaved file buffer for the same persisted surface", () => {
  const storage = new MemoryStorage();
  const draft = {
    version: "version-1",
    savedContent: "before",
    content: "after",
  };

  writeFileBufferDraft(storage, "file:surface-1", draft);

  assert.deepEqual(readFileBufferDraft(storage, "file:surface-1"), draft);
  assert.equal(readFileBufferDraft(storage, "file:surface-2"), undefined);
});

test("clears a saved file buffer draft", () => {
  const storage = new MemoryStorage();
  writeFileBufferDraft(storage, "file:surface-1", {
    version: "version-1",
    savedContent: "before",
    content: "after",
  });

  clearFileBufferDraft(storage, "file:surface-1");

  assert.equal(readFileBufferDraft(storage, "file:surface-1"), undefined);
});

test("ignores malformed persisted drafts", () => {
  const storage = new MemoryStorage();
  storage.values.set("workbench:workspace-file-draft:v1:file:surface-1", "{broken");

  assert.equal(readFileBufferDraft(storage, "file:surface-1"), undefined);
});
