import assert from "node:assert/strict";
import test from "node:test";
import { saveBrowserFile, uploadBrowserFiles } from "./browser-files";

test("upload serialization preserves binary data and bounds total size before reading files", async () => {
  const binary = new File([Uint8Array.of(0, 255, 128, 65)], "image.bin", {
    type: "application/octet-stream",
  });
  assert.deepEqual(await uploadBrowserFiles([binary]), [
    { name: "image.bin", mimeType: "application/octet-stream", data: "AP+AQQ==" },
  ]);
  await assert.rejects(
    uploadBrowserFiles([
      {
        size: 8 * 1024 * 1024 + 1,
        arrayBuffer: async () => {
          assert.fail("oversized files must not be read");
        },
      } as unknown as File,
    ]),
    /browser-file-too-large/,
  );
  await assert.rejects(
    uploadBrowserFiles(Array.from({ length: 21 }, () => binary)),
    /browser-file-too-large/,
  );
});

test("saving honors picker cancellation, falls back after lost activation, and aborts failed writes", async (context) => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  const file = { name: "path/report.txt", mimeType: "text/plain", data: btoa("report") };
  let written = "";
  let closes = 0;
  let aborts = 0;
  let clicks = 0;
  let revoked = 0;
  let suggestedName = "";
  const link = { href: "", download: "", dataset: {}, click: () => clicks++, remove() {} };
  const write = async (blob: Blob) => {
    written = await blob.text();
  };
  const browserWindow = {
    showSaveFilePicker: async (options: { suggestedName: string }) => {
      suggestedName = options.suggestedName;
      return {
        createWritable: async () => ({
          write,
          close: async () => {
            closes++;
          },
          abort: async () => {
            aborts++;
          },
        }),
      };
    },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: browserWindow });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { body: { append() {} }, createElement: () => link },
  });
  context.mock.method(URL, "createObjectURL", () => "blob:test");
  context.mock.method(URL, "revokeObjectURL", () => {
    revoked++;
  });
  context.mock.method(globalThis, "setTimeout", ((callback: () => void) => {
    callback();
    return 0;
  }) as unknown as typeof setTimeout);
  try {
    await saveBrowserFile(file, true);
    assert.equal(written, "report");
    assert.equal(suggestedName, "report.txt");
    assert.equal(closes, 1);
    assert.equal(clicks, 0);
    browserWindow.showSaveFilePicker = async () => {
      throw new DOMException("canceled", "AbortError");
    };
    await saveBrowserFile(file, true);
    assert.equal(clicks, 0);
    browserWindow.showSaveFilePicker = async () => {
      throw new DOMException("activation expired", "SecurityError");
    };
    await saveBrowserFile(file, true);
    assert.equal(clicks, 1);
    assert.equal(link.download, "report.txt");
    assert.equal(revoked, 1);
    browserWindow.showSaveFilePicker = async () => ({
      createWritable: async () => ({
        write: async () => {
          throw new Error("disk full");
        },
        close: async () => {
          closes++;
        },
        abort: async () => {
          aborts++;
        },
      }),
    });
    await assert.rejects(saveBrowserFile(file, true), /disk full/);
    assert.equal(aborts, 1);
    assert.equal(clicks, 1);
  } finally {
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    else Reflect.deleteProperty(globalThis, "window");
    if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
