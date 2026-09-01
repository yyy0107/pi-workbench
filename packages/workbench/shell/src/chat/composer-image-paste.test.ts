import assert from "node:assert/strict";
import test from "node:test";

import { addComposerImagesFromPaste, composerClipboardImages } from "./composer-image-paste";

function file(name: string, type: string): File {
  return { name, type } as File;
}

test("extracts pasted images without treating clipboard text files as attachments", () => {
  const image = file("screenshot.png", "image/png");
  const text = file("notes.txt", "text/plain");

  assert.deepEqual(composerClipboardImages({ files: [image, text], items: [] }), [image]);
});

test("falls back to clipboard items when the browser does not populate files", () => {
  const image = file("pasted.webp", "image/webp");

  assert.deepEqual(
    composerClipboardImages({
      files: [],
      items: [
        { kind: "string", type: "text/plain", getAsFile: () => null },
        { kind: "file", type: "image/webp", getAsFile: () => image },
      ],
    }),
    [image],
  );
});

test("adds every pasted image and claims the native paste", async () => {
  const first = file("first.png", "image/png");
  const second = file("second.jpeg", "image/jpeg");
  const added: File[] = [];
  let prevented = false;
  let propagationStopped = false;

  const handled = await addComposerImagesFromPaste(
    {
      clipboardData: { files: [first, second], items: [] },
      preventDefault: () => {
        prevented = true;
      },
      stopPropagation: () => {
        propagationStopped = true;
      },
    },
    {
      attachmentsEnabled: true,
      addAttachment: async (image) => {
        added.push(image);
      },
    },
  );

  assert.equal(handled, true);
  assert.equal(prevented, true);
  assert.equal(propagationStopped, true);
  assert.deepEqual(added, [first, second]);
});

test("leaves paste untouched when attachments are unavailable", async () => {
  let prevented = false;
  let propagationStopped = false;
  let addCount = 0;

  const handled = await addComposerImagesFromPaste(
    {
      clipboardData: { files: [file("screen.png", "image/png")], items: [] },
      preventDefault: () => {
        prevented = true;
      },
      stopPropagation: () => {
        propagationStopped = true;
      },
    },
    {
      attachmentsEnabled: false,
      addAttachment: async () => {
        addCount += 1;
      },
    },
  );

  assert.equal(handled, false);
  assert.equal(prevented, false);
  assert.equal(propagationStopped, false);
  assert.equal(addCount, 0);
});

test("continues adding remaining pasted images after one attachment is rejected", async () => {
  const first = file("first.png", "image/png");
  const second = file("second.png", "image/png");
  const attempted: File[] = [];

  const handled = await addComposerImagesFromPaste(
    {
      clipboardData: { files: [first, second], items: [] },
      preventDefault: () => {},
      stopPropagation: () => {},
    },
    {
      attachmentsEnabled: true,
      addAttachment: async (image) => {
        attempted.push(image);
        if (image === first) throw new Error("fixture rejection");
      },
    },
  );

  assert.equal(handled, true);
  assert.deepEqual(attempted, [first, second]);
});
