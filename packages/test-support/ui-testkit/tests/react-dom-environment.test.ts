import assert from "node:assert/strict";
import test from "node:test";
import {
  installMinimalReactDomEnvironment,
  flushReactMicrotasks,
} from "../src/react-dom-environment";

test("independent installations restore the exact previous global descriptors", () => {
  const keys = [
    "document",
    "HTMLElement",
    "HTMLIFrameElement",
    "IS_REACT_ACT_ENVIRONMENT",
    "window",
  ];
  const original = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  const first = installMinimalReactDomEnvironment();
  try {
    const firstDocument = document;
    assert.equal(first.container.ownerDocument, document);
    const nested = installMinimalReactDomEnvironment();
    try {
      assert.notEqual(document, firstDocument);
      assert.notEqual(nested.container, first.container);
      assert.equal(nested.container.ownerDocument, document);
    } finally {
      nested.restore();
    }
    assert.equal(document, firstDocument);
  } finally {
    first.restore();
  }
  assert.deepEqual(
    keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key)),
    original,
  );
});

test("flushes pending React microtasks", async () => {
  let flushed = false;
  void Promise.resolve().then(() => {
    flushed = true;
  });
  await flushReactMicrotasks();
  assert.equal(flushed, true);
});
