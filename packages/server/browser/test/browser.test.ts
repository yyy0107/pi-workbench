import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { BrowserEvent, BrowserSessionState } from "@workbench/browser-contracts";

import { BrowserError, BrowserManager, normalizeBrowserUrl } from "../src/index";
import { findBrowserExecutable } from "../src/cdp";
import { parseCookieJson, parsePasswordCsv } from "../src/imports";

/** Read the JPEG's actual encoded dimensions, which can differ from CDP's CSS viewport. */
function jpegDimensions(data: string): { width: number; height: number } | undefined {
  const bytes = Buffer.from(data, "base64");
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let index = 2;
  while (index + 8 < bytes.length) {
    if (bytes[index] !== 0xff) return undefined;
    const marker = bytes[index + 1]!;
    if (marker === 0xff) {
      index++;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return undefined;
    const length = bytes.readUInt16BE(index + 2);
    if (length < 2) return undefined;
    if (
      [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
        marker,
      )
    ) {
      return { width: bytes.readUInt16BE(index + 7), height: bytes.readUInt16BE(index + 5) };
    }
    index += length + 2;
  }
  return undefined;
}

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
      '<!doctype html><title>Browser test</title><meta name="viewport" content="width=device-width"><h1>Searchable browser fixture</h1><input id="plain" value="copy me" style="position:absolute;left:100px;top:100px;width:100px;height:40px"><input id="secret" type="password" value="do not copy"><input type="file" id="upload"><div style="width:1000px">Wide content</div><a href="/download" id="download">Download</a><a href="/?popup" target="_blank" id="popup">Popup</a>',
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
        params: { expression, returnByValue: true },
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
    for (const config of [
      { zoom: 1.5, fitToWidth: false },
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
      await evaluate("document.querySelector('#secret').focus()");
      await click(120, 120);
      assert.equal(
        (await evaluate("document.activeElement.id")).result.value,
        "plain",
        JSON.stringify(config),
      );
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
          const encoded = jpegDimensions(fitFrame.data)!;
          assert.equal(
            encoded.width,
            600,
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
  } finally {
    manager.dispose();
    server.close();
    await new Promise((resolve) => setTimeout(resolve, 150));
    await rm(stateDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
