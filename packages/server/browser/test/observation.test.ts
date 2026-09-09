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
  assert.equal(
    (await observe("Play target")).nodes.find((node) => node.role === "button")?.ref,
    ref,
    "A filtered snapshot does not invalidate previous refs",
  );
  const screenshot = (await browser.handle(
    { type: "screenshot", sessionId: "tab", format: "png" },
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
  const compact = (await browser.handle(
    { type: "screenshot", sessionId: "tab", maxDim: 600 },
    agent,
  )) as BrowserFile;
  assert.equal(compact.mimeType, "image/jpeg");
  assert.deepEqual(compact.viewport, screenshot.viewport);
  assert.deepEqual(compact.pixels, { width: 600, height: 450 });
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

test(
  "background tabs deliver trusted clicks and prioritize dialog changes over changing text",
  { timeout: 20_000 },
  async (t) => {
    try {
      await findBrowserExecutable();
    } catch {
      t.skip("Chrome is not installed");
      return;
    }
    const directory = await mkdtemp(path.join(tmpdir(), "browser-background-input-"));
    const browser = new BrowserManager({ stateDirectory: directory });
    const server = createServer((_request, response) =>
      response.end(
        "<!doctype html><title>Waiting</title>" +
          Array.from({ length: 30 }, (_, i) => `<div class="noise">Timer ${i}</div>`).join("") +
          '<div role="dialog" aria-label="Login" id="login"><div id="close" role="button" aria-label="Close login" style="position:fixed;left:667px;top:200px;width:37px;height:36px" onclick="document.title=event.isTrusted?\'Closed natively\':\'Synthetic\';document.querySelectorAll(\'.noise\').forEach(el=>el.remove());document.querySelector(\'#login\').remove()"><svg width="37" height="36"><path d="M13 12L24 23M24 12L13 23" stroke="black"/></svg></div></div>' +
          "<button style=\"position:fixed;left:20px;top:60px;width:120px;height:40px\" onclick=\"document.title=event.isTrusted?'Next natively':'Synthetic'\">Next video</button>",
      ),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const control = new AbortController();
    const agent = { source: "agent" as const, controlSignal: control.signal };
    t.after(async () => {
      control.abort();
      browser.dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    });
    await browser.handle(
      {
        type: "attach",
        sessionId: "background",
        projectId: "project",
        url: `http://127.0.0.1:${address.port}`,
      },
      agent,
    );
    await browser.handle({
      type: "viewport",
      sessionId: "background",
      width: 691,
      height: 839,
      visible: true,
    });
    await browser.handle({ type: "snapshot", sessionId: "background" }, agent);
    await browser.handle({ type: "attach", sessionId: "front", projectId: "project" });
    await browser.handle({
      type: "viewport",
      sessionId: "front",
      width: 1024,
      height: 768,
      visible: true,
    });
    const clicked = (await browser.handle(
      { type: "click", sessionId: "background", selector: "#close" },
      {
        ...agent,
        signal: AbortSignal.timeout(6000),
      },
    )) as {
      target: { connected: boolean; visible: boolean };
      pageChanges: { removed: BrowserSnapshot["nodes"]; truncated: boolean };
    };
    assert.equal(clicked.target.connected, false, "the target is verified after native dispatch");
    assert.equal(clicked.target.visible, false);
    assert.equal(clicked.pageChanges.removed[0]?.role, "dialog");
    assert.ok(
      clicked.pageChanges.truncated,
      "more than eight removed text nodes cannot hide the dialog",
    );
    const observe = () =>
      browser.handle(
        { type: "snapshot", sessionId: "background" },
        agent,
      ) as Promise<BrowserSnapshot>;
    assert.equal((await observe()).nodes[0]?.name, "Closed natively");
    await browser.handle(
      { type: "click", sessionId: "background", x: 80, y: 80 },
      {
        ...agent,
        signal: AbortSignal.timeout(6000),
      },
    );
    assert.equal((await observe()).nodes[0]?.name, "Next natively");
    const capture = (await browser.handle(
      { type: "snapshot", sessionId: "background", includeScreenshot: true },
      agent,
    )) as BrowserSnapshot & { screenshot: BrowserFile };
    assert.equal(capture.screenshot.mimeType, "image/jpeg");
    assert.ok(
      Math.max(capture.screenshot.pixels!.width, capture.screenshot.pixels!.height) <= 1600,
    );
    assert.deepEqual(capture.screenshot.viewport, { width: 691, height: 839 });
  },
);
