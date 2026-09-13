import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  parseBrowserCommand,
  type BrowserEvent,
  type BrowserHistoryEntry,
  type BrowserSessionState,
} from "@workbench/browser-contracts";
import { BrowserManager } from "../src/index";
import { findBrowserExecutable, type BrowserCdp, type CdpEvent } from "../src/cdp";

test("history queries validate their bounded search and result count", () => {
  assert.ok(parseBrowserCommand({ type: "history.list" }));
  assert.ok(parseBrowserCommand({ type: "history.list", query: "search", limit: 100 }));
  for (const query of [123, "x".repeat(2049)])
    assert.equal(parseBrowserCommand({ type: "history.list", query }), undefined);
  for (const limit of [0, 101, 1.5, "10", Infinity])
    assert.equal(parseBrowserCommand({ type: "history.list", limit }), undefined);
});

test("history waits for its own navigation, deduplicates URLs and cleans up failed initialization", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "workbench-browser-history-unique-"));
  const manager = new BrowserManager({ stateDirectory: directory });
  t.after(async () => {
    manager.dispose();
    await rm(directory, { recursive: true, force: true });
  });
  const latest = { url: "https://example.test/", title: "Latest", time: 2000 };
  const other = { url: "https://other.test/", title: "Other", time: 1500 };
  const calls: string[] = [];
  let listener: ((event: CdpEvent) => void) | undefined;
  let navigationError: string | undefined;
  let onNavigate: () => void;
  const nextNavigation = () =>
    new Promise<void>((resolve) => {
      onNavigate = resolve;
    });
  const engine = manager as unknown as { connection(): Promise<BrowserCdp> };
  t.mock.method(
    engine,
    "connection",
    async () =>
      ({
        subscribe(callback: (event: CdpEvent) => void) {
          listener = callback;
          return () => {
            listener = undefined;
          };
        },
        async send(method: string) {
          calls.push(method);
          if (method === "Page.navigate") {
            onNavigate();
            return { errorText: navigationError };
          }
          return method === "Runtime.evaluate"
            ? {
                result: {
                  value: [latest, other, { ...latest, title: "Previous day", time: 1000 }],
                },
              }
            : { targetId: "history", sessionId: "history" };
        },
      }) as BrowserCdp,
  );
  const navigating = nextNavigation();
  const listing = manager.handle({ type: "history.list" });
  await navigating;
  const emit = (method: string, sessionId = "history", params = {}) =>
    listener?.({ method, sessionId, params });
  emit("Page.loadEventFired"); // A late load from the initial about:blank is not the history page.
  emit("Page.frameNavigated", "other", { frame: { url: "chrome://history/" } });
  emit("Page.loadEventFired", "other");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.includes("Runtime.evaluate"), false);
  emit("Page.frameNavigated", "history", { frame: { url: "chrome://history/" } });
  emit("Page.loadEventFired");
  assert.deepEqual(await listing, [latest, other]);
  assert.equal(listener, undefined);
  assert.equal(calls.at(-1), "Target.closeTarget");

  navigationError = "net::ERR_ABORTED";
  await assert.rejects(manager.handle({ type: "history.list" }), {
    code: "browser-operation-failed",
  });
  assert.equal(listener, undefined);
  assert.equal(calls.at(-1), "Target.closeTarget");
  navigationError = undefined;
  const controller = new AbortController();
  const cancelNavigation = nextNavigation();
  const canceled = assert.rejects(
    manager.handle({ type: "history.list" }, { signal: controller.signal }),
    { code: "browser-operation-failed" },
  );
  await cancelNavigation;
  controller.abort();
  await canceled;
  assert.equal(listener, undefined);
  assert.equal(calls.at(-1), "Target.closeTarget");

  t.mock.timers.enable({ apis: ["setTimeout"] });
  const timedNavigation = nextNavigation();
  const timedOut = assert.rejects(manager.handle({ type: "history.list" }), {
    code: "browser-operation-failed",
  });
  await timedNavigation;
  t.mock.timers.tick(5000);
  await timedOut;
  assert.equal(listener, undefined);
  assert.equal(calls.at(-1), "Target.closeTarget");
  t.mock.timers.reset();
});

test("real Chrome reads existing profile history without navigating the active tab or opening CDP access", async (t) => {
  try {
    await findBrowserExecutable();
  } catch {
    t.skip("Chrome is not installed");
    return;
  }
  const directory = await mkdtemp(path.join(tmpdir(), "workbench-browser-history-"));
  const server = createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(
      `<!doctype html><title>History ${request.url}</title><h1>History ${request.url}</h1>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const manager = new BrowserManager({ stateDirectory: directory });
  const engine = manager as unknown as {
    browser: BrowserCdp;
    tabs: Map<string, { targetId: string }>;
  };
  const events: BrowserEvent[] = [];
  manager.subscribe((event) => events.push(event));
  try {
    await manager.handle({
      type: "settings.update",
      patch: { permissions: { history: "deny", download: "deny", upload: "deny" } },
    });
    assert.deepEqual(
      await manager.handle({ type: "history.list" }),
      [],
      "history can be the first browser command after a cold start",
    );
    for (const id of ["older", "recent", "active"]) {
      await manager.handle(
        { type: "attach", sessionId: id, projectId: "project", url: `${origin}/${id}` },
        { source: "agent" },
      );
      await manager.handle({ type: "snapshot", sessionId: id }, { source: "agent" });
      if (id !== "active") await manager.handle({ type: "close", sessionId: id });
    }
    await manager.handle({
      type: "viewport",
      sessionId: "active",
      width: 900,
      height: 600,
      visible: true,
    });
    const targetId = engine.tabs.get("active")!.targetId;
    const records = (await manager.handle({ type: "history.list" })) as BrowserHistoryEntry[];
    for (const id of ["older", "recent", "active"]) {
      const record = records.find((entry) => entry.url === `${origin}/${id}`);
      assert.ok(record, `profile history must include ${id}, including closed tabs`);
      assert.equal(record.title, `History /${id}`);
      assert.ok(Number.isFinite(record.time) && record.time > 0);
    }
    const filtered = (await manager.handle({
      type: "history.list",
      query: "older",
      limit: 1,
    })) as BrowserHistoryEntry[];
    assert.deepEqual(
      filtered.map((entry) => entry.url),
      [`${origin}/older`],
    );
    assert.equal(
      ((await manager.handle({ type: "history.list", limit: 1 })) as BrowserHistoryEntry[]).length,
      1,
    );
    assert.deepEqual(await manager.handle({ type: "history.list", query: "no-such-visit" }), []);
    assert.equal(
      events.some((event) => event.type === "permission"),
      false,
      "user history queries must not require permission",
    );
    await assert.rejects(manager.handle({ type: "history.list" }, { source: "agent" }), {
      code: "browser-permission-denied",
    });
    await assert.rejects(
      manager.handle({
        type: "cdp",
        sessionId: "active",
        method: "Runtime.evaluate",
        params: { expression: "1" },
      }),
      { code: "browser-permission-denied" },
    );
    const tabs = (await manager.handle({
      type: "tabs.list",
      projectId: "project",
    })) as BrowserSessionState[];
    assert.deepEqual(
      tabs.map((tab) => ({ id: tab.id, url: tab.url })),
      [{ id: "active", url: `${origin}/active` }],
    );
    assert.equal(engine.tabs.get("active")!.targetId, targetId);
    const targets = await engine.browser.send("Target.getTargets");
    assert.equal(
      targets.targetInfos.some((target: { url: string }) =>
        target.url.startsWith("chrome://history"),
      ),
      false,
      "private history targets must close after queries",
    );
  } finally {
    manager.dispose();
    server.close();
    await new Promise((resolve) => setTimeout(resolve, 150));
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
