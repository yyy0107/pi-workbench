import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { browserFileUrl } from "./browser-file-opener";
import { MemoryBrowserSessionService } from "./memory-browser-session-service";

test("internal browser file URLs preserve local paths and create distinct tabs", async () => {
  for (const path of ["/tmp/index.html", "/tmp/中文 #100%.html", "/tmp/a\\b.html"]) {
    assert.equal(browserFileUrl(path), pathToFileURL(path).href);
  }
  assert.equal(browserFileUrl("C:\\Site files\\index.html"), "file:///C:/Site%20files/index.html");
  assert.throws(() => browserFileUrl("index.html"));
  const browser = new MemoryBrowserSessionService();
  const request = { projectId: "project", url: browserFileUrl("/tmp/index.html") };
  const first = await browser.create(request);
  const second = await browser.create(request);
  assert.equal(first.url, request.url);
  assert.notEqual(first.id, second.id);
});
