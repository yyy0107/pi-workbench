import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorkbenchDraftPersistence,
  createWorkbenchThreadScrollPersistence,
} from "@/workbench/providers/workbench-session-persistence";

class MemoryStorage {
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

test("namespaces workspace drafts and migrates all pre-package direct keys", () => {
  const storage = new MemoryStorage();
  const persistence = createWorkbenchDraftPersistence("installation-a", () => storage);
  const fixtures = [
    {
      logical: "workbench:browser-address-draft:v2:browser-1",
      legacy: "pi-workbench:browser-address-draft:v1:browser-1",
    },
    {
      logical: 'workbench:right-workspace-feedback-draft:v2:surface-1:review:{"path":"a.ts"}',
      legacy: 'pi-workbench:right-workspace-feedback-draft:v1:surface-1:review:{"path":"a.ts"}',
    },
    {
      logical: "workbench:workspace-file-draft:v1:file-1",
      legacy: "workbench:workspace-file-draft:v1:file-1",
    },
  ] as const;

  for (const [index, fixture] of fixtures.entries()) {
    storage.setItem(fixture.legacy, `draft-${index}`);
    assert.equal(persistence.getItem(fixture.logical), `draft-${index}`);
    assert.equal(storage.getItem(fixture.legacy), null);
    assert.equal(
      storage.getItem(`workbench:workspace-drafts:v1:installation-a:${fixture.logical}`),
      `draft-${index}`,
    );
  }
});

test("keeps product draft namespaces independent and clears legacy aliases on writes", () => {
  const storage = new MemoryStorage();
  const first = createWorkbenchDraftPersistence("installation-a", () => storage);
  const second = createWorkbenchDraftPersistence("installation-b", () => storage);
  const keys = [
    "workbench:browser-address-draft:v2:shared",
    "workbench:workspace-file-draft:v1:shared",
  ] as const;

  for (const key of keys) {
    first.setItem(key, "first-installation");
    second.setItem(key, "second-installation");
    assert.equal(first.getItem(key), "first-installation");
    assert.equal(second.getItem(key), "second-installation");

    first.removeItem(key);
    assert.equal(first.getItem(key), null);
    assert.equal(second.getItem(key), "second-installation");
  }
});

test("migrates the original thread scroll cache through the keyless app port", () => {
  const storage = new MemoryStorage();
  storage.setItem("workbench.thread-scroll-positions.v1", '[["thread-1",{"scrollTop":8}]]');
  const persistence = createWorkbenchThreadScrollPersistence("installation-a", () => storage);

  assert.equal(persistence.read(), '[["thread-1",{"scrollTop":8}]]');
  assert.equal(storage.getItem("workbench.thread-scroll-positions.v1"), null);
  persistence.write('[["thread-2",{"scrollTop":16}]]');
  assert.equal(
    storage.getItem("workbench:thread-scroll-positions:v2:installation-a"),
    '[["thread-2",{"scrollTop":16}]]',
  );
});
