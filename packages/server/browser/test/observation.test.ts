import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  parseBrowserCommand,
  type BrowserFile,
  type BrowserSnapshot,
} from "@workbench/browser-contracts";
import { BrowserManager } from "../src/index";
import { findBrowserExecutable } from "../src/cdp";

test("snapshot queries and coordinate clicks validate their arguments", () => {
  for (const fields of [{ x: 0, y: 0 }, { x: 12.5, y: 20 }, { ref: "observed:1" }])
    assert.ok(parseBrowserCommand({ type: "click", sessionId: "tab", ...fields }));
  for (const fields of [
    { x: 1 },
    { x: -1, y: 2 },
    { x: NaN, y: 2 },
    { x: 1, y: Infinity },
    { x: 1, y: 2, ref: "observed:1" },
  ])
    assert.equal(parseBrowserCommand({ type: "click", sessionId: "tab", ...fields }), undefined);
  assert.ok(parseBrowserCommand({ type: "snapshot", sessionId: "tab", query: "我怀念的" }));
  for (const query of [1, "x".repeat(1025)])
    assert.equal(parseBrowserCommand({ type: "snapshot", sessionId: "tab", query }), undefined);
});

test("Chrome searches beyond snapshot truncation and clicks once in zoomed CSS coordinates", async (t) => {
  try {
    await findBrowserExecutable();
  } catch {
    t.skip("Chrome is not installed");
    return;
  }
  const directory = await mkdtemp(path.join(tmpdir(), "browser-targeted-observation-"));
  const browser = new BrowserManager({ stateDirectory: directory });
  const server = createServer((_request, response) =>
    response.end(
      '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<div><div><label>Password<input type="password" value="private-secret"></label></div></div>' +
        Array.from({ length: 1200 }, (_, i) => `<div><p>Track ${i}</p></div>`).join("") +
        '<button style="position:fixed;left:20px;top:60px;width:120px;height:40px" onclick="this.textContent=\'Pause target\';document.title=String((window.clicks=(window.clicks||0)+1))">Play target</button>',
    ),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  t.after(async () => {
    browser.dispose();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  const control = new AbortController();
  const agent = { source: "agent" as const, controlSignal: control.signal };
  await browser.handle(
    {
      type: "attach",
      sessionId: "tab",
      projectId: "project",
      url: `http://127.0.0.1:${address.port}`,
    },
    agent,
  );
  await browser.handle({
    type: "viewport",
    sessionId: "tab",
    width: 800,
    height: 600,
    zoom: 2,
    visible: true,
  });
  const observe = (query?: string) =>
    browser.handle(
      { type: "snapshot", sessionId: "tab", query },
      agent,
    ) as Promise<BrowserSnapshot>;
  const all = await observe();
  assert.equal(all.truncated, true);
  assert.ok(!all.nodes.some((node) => node.name === "Play target"));
  assert.ok(
    all.nodes.filter((node) => node.role === "generic" && !node.name).length < 5,
    "Empty wrappers do not crowd out content; editable controls remain",
  );
  assert.ok(all.nodes.some((node) => node.name === "Track 400"));
  assert.ok(!JSON.stringify(all).includes("private-secret"));
  const target = await observe("pLaY tArGeT");
  assert.equal(target.truncated, false);
  const ref = target.nodes.find((node) => node.role === "button")?.ref;
  assert.ok(ref, "Search must reach a target beyond the unfiltered budget");
  assert.ok(target.nodes.length < 5);
  assert.equal(
    (await observe("private-secret")).nodes.length,
    0,
    "Queries must not expose password values",
  );
  await assert.rejects(browser.handle({ type: "click", sessionId: "tab", ref }, agent), {
    code: "browser-element-stale",
  });
  const screenshot = (await browser.handle(
    { type: "screenshot", sessionId: "tab" },
    agent,
  )) as BrowserFile;
  const png = Buffer.from(screenshot.data, "base64");
  assert.deepEqual(screenshot.pixels, {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  });
  assert.deepEqual(screenshot.viewport, { width: 400, height: 300 });
  assert.deepEqual(screenshot.capture, screenshot.viewport);
  assert.deepEqual(screenshot.pixels, { width: 800, height: 600 });
  await assert.rejects(browser.handle({ type: "click", sessionId: "tab", x: 400, y: 80 }, agent), {
    code: "browser-invalid",
  });
  await browser.handle({ type: "click", sessionId: "tab", x: 80, y: 80 }, agent);
  const clicked = await observe();
  assert.equal(clicked.nodes[0]?.name, "1", "A coordinate click dispatches one native click");
  assert.equal(clicked.session.zoom, 2, "Coordinate clicks preserve the user's zoom");
  const paused = await observe("Pause target");
  const pauseRef = paused.nodes.find((node) => node.role === "button")?.ref;
  assert.ok(pauseRef);
  await browser.handle({ type: "click", sessionId: "tab", ref: pauseRef }, agent);
  assert.equal(
    (await observe()).nodes[0]?.name,
    "2",
    "Filtered refs still support semantic clicks",
  );
});
