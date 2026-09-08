import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { saveFileAs } from "./file-download";

function stubGlobal(t: TestContext, name: "window" | "document", value: unknown) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else Reflect.deleteProperty(globalThis, name);
  });
}

test("save requests the picker synchronously before reading and commits the selected file", async (t) => {
  const calls: unknown[] = [];
  const blob = new Blob(["contents"]);
  const writable = {
    async write(value: Blob) {
      calls.push(value);
    },
    async close() {
      calls.push("close");
    },
  };
  stubGlobal(t, "window", {
    async showSaveFilePicker(options: unknown) {
      calls.push(options);
      return {
        async createWritable() {
          calls.push("createWritable");
          return writable;
        },
      };
    },
  });
  const saving = saveFileAs("file.txt", async () => {
    calls.push("read");
    return blob;
  });
  assert.deepEqual(calls, [{ suggestedName: "file.txt" }]);
  await saving;
  assert.deepEqual(calls, [{ suggestedName: "file.txt" }, "read", "createWritable", blob, "close"]);
});

test("save preserves cancellation without reading and aborts unsuccessful writes", async (t) => {
  const cancelled = new DOMException("Cancelled", "AbortError");
  const browser = {
    showSaveFilePicker: async (): Promise<unknown> => {
      throw cancelled;
    },
  };
  stubGlobal(t, "window", browser);
  await assert.rejects(
    saveFileAs("file.txt", async () => {
      assert.fail("A cancelled save must not read the file");
    }),
    (error) => error === cancelled,
  );

  const writeError = new Error("Write failed");
  let aborted = false;
  browser.showSaveFilePicker = async () => ({
    async createWritable() {
      return {
        async write() {
          throw writeError;
        },
        async close() {
          assert.fail("A failed write must not commit");
        },
        async abort() {
          aborted = true;
          throw new Error("Abort also failed");
        },
      };
    },
  });
  await assert.rejects(
    saveFileAs("file.txt", async () => new Blob(["contents"])),
    (error) => error === writeError,
  );
  assert.equal(aborted, true);
});

test("save falls back to a download and revokes the Blob URL after forty seconds", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  stubGlobal(t, "window", {});
  const anchor = { href: "", download: "", rel: "", click: t.mock.fn() };
  const body = { appendChild: t.mock.fn(), removeChild: t.mock.fn() };
  stubGlobal(t, "document", {
    body,
    createElement: (tag: string) => {
      assert.equal(tag, "a");
      return anchor;
    },
  });
  const blob = new Blob(["contents"]);
  t.mock.method(URL, "createObjectURL", (value: Blob) => {
    assert.equal(value, blob);
    return "blob:download";
  });
  const revoke = t.mock.method(URL, "revokeObjectURL", () => {});
  await saveFileAs("file.txt", async () => blob);
  assert.equal(anchor.href, "blob:download");
  assert.equal(anchor.download, "file.txt");
  assert.equal(anchor.rel, "noopener");
  assert.deepEqual(body.appendChild.mock.calls[0].arguments, [anchor]);
  assert.equal(anchor.click.mock.callCount(), 1);
  assert.deepEqual(body.removeChild.mock.calls[0].arguments, [anchor]);
  t.mock.timers.tick(39_999);
  assert.equal(revoke.mock.callCount(), 0);
  t.mock.timers.tick(1);
  assert.deepEqual(revoke.mock.calls[0].arguments, ["blob:download"]);
});
