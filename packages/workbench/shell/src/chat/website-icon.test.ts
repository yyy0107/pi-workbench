import assert from "node:assert/strict";
import test from "node:test";
import { loadWebsiteIcon, websiteIconUrl } from "./website-icon";

test("website icons use only HTTP origins without credentials or message content", () => {
  assert.equal(
    websiteIconUrl("https://user:secret@music.163.com/#/song?id=42"),
    "https://music.163.com/favicon.ico",
  );
  assert.equal(websiteIconUrl("//example.com/path?q=secret"), "https://example.com/favicon.ico");
  for (const href of [
    "file:///tmp/a",
    "mailto:a@example.com",
    "javascript:alert(1)",
    "https://",
    "#anchor",
  ]) {
    assert.equal(websiteIconUrl(href), null);
  }
});

test("async icon loads share origin requests and cache success and failure", async () => {
  const images: FakeImage[] = [];
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    referrerPolicy = "";
    src = "";
    constructor() {
      images.push(this);
    }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, "Image");
  Object.defineProperty(globalThis, "Image", { configurable: true, value: FakeImage });
  try {
    const first = loadWebsiteIcon("https://success.example/a");
    const second = loadWebsiteIcon("https://success.example/b?private=yes");
    assert.equal(first, second);
    assert.equal(images.length, 1);
    assert.equal(images[0].referrerPolicy, "no-referrer");
    images[0].onload!();
    assert.equal(await first, "https://success.example/favicon.ico");
    assert.equal(await loadWebsiteIcon("https://success.example/c"), await first);
    const failed = loadWebsiteIcon("https://failed.example");
    images[1].onerror!();
    assert.equal(await failed, null);
    assert.equal(await loadWebsiteIcon("https://failed.example/again"), null);
    assert.equal(images.length, 2);
    assert.equal(await loadWebsiteIcon("file:///tmp/test"), null);
  } finally {
    if (original) Object.defineProperty(globalThis, "Image", original);
    else Reflect.deleteProperty(globalThis, "Image");
  }
});
