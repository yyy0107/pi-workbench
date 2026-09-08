import assert from "node:assert/strict";
import test from "node:test";

import { MemoryBrowserSessionService } from "./browser-session-service";

test("browser sessions normalize web addresses and local development hosts", async () => {
  const browser = new MemoryBrowserSessionService();
  for (const [input, expected] of [
    [" ", "about:blank"],
    ["about:blank", "about:blank"],
    [" example.com/path?q=test#section ", "https://example.com/path?q=test#section"],
    ["example.com:8080", "https://example.com:8080/"],
    ["https://EXAMPLE.COM", "https://example.com/"],
    ["http://192.168.1.2:8080", "http://192.168.1.2:8080/"],
    ["localhost:3000", "http://localhost:3000/"],
    ["localhost:443", "http://localhost:443/"],
    ["app.localhost:3000", "http://app.localhost:3000/"],
    ["127.0.0.1:5173", "http://127.0.0.1:5173/"],
    ["127.1", "http://127.0.0.1/"],
    ["127.example.com", "https://127.example.com/"],
    ["[::1]:8080", "http://[::1]:8080/"],
    ["https://localhost:3000", "https://localhost:3000/"],
  ]) {
    const session = await browser.create({ projectId: "project", url: input });
    assert.equal(session.url, expected, input);
    assert.equal(browser.attach({ ...session, url: input }).url, expected, input);
  }
});

test("create, attach and navigate reject unsafe destinations without changing the session", async () => {
  const browser = new MemoryBrowserSessionService();
  const session = await browser.create({ projectId: "project" });
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///tmp/page.html",
    "ftp://example.com",
    "workbench://app/",
    "about:config",
    "about:blank#fragment",
    "custom:1234",
    "https://user:password@example.com",
    "https://user@example.com",
    "https://",
    "https://host:99999",
    "not a host",
  ]) {
    const revision = browser.getRevision();
    await assert.rejects(browser.create({ projectId: "project", url }), Error, url);
    assert.throws(() => browser.attach({ ...session, url }), Error, url);
    await assert.rejects(browser.navigate(session.id, url), Error, url);
    assert.equal(browser.getRevision(), revision, url);
    assert.deepEqual(browser.getSession(session.id), session, url);
  }
});

test("navigation, history and reload reuse the session and advance its frame revision", async () => {
  const browser = new MemoryBrowserSessionService();
  const session = await browser.create({ projectId: "project" });
  await browser.navigate(session.id, "example.com");
  await browser.navigate(session.id, "localhost:3000");
  assert.equal(browser.getSession(session.id)?.revision, 2);
  assert.equal(browser.getSession(session.id)?.canGoBack, true);

  await browser.goBack(session.id);
  assert.equal(browser.getSession(session.id)?.url, "https://example.com/");
  assert.equal(browser.getSession(session.id)?.canGoForward, true);
  await browser.goForward(session.id);
  assert.equal(browser.getSession(session.id)?.url, "http://localhost:3000/");
  await browser.reload(session.id);
  assert.equal(browser.getSession(session.id)?.revision, 5);

  await browser.goBack(session.id);
  await browser.navigate(session.id, "example.org");
  assert.equal(browser.getSession(session.id)?.canGoForward, false);
  assert.equal(browser.getSession(session.id)?.url, "https://example.org/");
  assert.equal(browser.getSession(session.id)?.id, session.id);
});
