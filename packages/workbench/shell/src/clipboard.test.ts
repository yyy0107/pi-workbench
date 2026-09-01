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

test("falls back when the Clipboard API is unavailable or rejects the write", async () => {
  const values: string[] = [];
  const fallback = (value: string) => {
    values.push(value);
    return true;
  };

  assert.equal(await writeClipboardText("unavailable", undefined, fallback), true);
  assert.equal(
    await writeClipboardText(
      "denied",
      {
        writeText() {
          return Promise.reject(new DOMException("Write permission denied", "NotAllowedError"));
        },
      },
      fallback,
    ),
    true,
  );
  assert.deepEqual(values, ["unavailable", "denied"]);
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

test("contains fallback failures", async () => {
  assert.equal(
    await writeClipboardText("failed", undefined, () => {
      throw new Error("Fallback failed");
    }),
    false,
  );
});
