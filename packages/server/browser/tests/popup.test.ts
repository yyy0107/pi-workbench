import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type {
  BrowserEvent,
  BrowserFile,
  BrowserSessionState,
  BrowserSnapshot,
} from "@workbench/browser-contracts";
import { BrowserManager } from "../src/index";
import { findBrowserExecutable, type BrowserCdp } from "../src/cdp";

test("native agent popups preserve opener preloads and remain observable browser tabs", async (t) => {
  try {
    await findBrowserExecutable();
  } catch {
    t.skip("Chrome is not installed");
    return;
  }
  const directory = await mkdtemp(path.join(tmpdir(), "workbench-native-popup-"));
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(
      request.url === "/popup"
        ? `<!doctype html><script>
          if (window.opener) {
            addEventListener('message', event => {
              if (event.source !== window.opener) return;
              document.title = event.data;
              document.body.textContent = event.data;
            });
            window.opener.postMessage('preload', location.origin);
          } else document.title = 'Missing opener';
        </script><body></body>`
        : `<!doctype html><title>Original page</title><script>
          addEventListener('message', event => {
            if (event.data === 'preload') event.source.postMessage('Loaded from opener', event.origin);
          });
        </script><button onclick="window.open('/popup', '_blank')">Open preload</button>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/`;
  const manager = new BrowserManager({ stateDirectory: directory });
  const sessions = new Map<string, BrowserSessionState>();
  let popup: Extract<BrowserEvent, { type: "popup" }> | undefined;
  manager.subscribe((event) => {
    if (event.type === "state" || event.type === "popup")
      sessions.set(event.session.id, event.session);
    if (event.type === "popup") popup = event;
  });
  const waitFor = async (predicate: () => boolean) => {
    const deadline = Date.now() + 5000;
    while (!predicate() && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(predicate(), "native popup did not finish loading");
  };
  const control = new AbortController();
  const agent = { source: "agent" as const, controlSignal: control.signal };
  try {
    await manager.handle({ type: "attach", sessionId: "opener", projectId: "project", url }, agent);
    await waitFor(() => sessions.get("opener")?.status === "ready");
    const snapshot = (await manager.handle(
      { type: "snapshot", sessionId: "opener" },
      agent,
    )) as BrowserSnapshot;
    const button = snapshot.nodes.find((node) => node.name === "Open preload" && node.ref);
    assert.ok(button?.ref);
    await manager.handle({ type: "click", sessionId: "opener", ref: button.ref }, agent);
    await waitFor(() => !!popup && sessions.get(popup.session.id)?.title === "Loaded from opener");
    assert.ok(popup);
    assert.equal(popup.openerSessionId, "opener");
    const child = sessions.get(popup.session.id)!;
    assert.equal(child.projectId, "project");
    assert.equal(child.agentControlled, true);
    assert.equal(child.url, `${url}popup`);
    assert.equal(sessions.get("opener")?.url, url);
    assert.equal(sessions.get("opener")?.title, "Original page");
    assert.equal(
      ((await manager.handle({ type: "tabs.list", projectId: "project" })) as unknown[]).length,
      2,
    );
    await manager.handle({
      type: "viewport",
      sessionId: child.id,
      width: 800,
      height: 600,
      visible: true,
    });
    const image = (await manager.handle(
      { type: "screenshot", sessionId: child.id },
      agent,
    )) as BrowserFile;
    assert.ok(image.data.length > 0);
    control.abort();
    assert.equal(sessions.get(child.id)?.agentControlled, false);
    await manager.handle({ type: "close", sessionId: child.id });
    assert.equal(
      ((await manager.handle({ type: "tabs.list", projectId: "project" })) as unknown[]).length,
      1,
    );
  } finally {
    const browser = (manager as unknown as { browser?: BrowserCdp }).browser;
    const exited = browser?.process ? once(browser.process, "exit") : Promise.resolve();
    manager.dispose();
    await exited;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
