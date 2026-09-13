import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  parseBrowserCommand,
  type BrowserCommand,
  type BrowserFile,
  type BrowserSnapshot,
} from "@workbench/browser-contracts";
import { BrowserManager } from "../src/index";
import { findBrowserExecutable } from "../src/cdp";
import { BrowserDiagnostics } from "../src/diagnostics";
import { searchExpression } from "../src/page-scripts";

test("enhanced command validation and bounded diagnostic cursors", () => {
  for (const command of [
    { type: "select", ref: "e1", value: "a", label: "a" },
    { type: "click", selector: "button", ref: "e1" },
    { type: "wait-for", selector: "button", text: "Save" },
    { type: "fill-form", fields: [{ ref: "e1", value: {} }] },
    { type: "screenshot", maxDim: -1 },
    { type: "drag", fromX: 0, fromY: 0, toX: 1, toY: 1, dataTransfer: { "text/plain": 42 } },
  ])
    assert.equal(parseBrowserCommand({ sessionId: "tab", ...command }), undefined);
  const diagnostics = new BrowserDiagnostics();
  for (let index = 0; index < 505; index++)
    diagnostics.record({
      method: "Runtime.consoleAPICalled",
      params: { type: "log", args: [{ value: index }] },
    });
  const first = diagnostics.console({ limit: 2 });
  assert.equal(first.bufferOverflowed, true);
  assert.deepEqual(
    first.entries.map((entry) => entry.text),
    ["5", "6"],
  );
  assert.equal(diagnostics.console({ sinceSeq: first.nextCursor, limit: 1 }).entries[0]?.text, "7");
  diagnostics.record({
    method: "Network.requestWillBeSent",
    params: {
      requestId: "r",
      request: { url: "https://example.test/api", method: "GET" },
      timestamp: 1,
      type: "Fetch",
    },
  });
  const cursor = diagnostics.network({}).nextCursor;
  diagnostics.record({
    method: "Network.responseReceived",
    params: { requestId: "r", response: { status: 404, mimeType: "application/json" } },
  });
  diagnostics.record({
    method: "Network.loadingFinished",
    params: { requestId: "r", timestamp: 1.5, encodedDataLength: 128 },
  });
  const changed = diagnostics.network({
    sinceSeq: cursor,
    statusFilter: { min: 400 },
    resourceTypes: ["Fetch"],
  });
  assert.equal(changed.requests[0]?.durationMs, 500);
  assert.equal(changed.requests[0]?.status, 404);
  assert.equal(diagnostics.console({ textPattern: "/^50[0-4]$/" }).total, 5);
  assert.equal(diagnostics.network({ urlPattern: "/EXAMPLE/i" }).total, 1);
  diagnostics.record({
    method: "Network.requestWillBeSent",
    params: {
      requestId: "r",
      redirectResponse: { status: 302 },
      request: { url: "https://redirect.test/", method: "GET" },
      timestamp: 2,
      type: "Fetch",
    },
  });
  assert.equal(
    diagnostics.network({ statusFilter: { min: 300, max: 399 } }).requests[0]?.redirected,
    true,
  );
  diagnostics.record({
    method: "Runtime.consoleAPICalled",
    params: { type: "log", args: [{ value: "a".repeat(4000) + "!" }] },
  });
  assert.throws(() => diagnostics.console({ textPattern: "/(a+)+$/" }), {
    code: "browser-invalid",
  });
});

test("real Chrome rich forms, stable refs, diagnostics, waits, drag payloads and isolated research", async (t) => {
  try {
    await findBrowserExecutable();
  } catch {
    t.skip("Chrome is not installed");
    return;
  }
  const directory = await mkdtemp(path.join(tmpdir(), "browser-enhancements-"));
  const article =
    "Readable article content with enough detail to test extraction and preserve the current tab. ".repeat(
      6,
    );
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", request.url === "/api" ? "application/json" : "text/html");
    if (request.url === "/api") {
      response.end('{"answer":42}');
      return;
    }
    if (request.url === "/article") {
      response.end(
        `<title>Research</title><nav>Unwanted navigation</nav><article><h1>Article heading</h1><p>${article}</p></article>`,
      );
      return;
    }
    if (request.url === "/search") {
      response.end(
        '<main id="search"><div class="g"><a href="https://www.google.com/url?q=https%3A%2F%2Fexample.test%2Farticle"><h3>Example result</h3></a><p>A useful snippet.</p></div><a href="https://example.test/article#fragment"><h3>Duplicate</h3></a></main>',
      );
      return;
    }
    response.end(`<!doctype html><title>Enhanced form</title>
      <label>Name<input id="name" value="old"></label><label>Password<input type="password" value="never-print-me"></label>
      <label>Choice<select id="choice"><option value="a">Alpha</option><option value="b">Beta</option><option disabled value="c">Disabled</option></select></label>
      <label><input id="check" type="checkbox">Agree</label><div role="textbox" aria-label="Editor" id="editor" contenteditable>old</div>
      <button id="change" onclick="document.querySelector('#result').textContent='Updated result'">Change</button><p id="result">Initial result</p>
      <div id="drop" style="position:absolute;top:350px;left:400px;width:160px;height:100px" ondragover="event.preventDefault()" ondrop="event.preventDefault();this.textContent=event.dataTransfer.getData('text/plain')">Drop here</div>
      <script>window.events=[];document.addEventListener('input',e=>events.push(e.target.id));console.log('fixture console');fetch('/api');</script>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const browser = new BrowserManager({ stateDirectory: directory });
  const control = new AbortController();
  const agent = { source: "agent" as const, controlSignal: control.signal };
  const call = (fields: Record<string, unknown>) =>
    browser.handle({ sessionId: "tab", ...fields } as BrowserCommand, agent) as Promise<any>;
  t.after(async () => {
    control.abort();
    browser.dispose();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  await browser.handle({ type: "settings.update", patch: { fullCdpAccess: true } });
  await call({ type: "attach", projectId: "project", url: origin });
  await call({ type: "wait-for-load" });
  const snapshot: BrowserSnapshot = await call({ type: "snapshot" });
  const ref = (name: string) => {
    const result = snapshot.nodes.find((node) => node.name === name && node.ref)?.ref;
    assert.ok(result, name);
    return result;
  };
  assert.ok(!JSON.stringify(snapshot).includes("never-print-me"));
  const originalRef = ref("Name");
  assert.equal(
    (await call({ type: "snapshot", query: "Name" })).nodes.find((node: any) => node.ref)?.ref,
    originalRef,
  );
  const filled = await call({
    type: "fill-form",
    fields: [
      { ref: originalRef, value: "Alice" },
      { ref: ref("Agree"), value: true },
      { ref: "missing", value: "skip" },
      { ref: ref("Editor"), value: "Edited text" },
    ],
  });
  assert.equal(filled.completed, 3);
  assert.equal(filled.results[2].ok, false);
  assert.equal(
    (await call({ type: "select", selector: "#choice", label: "Beta" })).field.value,
    "b",
  );
  await assert.rejects(call({ type: "select", selector: "#choice", value: "c" }), /disabled/);
  assert.equal(
    (await call({ type: "set-checked", ref: ref("Agree"), checked: true })).field.changed,
    false,
  );
  const changed = await call({ type: "click", ref: ref("Change") });
  assert.ok(JSON.stringify(changed.pageChanges).includes("Updated result"));
  await call({ type: "wait-for", text: "Updated result" });
  await assert.rejects(
    call({ type: "wait-for", selector: "#missing", timeout: 0.05 }),
    /Timed out/,
  );
  await assert.rejects(
    browser.handle(
      { type: "wait", sessionId: "tab", seconds: 30 },
      { ...agent, signal: AbortSignal.timeout(30) },
    ),
  );
  await call({ type: "focus", selector: "#name" });
  await call({ type: "press-key", key: "End" });
  await call({ type: "type", text: " Smith" });
  assert.equal(
    (await call({ type: "evaluate", expression: "return document.querySelector('#name').value" }))
      .value,
    "Alice Smith",
  );
  await call({
    type: "drag",
    fromX: 30,
    fromY: 250,
    toX: 450,
    toY: 400,
    dataTransfer: { "text/plain": "Dropped text" },
  });
  await call({ type: "wait-for", text: "Dropped text" });
  const logs = await call({ type: "console" });
  assert.ok(logs.entries.some((entry: any) => entry.text === "fixture console"));
  assert.equal((await call({ type: "console", sinceSeq: logs.nextCursor })).entries.length, 0);
  const network = await call({ type: "network", urlPattern: "/api", includeResponseBodies: true });
  assert.equal(network.requests[0].body, '{"answer":42}');
  for (const format of ["png", "jpeg"] as const) {
    const screenshot: BrowserFile = await call({
      type: "screenshot",
      format,
      quality: 70,
      maxDim: 500,
    });
    assert.equal(screenshot.mimeType, `image/${format}`);
    assert.ok(
      Math.max(screenshot.pixels!.width, screenshot.pixels!.height) <= 500,
      JSON.stringify(screenshot.pixels),
    );
    assert.deepEqual(screenshot.viewport, { width: 1024, height: 768 });
  }
  await call({ type: "viewport", width: 800, height: 600, visible: false, zoom: 2 });
  const zoomed = await call({ type: "screenshot", maxDim: 300 });
  assert.ok(Math.max(zoomed.pixels.width, zoomed.pixels.height) <= 300);
  const before = await call({ type: "tabs.current" });
  const research = await call({ type: "read-page", url: `${origin}/article` });
  assert.ok(research.text.includes("Article heading"));
  assert.ok(!research.text.includes("Unwanted navigation"));
  assert.equal(research.fallback, false);
  assert.equal((await call({ type: "tabs.current" })).url, before.url);
  assert.equal(
    ((await browser.handle({ type: "tabs.list", projectId: "project" })) as unknown[]).length,
    1,
  );
  await call({ type: "navigate", url: `${origin}/search` });
  await call({ type: "wait-for-load" });
  const search = (await call({ type: "evaluate", expression: `${searchExpression}(10)` })).value;
  assert.deepEqual(
    search.results.map((result: any) => result.url),
    ["https://example.test/article"],
  );
  assert.ok(search.results[0].snippet.includes("useful snippet"));
  await call({
    type: "evaluate",
    expression: "document.body.innerText = 'Before you continue to Google'",
  });
  assert.equal(
    (await call({ type: "evaluate", expression: `${searchExpression}(10)` })).value.reason,
    "captcha",
  );
  await assert.rejects(
    browser.handle({ type: "settings.update", patch: { connection: "chrome" } }),
    { code: "browser-connection-active" },
  );
});
