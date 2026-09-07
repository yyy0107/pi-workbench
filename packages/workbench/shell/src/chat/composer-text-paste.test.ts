import assert from "node:assert/strict";
import test from "node:test";
import { addComposerTextFromPaste } from "./composer-text-paste";

test("claims a single paste at the UTF-16 boundary synchronously and preserves its original text", () => {
  const added: string[] = [];
  const paste = (text: string, files: File[] = [], items: { kind: string }[] = []) => {
    let prevented = false;
    let stopped = false;
    const handled = addComposerTextFromPaste(
      {
        clipboardData: { files, items, getData: () => text },
        preventDefault: () => {
          prevented = true;
        },
        stopPropagation: () => {
          stopped = true;
        },
      },
      async (value) => {
        added.push(value);
      },
    );
    assert.equal(prevented, handled);
    assert.equal(stopped, handled);
    return handled;
  };
  assert.equal(paste("x".repeat(4999)), false);
  assert.equal(paste("x".repeat(4999)), false);
  assert.equal(paste("x".repeat(5000)), true);
  assert.equal(paste("😀".repeat(2500)), true);
  const original = '\t{ "text": "中文" }\r\n' + " ".repeat(5000);
  assert.equal(paste(original), true);
  assert.equal(added.at(-1), original);
  assert.equal(paste(original, [{} as File]), false);
  assert.equal(paste(original, [], [{ kind: "file" }]), false);
  assert.equal(added.length, 3);
});
