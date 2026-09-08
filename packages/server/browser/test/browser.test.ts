import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { mock } from "node:test";
import {
  parseBrowserCommand,
  type BrowserEvent,
  type BrowserSessionState,
  type BrowserSnapshot,
} from "@workbench/browser-contracts";

import { BrowserError, BrowserManager, normalizeBrowserUrl } from "../src/index";
import { findBrowserExecutable, type BrowserCdp } from "../src/cdp";
import { parseCookieJson, parsePasswordCsv } from "../src/imports";

/** PNG bitmap dimensions are independent from the stream's CSS input coordinates. */
function pngDimensions(data: string): { width: number; height: number } {
  const bytes = Buffer.from(data, "base64");
  assert.equal(bytes.subarray(1, 4).toString(), "PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test("browser observation commands validate their project and observed references", () => {
  assert.equal(parseBrowserCommand({ type: "tabs.list" }), undefined);
  assert.equal(parseBrowserCommand({ type: "tabs.list", projectId: "" }), undefined);
  assert.equal(parseBrowserCommand({ type: "click", sessionId: "tab", ref: "" }), undefined);
  assert.equal(
    parseBrowserCommand({ type: "fill", sessionId: "tab", ref: "ref", text: 123 }),
    undefined,
  );
  assert.ok(parseBrowserCommand({ type: "tabs.list", projectId: "project" }));
  assert.ok(parseBrowserCommand({ type: "fill", sessionId: "tab", ref: "ref", text: "" }));
});

test("real Chrome observes and operates scoped elements without unrestricted CDP", async (t) => {
  try {
    await findBrowserExecutable();
  } catch {
    t.skip("Chrome is not installed");
    return;
  }
  const directory = await mkdtemp(path.join(tmpdir(), "workbench-browser-observation-"));
  const server = createServer((_request, response) =>
    response.end(
      '<!doctype html><title>Observed form</title><label>Name <input id="name" value="old"></label><label>Password <input id="type" type="password" value="private-secret"></label><label>Redirecting input <input onkeydown="document.querySelector(\'#name\').focus()"></label><button onclick="document.querySelector(\'#result\').textContent = document.querySelector(\'#name\').value">Save name</button><p id="result" role="status">Not saved</p><button onclick="this.remove()">Remove me</button><button disabled>Disabled action</button><a href="#next">Next section</a><div style="position:relative;width:150px;height:40px"><button>Covered action</button><div style="position:absolute;inset:0;background:gray"></div></div><iframe title="Embedded form" srcdoc="<button>Frame action</button>"></iframe>',
    ),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = "http://127.0.0.1:" + address.port + "/";
  const browser = new BrowserManager({ stateDirectory: directory });
  const agent = { source: "agent" as const };
  const observe = () =>
    browser.handle({ type: "snapshot", sessionId: "form" }, agent) as Promise<BrowserSnapshot>;
  const ref = (snapshot: BrowserSnapshot, name: string) => {
    const value = snapshot.nodes.find((node) => node.name === name && node.ref)?.ref;
    assert.ok(value, "Missing observed reference: " + name);
    return value;
  };
  try {
    await browser.handle({
      type: "settings.update",
      patch: {
        permissions: { navigate: "allow", history: "allow", download: "deny", upload: "deny" },
      },
    });
    await browser.handle({ type: "attach", sessionId: "form", projectId: "project", url }, agent);
    await browser.handle({
      type: "viewport",
      sessionId: "form",
      width: 800,
      height: 600,
      visible: true,
    });
    let snapshot = await observe();
    assert.equal(snapshot.session.url, url);
    assert.ok(snapshot.nodes.some((node) => node.depth > 0));
    assert.ok(!JSON.stringify(snapshot).includes("private-secret"));
    assert.equal(snapshot.nodes.find((node) => node.name === "Password ")?.value, undefined);
    assert.ok(snapshot.nodes.some((node) => node.unavailable === "frame" && !node.ref));
    assert.ok(!snapshot.nodes.some((node) => node.name === "Frame action"));
    const name = ref(snapshot, "Name ");
    await assert.rejects(
      browser.handle(
        {
          type: "fill",
          sessionId: "form",
          ref: ref(snapshot, "Redirecting input "),
          text: "wrong input",
        },
        agent,
      ),
      { code: "browser-element-not-interactable" },
    );
    await browser.handle(
      { type: "fill", sessionId: "form", ref: name, text: "Native form input" },
      agent,
    );
    await browser.handle(
      { type: "click", sessionId: "form", ref: ref(snapshot, "Save name") },
      agent,
    );
    snapshot = await observe();
    assert.ok(snapshot.nodes.some((node) => node.name === "Native form input"));
    await assert.rejects(
      browser.handle({ type: "fill", sessionId: "form", ref: name, text: "stale" }, agent),
      { code: "browser-element-stale" },
    );
    await assert.rejects(
      browser.handle(
        { type: "click", sessionId: "form", ref: ref(snapshot, "Disabled action") },
        agent,
      ),
      { code: "browser-element-not-interactable" },
    );
    await assert.rejects(
      browser.handle(
        { type: "click", sessionId: "form", ref: ref(snapshot, "Covered action") },
        agent,
      ),
      { code: "browser-element-not-interactable" },
    );
    await browser.handle(
      { type: "fill", sessionId: "form", ref: ref(snapshot, "Name "), text: "" },
      agent,
    );
    await browser.handle(
      { type: "click", sessionId: "form", ref: ref(snapshot, "Save name") },
      agent,
    );
    snapshot = await observe();
    assert.equal(snapshot.nodes.find((node) => node.name === "Name ")?.value ?? "", "");
    const removed = ref(snapshot, "Remove me");
    await browser.handle({ type: "click", sessionId: "form", ref: removed }, agent);
    await assert.rejects(
      browser.handle({ type: "click", sessionId: "form", ref: removed }, agent),
      { code: "browser-element-stale" },
    );
    const next = ref(snapshot, "Next section");
    await browser.handle({ type: "click", sessionId: "form", ref: next }, agent);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await assert.rejects(browser.handle({ type: "click", sessionId: "form", ref: next }, agent), {
      code: "browser-element-stale",
    });
    snapshot = await observe();
    assert.ok(snapshot.session.url.endsWith("#next"));
    await browser.handle({ type: "attach", sessionId: "other", projectId: "other-project" });
    await assert.rejects(
      browser.handle(
        { type: "fill", sessionId: "other", ref: ref(snapshot, "Name "), text: "wrong tab" },
        agent,
      ),
      { code: "browser-element-stale" },
    );
    assert.deepEqual(
      (
        (await browser.handle(
          { type: "tabs.list", projectId: "project" },
          agent,
        )) as BrowserSessionState[]
      ).map((tab) => tab.id),
      ["form"],
    );
    await assert.rejects(
      browser.handle(
        { type: "cdp", sessionId: "form", method: "Runtime.evaluate", params: { expression: "1" } },
        agent,
      ),
      { code: "browser-permission-denied" },
    );
    await browser.handle({
      type: "settings.update",
      patch: {
        permissions: { navigate: "deny", history: "allow", download: "deny", upload: "deny" },
      },
    });
    await assert.rejects(observe(), { code: "browser-permission-denied" });
    await assert.rejects(
      browser.handle({ type: "click", sessionId: "form", ref: ref(snapshot, "Save name") }, agent),
      { code: "browser-permission-denied" },
    );
    await assert.rejects(
      browser.handle(
        { type: "fill", sessionId: "form", ref: ref(snapshot, "Name "), text: "denied" },
        agent,
      ),
      { code: "browser-permission-denied" },
    );
  } finally {
    browser.dispose();
    server.close();
    await new Promise((resolve) => setTimeout(resolve, 150));
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("browser imports preserve quoted passwords and reject unsafe or malformed data", () => {
  assert.deepEqual(
    parsePasswordCsv(
      'name,url,username,password,note\r\nExample,https://example.com,user,"a,b""c\nd",note\r\n',
    ),
    [
      {
        url: "https://example.com/",
        username: "user",
        password: 'a,b"c\nd',
        note: "note",
        useAccountStore: false,
      },
    ],
  );
  for (const csv of [
    "url,username,password\na,u,p",
    'url,username,password\nhttps://example.com,u,"unterminated',
    'url,username,password\nhttps://example.com,u,"p"tail',
    "url,username,password\nhttps://user:secret@example.com,u,p",
  ]) {
    assert.throws(() => parsePasswordCsv(csv), BrowserError);
  }
  const cookies = parseCookieJson(
    JSON.stringify([
      {
        domain: ".example.com",
        name: "sid",
        value: "value",
        secure: true,
        httpOnly: true,
        sameSite: "no_restriction",
        expirationDate: 1900000000,
      },
    ]),
  );
  assert.equal(cookies[0]?.url, "https://example.com/");
  assert.equal(cookies[0]?.sameSite, "None");
  assert.equal(cookies[0]?.httpOnly, true);
  for (const cookie of [
    { domain: "example.com", name: "bad\nname", value: "x" },
    { url: "file:///tmp/a", name: "x", value: "y" },
    { url: "https://one.test", domain: ".other.test", name: "x", value: "y" },
  ]) {
    assert.throws(() => parseCookieJson(JSON.stringify([cookie])), BrowserError);
  }
  assert.equal(normalizeBrowserUrl("localhost:3000"), "http://localhost:3000/");
  for (const url of [
    "file:///tmp/a",
    "javascript:alert(1)",
    "chrome://settings",
    "https://user:password@example.com",
  ])
    assert.throws(() => normalizeBrowserUrl(url), BrowserError);
});

test("browser settings persist atomically and agents cannot elevate their permissions", async () => {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "workbench-browser-settings-"));
  const manager = new BrowserManager({ stateDirectory });
  try {
    const defaults = await manager.handle({ type: "settings.get" });
    assert.equal((defaults as { fullCdpAccess: boolean }).fullCdpAccess, false);
    await assert.rejects(
      manager.handle(
        { type: "settings.update", patch: { fullCdpAccess: true } },
        { source: "agent" },
      ),
      { code: "browser-permission-denied" },
    );
    await assert.rejects(
      manager.handle({ type: "cookies.import", data: "[]" }, { source: "agent" }),
      { code: "browser-permission-denied" },
    );
    await manager.handle({
      type: "settings.update",
      patch: {
        showFullUrl: true,
        permissions: { navigate: "deny", history: "ask", download: "deny", upload: "ask" },
        sites: [{ origin: "https://example.com", permissions: { navigate: "allow" } }],
      },
    });
    const persisted = JSON.parse(
      await readFile(path.join(stateDirectory, "settings.json"), "utf8"),
    );
    assert.equal(persisted.showFullUrl, true);
    assert.equal(persisted.fullCdpAccess, false);
    const reopened = new BrowserManager({ stateDirectory });
    try {
      assert.deepEqual(await reopened.handle({ type: "settings.get" }), persisted);
    } finally {
      reopened.dispose();
    }
  } finally {
    manager.dispose();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("real Chrome keeps one target while navigating, streaming, finding, copying, emulating and exporting", async (t) => {
  try {
    await findBrowserExecutable();
  } catch {
    t.skip("Chrome is not installed");
    return;
  }
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "workbench-browser-engine-"));
  let downloadsRequested = 0;
  let blockedRequests = 0;
  const server = createServer((request, response) => {
    if (request.url?.includes("blocked-request")) blockedRequests++;
    if (request.url === "/download") {
      downloadsRequested++;
      response.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": "attachment; filename=fixture.txt",
      });
      response.end("download fixture");
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(
      '<!doctype html><title>Browser test</title><meta name="viewport" content="width=device-width"><h1>Searchable browser fixture</h1><input id="plain" value="copy me" style="position:absolute;left:100px;top:100px;width:100px;height:40px;background:rgb(255,0,0);border:0"><input id="secret" type="password" value="do not copy"><input type="file" id="upload"><div style="width:1000px">Wide content</div><a href="/download" id="download">Download</a><a href="/?popup" target="_blank" id="popup">Popup</a>',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/`;
  const manager = new BrowserManager({ stateDirectory });
  const events: BrowserEvent[] = [];
  manager.subscribe((event) => events.push(event));
  const waitFor = async (predicate: () => boolean) => {
    const until = Date.now() + 10000;
    while (!predicate() && Date.now() < until)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(predicate(), "browser event did not arrive");
  };
  try {
    await manager.handle({ type: "attach", sessionId: "tab", projectId: "project", url });
    await waitFor(() =>
      events.some(
        (event) =>
          event.type === "state" &&
          event.session.title === "Browser test" &&
          event.session.status === "ready",
      ),
    );
    await manager.handle({
      type: "viewport",
      sessionId: "tab",
      width: 600,
      height: 400,
      visible: true,
    });
    await waitFor(() => events.some((event) => event.type === "frame"));
    const frame = events.find(
      (event): event is Extract<BrowserEvent, { type: "frame" }> => event.type === "frame",
    )!;
    assert.ok(frame.width >= 600 && frame.height >= 400);
    assert.deepEqual(await manager.handle({ type: "find", sessionId: "tab", text: "Searchable" }), {
      found: true,
    });
    await assert.rejects(
      manager.handle({
        type: "cdp",
        sessionId: "tab",
        method: "Runtime.evaluate",
        params: { expression: "1" },
      }),
      { code: "browser-permission-denied" },
    );
    await manager.handle({ type: "settings.update", patch: { fullCdpAccess: true } });
    await manager.handle({
      type: "cdp",
      sessionId: "tab",
      method: "Runtime.evaluate",
      params: {
        expression:
          'document.modelContext.registerTool({name:"echo",description:"Echo fixture",inputSchema:{type:"object",properties:{text:{type:"string"}}},execute:async ({text})=>text})',
        awaitPromise: true,
      },
    });
    assert.deepEqual(await manager.handle({ type: "site-tools.list", sessionId: "tab" }), [
      {
        name: "echo",
        description: "Echo fixture",
        inputSchema: { type: "object", properties: { text: { type: "string" } } },
      },
    ]);
    assert.equal(
      await manager.handle({
        type: "site-tools.call",
        sessionId: "tab",
        name: "echo",
        arguments: { text: "site tool result" },
      }),
      "site tool result",
    );
    await manager.handle({ type: "settings.update", patch: { siteTools: false } });
    await assert.rejects(manager.handle({ type: "site-tools.list", sessionId: "tab" }), {
      code: "browser-permission-denied",
    });
    await manager.handle({
      type: "settings.update",
      patch: { sites: [{ origin: new URL(url).origin, siteTools: true }] },
    });
    assert.equal(
      ((await manager.handle({ type: "site-tools.list", sessionId: "tab" })) as unknown[]).length,
      1,
    );
    const evaluate = (expression: string) =>
      manager.handle({
        type: "cdp",
        sessionId: "tab",
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true, awaitPromise: true },
      }) as Promise<{ result: { value: any } }>;
    await evaluate(
      "document.querySelector('#plain').focus();document.querySelector('#plain').select()",
    );
    assert.deepEqual(await manager.handle({ type: "copy", sessionId: "tab" }), { text: "copy me" });
    await evaluate(
      "document.querySelector('#secret').focus();document.querySelector('#secret').select()",
    );
    assert.deepEqual(await manager.handle({ type: "copy", sessionId: "tab" }), { text: "" });
    await manager.handle({
      type: "viewport",
      sessionId: "tab",
      width: 600,
      height: 400,
      visible: true,
      zoom: 1.5,
      fitToWidth: false,
    });
    assert.equal((await evaluate("window.innerWidth")).result.value, 400);
    const click = async (x: number, y: number) => {
      await manager.handle({
        type: "input",
        sessionId: "tab",
        event: { kind: "mouse", type: "mousePressed", x, y, button: "left", clickCount: 1 },
      });
      await manager.handle({
        type: "input",
        sessionId: "tab",
        event: { kind: "mouse", type: "mouseReleased", x, y, button: "left", clickCount: 1 },
      });
    };
    const clickStreamInput = async (visibleFrame: Extract<BrowserEvent, { type: "frame" }>) => {
      const encoded = pngDimensions(visibleFrame.data);
      // Decode the actual stream in Chrome and click the colored input's bitmap center.
      const marker = (
        await evaluate(`(async () => {
        const image = new Image(); image.src = 'data:image/png;base64,${visibleFrame.data}';
        await image.decode(); const canvas = new OffscreenCanvas(image.width, image.height);
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
        const { data } = context.getImageData(0, 0, image.width, image.height);
        let left = image.width, top = image.height, right = 0, bottom = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] === 255 && data[i + 1] === 0 && data[i + 2] === 0) {
            const x = i / 4 % image.width, y = Math.floor(i / 4 / image.width);
            left = Math.min(left, x); right = Math.max(right, x);
            top = Math.min(top, y); bottom = Math.max(bottom, y);
          }
        }
        return { left, right, top, bottom };
      })()`)
      ).result.value;
      assert.ok(marker.right > marker.left && marker.bottom > marker.top);
      await click(
        ((marker.left + marker.right) / 2 / encoded.width) * visibleFrame.width,
        ((marker.top + marker.bottom) / 2 / encoded.height) * visibleFrame.height,
      );
      assert.equal(
        (await evaluate("document.activeElement.id")).result.value,
        "plain",
        JSON.stringify({ marker, encoded, width: visibleFrame.width, height: visibleFrame.height }),
      );
    };
    for (const config of [
      { zoom: 1, fitToWidth: false, deviceScaleFactor: 2 },
      { zoom: 1, fitToWidth: false, deviceScaleFactor: 3 },
      { zoom: 3, fitToWidth: false, deviceScaleFactor: 2 },
      { zoom: 1.5, fitToWidth: false, deviceScaleFactor: 2 },
      { zoom: 1, fitToWidth: true },
      { zoom: 1, fitToWidth: false, device: { width: 390, height: 844, mobile: true } },
    ]) {
      const start = events.length;
      await manager.handle({
        type: "viewport",
        sessionId: "tab",
        width: 600,
        height: 400,
        visible: true,
        ...config,
      });
      await evaluate("document.activeElement.blur()");
      await waitFor(() => events.slice(start).some((event) => event.type === "frame"));
      const visibleFrame = events.slice(start).findLast((event) => event.type === "frame")!;
      assert.equal(visibleFrame.mimeType, "image/png");
      const encoded = pngDimensions(visibleFrame.data);
      if (!config.fitToWidth && !config.device) {
        const expectedWidth = config.zoom === 3 ? 600 : 600 * config.deviceScaleFactor!;
        assert.ok(Math.abs(encoded.width - expectedWidth) <= 1, JSON.stringify(config));
        assert.ok(Math.abs(visibleFrame.width - 600 / config.zoom) < 1);
      }
      await clickStreamInput(visibleFrame);
      await manager.handle({
        type: "input",
        sessionId: "tab",
        event: { kind: "text", text: "typed" },
      });
      assert.match(
        (await evaluate("document.querySelector('#plain').value")).result.value,
        /typed/,
      );
      await waitFor(() => events.slice(start).some((event) => event.type === "frame"));
      if (config.fitToWidth) {
        assert.ok((await evaluate("window.innerWidth")).result.value >= 1000);
        const fitFrame = events.slice(start).findLast((event) => event.type === "frame");
        assert.equal(fitFrame?.type, "frame");
        if (fitFrame?.type === "frame") {
          const encoded = pngDimensions(fitFrame.data);
          assert.equal(
            encoded.width,
            1200,
            "fit stream must fill the panel width without double scaling",
          );
          assert.ok(
            Math.abs(encoded.width / encoded.height - fitFrame.width / fitFrame.height) < 0.01,
          );
        }
      }
    }
    await manager.handle({
      type: "viewport",
      sessionId: "tab",
      width: 600,
      height: 400,
      visible: true,
      device: null,
      zoom: 1,
      fitToWidth: true,
    });
    await evaluate(
      "document.body.style.height = '2000px'; document.querySelector('#plain').style.top = '600px'; document.activeElement.blur()",
    );
    const scrollStart = events.length;
    await evaluate(
      "scrollTo(0, 500); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    );
    await waitFor(() => events.slice(scrollStart).some((event) => event.type === "frame"));
    assert.equal((await evaluate("scrollY")).result.value, 500);
    await clickStreamInput(events.slice(scrollStart).findLast((event) => event.type === "frame")!);
    await evaluate(
      "scrollTo(0, 0); document.querySelector('#plain').style.top = '100px'; document.body.style.height = ''",
    );
    await evaluate(
      "window.originalRAF = requestAnimationFrame; window.requestAnimationFrame = () => 0",
    );
    try {
      const started = Date.now();
      await manager.handle({
        type: "viewport",
        sessionId: "tab",
        width: 600,
        height: 400,
        visible: true,
        fitToWidth: false,
      });
      assert.ok(
        Date.now() - started < 1500,
        "missing RAF callbacks must not block viewport updates",
      );
    } finally {
      await evaluate(
        "window.requestAnimationFrame = window.originalRAF; delete window.originalRAF",
      );
    }
    {
      const transport = (manager as unknown as { browser: BrowserCdp }).browser;
      const sent = mock.method(transport, "send");
      const first = manager.handle({
        type: "viewport",
        sessionId: "tab",
        width: 720,
        height: 400,
        visible: true,
      });
      await waitFor(() =>
        sent.mock.calls.some((call) => call.arguments[0] === "Page.stopScreencast"),
      );
      const requests = Array.from({ length: 24 }, (_, i) =>
        manager.handle({
          type: "viewport",
          sessionId: "tab",
          width: 700 - i,
          height: 400,
          visible: i % 2 === 0,
        }),
      );
      const final = manager.handle({
        type: "viewport",
        sessionId: "tab",
        width: 650,
        height: 450,
        visible: true,
        zoom: 1.5,
        device: { width: 480, height: 320, mobile: false },
      });
      await Promise.all([first, ...requests, final]);
      const state = (await final) as BrowserSessionState;
      assert.equal(state.width, 650);
      assert.equal(state.height, 450);
      assert.equal(state.zoom, 1.5);
      assert.deepEqual(state.device, { width: 480, height: 320, mobile: false });
      assert.equal((await evaluate("innerWidth")).result.value, 320);
      assert.equal((await evaluate("innerHeight")).result.value, 213);
      for (const method of ["Page.stopScreencast", "Page.startScreencast"]) {
        assert.ok(
          sent.mock.calls.filter((call) => call.arguments[0] === method).length <= 2,
          "resize bursts should apply only the running and latest viewport",
        );
      }
      sent.mock.restore();
    }
    await manager.handle({
      type: "viewport",
      sessionId: "tab",
      width: 600,
      height: 400,
      visible: true,
      zoom: 1,
      device: null,
    });
    const cookies = JSON.stringify([
      { url, name: "imported", value: "cookie-value", expirationDate: Date.now() / 1000 + 3600 },
    ]);
    assert.deepEqual(await manager.handle({ type: "cookies.import", data: cookies }), { count: 1 });
    assert.match((await evaluate("document.cookie")).result.value, /imported=cookie-value/);
    assert.deepEqual(
      await manager.handle({
        type: "passwords.import",
        data: `name,url,username,password\nFixture,${url},fixture-user,fixture-password`,
      }),
      { count: 1 },
    );
    const uploadEventStart = events.length;
    await manager.handle({
      type: "cdp",
      sessionId: "tab",
      method: "Runtime.evaluate",
      params: { expression: "document.querySelector('#upload').click()", userGesture: true },
    });
    await waitFor(() =>
      events.slice(uploadEventStart).some((event) => event.type === "file-chooser"),
    );
    const upload = events.slice(uploadEventStart).find((event) => event.type === "file-chooser")!;
    assert.equal(upload.type, "file-chooser");
    if (upload.type === "file-chooser")
      await manager.handle({
        type: "upload",
        sessionId: "tab",
        requestId: upload.requestId,
        files: [
          {
            name: "fixture.txt",
            mimeType: "text/plain",
            data: Buffer.from("uploaded fixture").toString("base64"),
          },
        ],
      });
    assert.equal(
      (await evaluate("document.querySelector('#upload').files[0].name")).result.value,
      "fixture.txt",
    );
    const screenshot = (await manager.handle({ type: "screenshot", sessionId: "tab" })) as {
      mimeType: string;
      data: string;
      viewport: { width: number; height: number };
      capture: { width: number; height: number };
    };
    assert.equal(screenshot.mimeType, "image/png");
    assert.equal(Buffer.from(screenshot.data, "base64").readUInt32BE(0), 0x89504e47);
    assert.deepEqual(screenshot.capture, screenshot.viewport);
    assert.equal(screenshot.viewport.width, (await evaluate("innerWidth")).result.value);
    assert.equal(screenshot.viewport.height, (await evaluate("innerHeight")).result.value);
    assert.deepEqual(pngDimensions(screenshot.data), {
      width: screenshot.viewport.width * 2,
      height: screenshot.viewport.height * 2,
    });
    const pdf = (await manager.handle({ type: "print", sessionId: "tab" })) as { data: string };
    assert.equal(Buffer.from(pdf.data, "base64").subarray(0, 4).toString(), "%PDF");
    await evaluate("document.querySelector('#download').click()");
    await waitFor(() =>
      events.some((event) => event.type === "download" && event.download.state === "completed"),
    );
    const downloads = (await manager.handle({ type: "downloads.list" })) as Array<{
      id: string;
      state: string;
    }>;
    const downloaded = (await manager.handle({
      type: "download.read",
      downloadId: downloads.find((download) => download.state === "completed")!.id,
    })) as { data: string };
    assert.equal(Buffer.from(downloaded.data, "base64").toString(), "download fixture");
    const reused = (await manager.handle({
      type: "attach",
      sessionId: "tab",
      projectId: "project",
    })) as BrowserSessionState;
    assert.equal(reused.url, url);
    await manager.handle({
      type: "cdp",
      sessionId: "tab",
      method: "Runtime.evaluate",
      params: { expression: "document.querySelector('#popup').click()", userGesture: true },
    });
    await waitFor(() =>
      events.some(
        (event) =>
          event.type === "state" &&
          event.session.url.endsWith("?popup") &&
          event.session.status === "ready",
      ),
    );
    await manager.handle({ type: "navigate", sessionId: "tab", url: `${url}?second` });
    await waitFor(() =>
      events.some(
        (event) =>
          event.type === "state" &&
          event.session.canGoBack &&
          event.session.url.endsWith("?second"),
      ),
    );
    await manager.handle({
      type: "settings.update",
      patch: {
        permissions: { navigate: "deny", history: "deny", download: "deny", upload: "deny" },
      },
    });
    await assert.rejects(
      manager.handle({ type: "navigate", sessionId: "tab", url }, { source: "agent" }),
      { code: "browser-permission-denied" },
    );
    await assert.rejects(manager.handle({ type: "back", sessionId: "tab" }, { source: "agent" }), {
      code: "browser-permission-denied",
    });
    await assert.rejects(
      manager.handle({ type: "screenshot", sessionId: "tab" }, { source: "agent" }),
      { code: "browser-permission-denied" },
    );
    await manager.handle({
      type: "settings.update",
      patch: {
        permissions: { navigate: "ask", history: "deny", download: "deny", upload: "deny" },
      },
    });
    const unsubscribe = manager.subscribe((event) => {
      if (event.type === "permission")
        void manager.handle({
          type: "permission.respond",
          requestId: event.requestId,
          allow: true,
        });
    });
    await manager.handle({ type: "navigate", sessionId: "tab", url }, { source: "agent" });
    unsubscribe();
    assert.ok(events.some((event) => event.type === "permission" && event.action === "navigate"));
    const controller = new AbortController();
    const permissionStart = events.length;
    const canceledNavigation = manager.handle(
      { type: "navigate", sessionId: "tab", url: `${url}?blocked-request` },
      { source: "agent", signal: controller.signal },
    );
    const rejectedNavigation = assert.rejects(canceledNavigation, {
      code: "browser-operation-failed",
    });
    await waitFor(() => events.slice(permissionStart).some((event) => event.type === "permission"));
    const canceledPermission = events
      .slice(permissionStart)
      .find((event) => event.type === "permission")!;
    controller.abort();
    await rejectedNavigation;
    if (canceledPermission.type === "permission")
      await assert.rejects(
        manager.handle({
          type: "permission.respond",
          requestId: canceledPermission.requestId,
          allow: true,
        }),
        { code: "browser-invalid" },
      );
    assert.equal(blockedRequests, 0, "canceled navigation must never reach the site");
    await manager.handle({
      type: "settings.update",
      patch: {
        permissions: { navigate: "allow", history: "deny", download: "deny", upload: "deny" },
      },
    });
    await assert.rejects(
      manager.handle(
        { type: "navigate", sessionId: "tab", url: `${url}download` },
        { source: "agent" },
      ),
      { code: "browser-permission-denied" },
    );
    await waitFor(() =>
      events.some(
        (event) => event.type === "state" && event.session.status === "permission-required",
      ),
    );
    assert.equal(downloadsRequested, 2);
    assert.equal(((await manager.handle({ type: "downloads.list" })) as unknown[]).length, 1);
    for (const page of [
      "settings",
      "history",
      "downloads",
      "passwords",
      "contacts",
      "site-settings",
      "clear-data",
      "download-settings",
      "import",
    ] as const) {
      await manager.handle({ type: "open-page", sessionId: "tab", page });
      await waitFor(() => events.at(-1)?.type !== "error");
      assert.equal((await evaluate("location.protocol")).result.value, "chrome:");
    }
    // Runtime.evaluate is intentionally explicit about awaiting private Chrome promises.
    const saved = (await manager.handle({
      type: "cdp",
      sessionId: "tab",
      method: "Runtime.evaluate",
      params: {
        expression:
          "chrome.passwordsPrivate.getSavedPasswordList().then(entries => entries.filter(entry => entry.username === 'fixture-user').length)",
        awaitPromise: true,
        returnByValue: true,
      },
    })) as { result: { value: number } };
    assert.equal(saved.result.value, 1);
    await assert.rejects(manager.handle({ type: "copy", sessionId: "tab" }, { source: "agent" }), {
      code: "browser-permission-denied",
    });
    await manager.handle({ type: "close", sessionId: "tab" });
    await manager.handle({ type: "close", sessionId: "tab" });
    await assert.rejects(manager.handle({ type: "downloads.clear" }, { source: "agent" }), {
      code: "browser-permission-denied",
    });
    assert.deepEqual(await manager.handle({ type: "downloads.clear" }), []);
    assert.deepEqual(await manager.handle({ type: "downloads.list" }), []);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(stateDirectory, "downloads.json"), "utf8")),
      [],
    );
    assert.equal(
      await readFile(path.join(stateDirectory, "downloads", downloads[0]!.id), "utf8"),
      "download fixture",
    );

    // Inject packets into this test's owned pipe to cover exact transport boundaries.
    const transport = (manager as unknown as { browser: BrowserCdp }).browser;
    const buffer = transport as unknown as { chunks: Buffer[]; bufferedBytes: number };
    const output = transport.process.stdio[4]!;
    await waitFor(() => buffer.bufferedBytes === 0);
    const received: string[] = [];
    transport.subscribe((event) => {
      if (event.method === "Test.fragment") received.push(event.params.text);
    });
    const packet = (text: string) =>
      Buffer.from(`${JSON.stringify({ method: "Test.fragment", params: { text } })}\0`);
    const first = packet("中文");
    const second = packet("second");
    const third = packet("third");
    const split = first.indexOf(Buffer.from("中")) + 1;
    output.emit("data", first.subarray(0, split));
    assert.deepEqual(received, []);
    output.emit("data", Buffer.concat([first.subarray(split), second, third.subarray(0, 17)]));
    assert.deepEqual(received, ["中文", "second"]);
    output.emit("data", third.subarray(17));
    assert.deepEqual(received, ["中文", "second", "third"]);
    assert.equal(buffer.bufferedBytes, 0);
    assert.equal(buffer.chunks.length, 0);

    const dispose = mock.method(transport, "dispose");
    const chunk = Buffer.alloc(1024 * 1024, 0x20);
    for (let i = 0; i < 96; i++) output.emit("data", chunk);
    assert.equal(dispose.mock.callCount(), 0);
    assert.equal(buffer.bufferedBytes, 96 * 1024 * 1024);
    const closed = once(transport.process, "exit");
    output.emit("data", Buffer.from("x"));
    assert.equal(dispose.mock.callCount(), 1);
    await closed;
    assert.equal(buffer.bufferedBytes, 0);
    assert.equal(buffer.chunks.length, 0);
  } finally {
    manager.dispose();
    server.close();
    await new Promise((resolve) => setTimeout(resolve, 150));
    await rm(stateDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
