import assert from "node:assert/strict";
import test from "node:test";

import { writeClipboardText, type ClipboardTextWriter } from "./clipboard";

test("reports successful clipboard text writes", async () => {
  const values: string[] = [];
  const clipboard: ClipboardTextWriter = {
    async writeText(value) {
      values.push(value);
    },
  };

  assert.equal(await writeClipboardText("copied", clipboard), true);
  assert.deepEqual(values, ["copied"]);
});

test("contains unavailable, synchronously denied, and asynchronously denied clipboard writes", async () => {
  assert.equal(await writeClipboardText("unavailable", undefined), false);
  assert.equal(
    await writeClipboardText("synchronous", {
      writeText() {
        throw new DOMException("Write permission denied", "NotAllowedError");
      },
    }),
    false,
  );
  assert.equal(
    await writeClipboardText("asynchronous", {
      writeText() {
        return Promise.reject(new DOMException("Write permission denied", "NotAllowedError"));
      },
    }),
    false,
  );
  const inaccessibleClipboard = Object.defineProperty({}, "writeText", {
    get() {
      throw new DOMException("Clipboard access denied", "NotAllowedError");
    },
  }) as ClipboardTextWriter;
  assert.equal(await writeClipboardText("inaccessible", inaccessibleClipboard), false);
});
