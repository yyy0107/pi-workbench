import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { mock } from "node:test";
import {
  BROWSER_CLICK_PREPARE_MS,
  parseBrowserCommand,
  type BrowserEvent,
  type BrowserPermission,
  type BrowserSessionState,
  type BrowserSnapshot,
} from "@workbench/browser-contracts";

import { BrowserError, BrowserManager, normalizeBrowserUrl } from "../src/index";
import { findBrowserExecutable, type BrowserCdp } from "../src/cdp";
import { parseCookieJson, parsePasswordCsv } from "../src/imports";

/** Exported PNG screenshots retain their full bitmap density. */
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
  for (const allow of [false, true])
    assert.ok(parseBrowserCommand({ type: "permission.respond", requestId: "id", allow }));
  assert.equal(
    parseBrowserCommand({ type: "permission.respond", requestId: "id", allow: "true" }),
    undefined,
  );
  for (const patch of [
    { permissions: { navigate: "allow" } },
    { sites: [{ origin: "https://example.com", permissions: { navigate: "deny" } }] },
  ])
    assert.equal(parseBrowserCommand({ type: "settings.update", patch }), undefined);
});

test("assistant control keeps CSS cursors across tools and releases on takeover or cancellation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const directory = await mkdtemp(path.join(tmpdir(), "workbench-browser-control-"));
  const manager = new BrowserManager({ stateDirectory: directory });
  const engine = manager as unknown as {
    tabs: Map<
      string,
      {
        state: BrowserSessionState;
        source: string;
        cdpSessionId: string;
        agentControl?: { signal: AbortSignal };
      }
    >;
    connectTab(tab: { cdpSessionId: string }): Promise<void>;
    send(): Promise<Record<string, unknown>>;
    capture(): Promise<object>;
    update(tab: object, patch: Partial<BrowserSessionState>): void;
  };
  t.mock.method(engine, "connectTab", async (tab: { cdpSessionId: string }) => {
    tab.cdpSessionId = "test-session";
  });
  t.mock.method(engine, "send", async () => ({}));
  t.mock.method(engine, "capture", async () => ({}));
  const events: BrowserEvent[] = [];
  manager.subscribe((event) => events.push(event));
  const run = new AbortController();
  const agent = { source: "agent" as const, controlSignal: run.signal };
  const move = (options = agent) =>
    manager.handle(
      {
        type: "input",
        sessionId: "tab",
        event: { kind: "mouse", type: "mouseMoved", x: 127.5, y: 64.25 },
      },
      options,
    );
  try {
    await manager.handle({
      type: "settings.update",
      patch: {
        fullCdpAccess: true,
        permissions: { history: "allow", download: "deny", upload: "deny" },
      },
    });
    const attached = (await manager.handle(
      { type: "attach", sessionId: "tab", projectId: "project" },
      agent,
    )) as BrowserSessionState;
    const tab = engine.tabs.get("tab")!;
    assert.equal(attached.agentControlled, true);
    const revision = tab.state.revision;
    await move();
    assert.equal(tab.state.revision, revision);
    assert.deepEqual(events.at(-1), {
      type: "cursor",
      sessionId: "tab",
      cursor: { x: 127.5, y: 64.25, pressed: false },
    });
    assert.deepEqual(
      (
        (await manager.handle({
          type: "attach",
          sessionId: "tab",
          projectId: "project",
        })) as BrowserSessionState
      ).agentCursor,
      tab.state.agentCursor,
    );
    await manager.handle(
      { type: "attach", sessionId: "tab", projectId: "project" },
      { source: "agent" },
    );
    assert.equal(tab.state.agentControlled, true);
    assert.equal(tab.state.agentCursor?.x, 127.5);
    assert.equal(tab.agentControl?.signal, run.signal);
    assert.equal(
      tab.state.revision,
      revision,
      "Observer attachment must not replace the active control owner",
    );
    const nextOwner = new AbortController();
    const nextAgent = { ...agent, controlSignal: nextOwner.signal };
    await manager.handle({ type: "screenshot", sessionId: "tab" }, nextAgent);
    run.abort();
    assert.equal(tab.state.agentControlled, true);
    assert.equal(tab.state.revision, revision);
    assert.equal(tab.state.agentCursor?.x, 127.5);
    await manager.handle({
      type: "viewport",
      sessionId: "tab",
      width: 1024,
      height: 768,
      visible: false,
    });
    await manager.handle({
      type: "input",
      sessionId: "tab",
      event: { kind: "mouse", type: "mouseMoved", x: 1, y: 2 },
    });
    assert.equal(tab.state.agentCursor, undefined);
    assert.equal(tab.state.userControlled, true);
    assert.deepEqual(tab.state.userCursor, { x: 1, y: 2, pressed: false });
    await assert.rejects(move(nextAgent), { code: "browser-user-active" });
    await manager.handle({ type: "screenshot", sessionId: "tab" }, nextAgent);
    assert.equal(tab.state.agentControlled, false, "Observation must not reclaim a user's tab");
    const userRevision = tab.state.revision;
    t.mock.timers.tick(1000);
    await manager.handle({
      type: "input",
      sessionId: "tab",
      event: { kind: "mouse", type: "mouseMoved", x: 3, y: 4 },
    });
    assert.equal(tab.state.revision, userRevision, "Pointer movement must not flood state events");
    const listed = (await manager.handle({
      type: "tabs.list",
      projectId: "project",
    })) as BrowserSessionState[];
    assert.deepEqual(listed[0]?.userCursor, { x: 3, y: 4, pressed: false });
    t.mock.timers.tick(1000);
    await assert.rejects(move(nextAgent), { code: "browser-user-active" });
    t.mock.timers.tick(500);
    assert.equal(tab.state.userControlled, false);
    await manager.handle(
      {
        type: "cdp",
        sessionId: "tab",
        method: "Input.dispatchMouseEvent",
        params: { type: "mousePressed", x: 12, y: 16 },
      },
      nextAgent,
    );
    assert.deepEqual(tab.state.agentCursor, { x: 12, y: 16, pressed: true });
    await manager.handle(
      {
        type: "cdp",
        sessionId: "tab",
        method: "Input.dispatchMouseEvent",
        params: { type: "mouseMoved", x: -1, y: 16 },
      },
      nextAgent,
    );
    assert.deepEqual(tab.state.agentCursor, { x: 12, y: 16, pressed: true });
    await manager.handle(
      { type: "attach", sessionId: "tab", projectId: "project" },
      { source: "agent" },
    );
    assert.equal(tab.agentControl?.signal, nextOwner.signal);
    nextOwner.abort();
    assert.equal(tab.state.agentControlled, false);
    assert.equal(tab.state.agentCursor, undefined);
    assert.equal(
      tab.source,
      "agent",
      "Control release must preserve navigation permission provenance",
    );

    const active = { ...agent, controlSignal: new AbortController().signal };
    await move(active);
    await manager.handle({
      type: "input",
      sessionId: "tab",
      event: { kind: "mouse", type: "mousePressed", button: "left", x: 1, y: 2 },
    });
    assert.equal(tab.state.agentControlled, false);
    assert.equal(tab.state.agentCursor, undefined);
    await assert.rejects(move(active), { code: "browser-user-active" });
    assert.equal(active.controlSignal.aborted, false);
    t.mock.timers.tick(1500);
    await move(active);
    await manager.handle({ type: "reload", sessionId: "tab" }, active);
    assert.equal(tab.state.agentControlled, true);
    assert.equal(tab.state.agentCursor, undefined);
    await move(active);
    await manager.handle({
      type: "viewport",
      sessionId: "tab",
      width: 800,
      height: 600,
      visible: false,
    });
    assert.equal(tab.state.agentControlled, true);
    assert.equal(tab.state.agentCursor, undefined);

    for (const mobile of [true, false]) {
      const viewport = {
        type: "viewport" as const,
        sessionId: "tab",
        width: 800,
        height: 600,
        visible: false,
        device: { width: 800, height: 600, mobile },
      };
      await move(active);
      await manager.handle(viewport);
      assert.equal(tab.state.agentControlled, true);
      assert.equal(tab.state.agentCursor, undefined);
      await move(active);
      await manager.handle(viewport);
      assert.equal(tab.state.agentControlled, true);
      assert.deepEqual(tab.state.agentCursor, { x: 127.5, y: 64.25, pressed: false });
    }

    const cancellation = new AbortController();
    let release!: () => void;
    let started!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sending = new Promise<void>((resolve) => {
      started = resolve;
    });
    const delayed = t.mock.method(engine, "send", async () => {
      started();
      await pending;
      return {};
    });
    const operation = manager.handle(
      {
        type: "input",
        sessionId: "tab",
        event: { kind: "mouse", type: "mouseMoved", x: 10, y: 20 },
      },
      { ...active, signal: cancellation.signal },
    );
    await sending;
    cancellation.abort();
    assert.equal(
      tab.state.agentControlled,
      false,
      "Abort clears control before a pending CDP call finishes",
    );
    assert.equal(tab.state.agentCursor, undefined);
    release();
    await operation;
    delayed.mock.restore();
    await manager.handle({ type: "screenshot", sessionId: "tab" }, { source: "agent" });
    assert.equal(
      tab.state.agentControlled,
      false,
      "Hosts without a run signal release after their tool finishes",
    );
    const failedCapture = t.mock.method(engine, "capture", async () => {
      throw new BrowserError(
        "browser-operation-failed",
        "CDP Page.captureScreenshot timed out after 30000 ms.",
      );
    });
    await assert.rejects(manager.handle({ type: "screenshot", sessionId: "tab" }, active), {
      code: "browser-operation-failed",
    });
    assert.equal(
      tab.state.status,
      "error",
      "agent screenshot failures expose the workspace retry UI",
    );
    failedCapture.mock.restore();
    await move(active);
    engine.update(tab, { status: "disconnected" });
    assert.equal(tab.state.agentControlled, false);
    assert.equal(tab.state.agentCursor, undefined);
    await move(active);
    await manager.handle({ type: "close", sessionId: "tab" });
    assert.equal(tab.state.agentControlled, false);
    assert.equal(tab.state.agentCursor, undefined);
    assert.equal(engine.tabs.size, 0);
  } finally {
    manager.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("popup URLs cannot survive the document that requested them", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "workbench-browser-popup-"));
  const manager = new BrowserManager({ stateDirectory: directory });
  const engine = manager as unknown as {
    tabs: Map<string, { cdpSessionId: string; targetId: string }>;
    connectTab(
      tab: { cdpSessionId: string; targetId: string },
      target?: { sessionId: string; targetId: string },
    ): Promise<void>;
    send(): Promise<object>;
    history(): Promise<void>;
    navigate(tab: unknown, url: string): Promise<void>;
    onEvent(event: { method: string; sessionId?: string; params: object }): Promise<void>;
  };
  t.mock.method(
    engine,
    "connectTab",
    async (
      tab: { cdpSessionId: string; targetId: string },
      target?: { sessionId: string; targetId: string },
    ) => {
      tab.cdpSessionId = target?.sessionId ?? "cdp";
      tab.targetId = target?.targetId ?? "target";
    },
  );
  t.mock.method(engine, "send", async () => ({}));
  t.mock.method(engine, "history", async () => {});
  const navigate = t.mock.method(engine, "navigate", async () => {});
  const events: BrowserEvent[] = [];
  manager.subscribe((event) => events.push(event));
  try {
    await manager.handle(
      { type: "attach", sessionId: "tab", projectId: "project" },
      { source: "agent" },
    );
    await engine.onEvent({
      method: "Page.windowOpen",
      sessionId: "cdp",
      params: { url: "file:///stale-preload" },
    });
    await engine.onEvent({
      method: "Page.frameNavigated",
      sessionId: "cdp",
      params: { frame: { id: "main", url: "https://example.test/new-document" } },
    });
    await engine.onEvent({
      method: "Page.windowOpen",
      sessionId: "cdp",
      params: { url: "https://example.test/current" },
    });
    await engine.onEvent({
      method: "Target.attachedToTarget",
      params: {
        targetInfo: { type: "page", targetId: "popup", openerId: "target", url: "" },
        sessionId: "popup-cdp",
        waitingForDebugger: true,
      },
    });
    assert.equal(navigate.mock.callCount(), 0, "native popups must not replace their opener");
    const popup = events.find((event) => event.type === "popup");
    assert.ok(popup && popup.type === "popup");
    assert.equal(popup.openerSessionId, "tab");
    assert.equal(engine.tabs.get(popup.session.id)?.targetId, "popup");
    await engine.onEvent({
      method: "Page.windowOpen",
      sessionId: "cdp",
      params: { url: "file:///blocked" },
    });
    await assert.rejects(
      engine.onEvent({
        method: "Target.attachedToTarget",
        params: {
          targetInfo: { type: "page", targetId: "unsafe-popup", openerId: "target", url: "" },
          sessionId: "unsafe-popup-cdp",
          waitingForDebugger: true,
        },
      }),
      { code: "browser-invalid" },
    );
    assert.equal(engine.tabs.size, 2);
    const attachments = await Promise.allSettled(
      Array.from({ length: 32 }, (_, index) =>
        manager.handle({ type: "attach", sessionId: `limit-${index}`, projectId: "project" }),
      ),
    );
    assert.equal(attachments.filter((result) => result.status === "fulfilled").length, 30);
    assert.equal(engine.tabs.size, 32, "concurrent tabs must respect the shared limit");
  } finally {
    manager.dispose();
    await rm(directory, { recursive: true, force: true });
  }
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
      '<!doctype html><title>Observed form</title><label>Name <input id="name" value="old"></label><label>Password <input id="type" type="password" value="private-secret"></label><label>Redirecting input <input onkeydown="document.querySelector(\'#name\').focus()"></label><button onclick="document.querySelector(\'#result\').textContent = document.querySelector(\'#name\').value">Save name</button><p id="result" role="status">Not saved</p><button onclick="this.remove()">Remove me</button><button disabled>Disabled action</button><a href="#next">Next section</a><div style="position:relative;width:150px;height:40px"><button>Covered action</button><div style="position:absolute;inset:0;background:gray"></div></div><iframe title="Embedded form" srcdoc="<button>Frame action</button>"></iframe>' +
        '<div style="position:relative;width:150px;height:40px"><a href="#" style="display:block;width:150px;height:40px" onclick="event.preventDefault();document.querySelector(\'#result\').textContent=\'Partial clicked\'">Partial action</a><div style="position:absolute;left:50px;top:0;width:50px;height:40px;background:gray"></div></div>' +
        '<div style="position:relative;width:150px"><a href="#" aria-label="Wrapped action" onclick="event.preventDefault();document.querySelector(\'#result\').textContent=\'Wrapped clicked\'">First line<br>Second line</a><div style="position:absolute;left:0;top:0;width:150px;height:19px;background:gray"></div></div>' +
        '<a href="#" style="display:contents" onclick="event.preventDefault();document.querySelector(\'#result\').textContent=\'Contents clicked\'"><span>Contents action</span></a><a href="#" style="display:contents"><span style="opacity:0">Invisible contents</span></a><label>Read-only <input readonly value="unchanged"></label>' +
        "<div style=\"height:1000px\"></div><button onclick=\"document.querySelector('#result').textContent='Scrolled clicked'\">Scrolled action</button>",
    ),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = "http://127.0.0.1:" + address.port + "/";
  const browser = new BrowserManager({ stateDirectory: directory });
  const control = new AbortController();
  const agent = { source: "agent" as const, controlSignal: control.signal };
  const cursors: Extract<BrowserEvent, { type: "cursor" }>[] = [];
  browser.subscribe((event) => {
    if (event.type === "cursor") cursors.push(event);
  });
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
        permissions: { history: "allow", download: "deny", upload: "deny" },
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
    assert.ok(snapshot.nodes.some((node) => node.name === "Frame action" && node.ref));
    const name = ref(snapshot, "Name ");
    // Native setters target the observed element even if its keyboard handler redirects focus.
    await browser.handle(
      {
        type: "fill",
        sessionId: "form",
        ref: ref(snapshot, "Redirecting input "),
        text: "Correct input",
      },
      agent,
    );
    await browser.handle(
      { type: "fill", sessionId: "form", ref: name, text: "Native form input" },
      agent,
    );
    const engine = browser as unknown as {
      browser: BrowserCdp;
      tabs: Map<string, { cdpSessionId: string }>;
    };
    const position = await engine.browser.send(
      "Runtime.evaluate",
      {
        expression:
          "(() => { const rect = document.querySelector('#name').getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })()",
        returnByValue: true,
      },
      engine.tabs.get("form")!.cdpSessionId,
    );
    assert.deepEqual(cursors.at(-1)?.cursor, { ...position.result.value, pressed: false });
    const sent = t.mock.method(engine.browser, "send");
    await browser.handle(
      { type: "click", sessionId: "form", ref: ref(snapshot, "Save name") },
      agent,
    );
    const mouse = sent.mock.calls.filter(
      (call) => call.arguments[0] === "Input.dispatchMouseEvent",
    );
    const released = mouse.at(-1)?.arguments[1];
    assert.ok(released && typeof released.x === "number" && typeof released.y === "number");
    assert.deepEqual(cursors.at(-1)?.cursor, { x: released.x, y: released.y, pressed: false });
    assert.deepEqual(cursors.at(-2)?.cursor, { x: released.x, y: released.y, pressed: true });
    assert.ok(
      released.x < 800 && released.y < 600,
      "Cursor uses CSS viewport coordinates despite 2x screencast density",
    );
    sent.mock.restore();
    snapshot = await observe();
    assert.ok(snapshot.nodes.some((node) => node.name === "Native form input"));
    assert.equal(ref(snapshot, "Name "), name, "Refs survive repeated snapshots within a document");
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
      { code: "browser-element-not-interactable", message: /covered/ },
    );
    await assert.rejects(
      browser.handle(
        { type: "click", sessionId: "form", ref: ref(snapshot, "Invisible contents") },
        agent,
      ),
      { code: "browser-element-not-interactable", message: /no visible content/ },
    );
    await assert.rejects(
      browser.handle(
        { type: "fill", sessionId: "form", ref: ref(snapshot, "Read-only "), text: "wrong" },
        agent,
      ),
      { code: "browser-element-not-interactable", message: /not a writable/ },
    );
    for (const [name, expected] of [
      ["Partial action", "Partial clicked"],
      ["Wrapped action", "Wrapped clicked"],
      ["Contents action", "Contents clicked"],
    ]) {
      await browser.handle({ type: "click", sessionId: "form", ref: ref(snapshot, name!) }, agent);
      snapshot = await observe();
      assert.ok(snapshot.nodes.some((node) => node.name === expected));
    }
    await browser.handle({
      type: "viewport",
      sessionId: "form",
      width: 800,
      height: 600,
      visible: true,
      zoom: 1.5,
    });
    await browser.handle(
      { type: "click", sessionId: "form", ref: ref(snapshot, "Scrolled action") },
      agent,
    );
    const scroll = await engine.browser.send(
      "Runtime.evaluate",
      { expression: "window.scrollY", returnByValue: true },
      engine.tabs.get("form")!.cdpSessionId,
    );
    assert.ok(
      scroll.result.value > 500,
      "Hit testing must account for actual root document scrolling",
    );
    snapshot = await observe();
    assert.ok(snapshot.nodes.some((node) => node.name === "Scrolled clicked"));
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
    await browser.handle({ type: "click", sessionId: "form", ref: next }, agent);
    snapshot = await observe();
    assert.ok(snapshot.session.url.endsWith("#next"));
    await browser.handle({ type: "attach", sessionId: "other", projectId: "other-project" });
    assert.equal(
      (
        await engine.browser.send(
          "Runtime.evaluate",
          { expression: "document.visibilityState", returnByValue: true },
          engine.tabs.get("form")!.cdpSessionId,
        )
      ).result.value,
      "visible",
      "Creating an unrevealed tab must not throttle input on the visible page",
    );
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
      [],
      "Agent discovery without a conversation ID must fail closed",
    );
    assert.deepEqual(
      (
        (await browser.handle({ type: "tabs.list", projectId: "project" })) as BrowserSessionState[]
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
        permissions: { history: "allow", download: "deny", upload: "deny" },
      },
    });
    snapshot = await observe();
    await browser.handle(
      {
        type: "fill",
        sessionId: "form",
        ref: ref(snapshot, "Name "),
        text: "No navigation permission",
      },
      agent,
    );
    await browser.handle(
      { type: "click", sessionId: "form", ref: ref(snapshot, "Save name") },
      agent,
    );
    snapshot = await observe();
    assert.ok(snapshot.nodes.some((node) => node.name === "No navigation permission"));
  } finally {
    control.abort();
    browser.dispose();
    server.close();
    await new Promise((resolve) => setTimeout(resolve, 150));
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("real Chrome moves the assistant pointer before acting and stops on cancellation or takeover", async (t) => {
  try {
    await findBrowserExecutable();
  } catch {
    t.skip("Chrome is not installed");
    return;
  }
  const directory = await mkdtemp(path.join(tmpdir(), "workbench-browser-movement-"));
  const server = createServer((_request, response) =>
    response.end(`<!doctype html>
    <input aria-label="Name" id="name" style="position:absolute;left:120px;top:60px">
    <button id="save" style="position:absolute;left:450px;top:300px" onclick="window.clicks++">Save</button>
    <button id="hover" style="position:absolute;left:520px;top:140px" onpointerover="document.querySelector('#cover').hidden=false" onclick="window.clicks++">Hover covered</button>
    <div id="cover" hidden style="position:absolute;left:515px;top:135px;width:150px;height:50px;background:gray"></div>
    <script>window.pointerLog=[];window.clicks=0;for(const type of ['pointermove','pointerover','pointerdown','pointerup','keydown','keyup','click','focusin'])document.addEventListener(type,event=>pointerLog.push({type,x:event.clientX,y:event.clientY,target:event.target.id,at:performance.now()}),true)</script>`),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const browser = new BrowserManager({ stateDirectory: directory });
  const run = new AbortController();
  const agent = { source: "agent" as const, controlSignal: run.signal };
  const cursors: Extract<BrowserEvent, { type: "cursor" }>[] = [];
  browser.subscribe((event) => {
    if (event.type === "cursor") cursors.push(event);
  });
  const observe = () =>
    browser.handle({ type: "snapshot", sessionId: "movement" }, agent) as Promise<BrowserSnapshot>;
  const ref = (snapshot: BrowserSnapshot, name: string) => {
    const target = snapshot.nodes.find((node) => node.name === name && node.ref);
    assert.ok(target?.ref);
    return target.ref;
  };
  try {
    await browser.handle({
      type: "settings.update",
      patch: {
        fullCdpAccess: true,
        permissions: { history: "allow", download: "deny", upload: "deny" },
      },
    });
    await browser.handle(
      {
        type: "attach",
        sessionId: "movement",
        projectId: "project",
        url: "http://127.0.0.1:" + address.port,
      },
      agent,
    );
    const engine = browser as unknown as {
      browser: BrowserCdp;
      tabs: Map<string, { cdpSessionId: string }>;
    };
    const evaluate = async (expression: string) =>
      (
        await engine.browser.send(
          "Runtime.evaluate",
          { expression, returnByValue: true },
          engine.tabs.get("movement")!.cdpSessionId,
        )
      ).result.value;
    const reset = async () => {
      await evaluate("window.pointerLog=[];window.clicks=0");
      cursors.length = 0;
    };
    const log = async () =>
      (await evaluate("window.pointerLog")) as {
        type: string;
        x?: number;
        y?: number;
        target: string;
        at: number;
      }[];
    const checkMovement = (
      events: Awaited<ReturnType<typeof log>>,
      after: string | undefined,
      start: { x: number; y: number },
    ) => {
      const moved = events.filter((event) => event.type === "pointermove");
      assert.ok(
        moved.length >= 12 && moved.length <= 45,
        "Actions must dispatch a dense, paced path from the last actual mouse position",
      );
      assert.ok(
        moved.at(-1)!.at - moved[0]!.at >= 80,
        "Movement must be observable over time, not emitted in one burst",
      );
      const distances = moved.map((event, index) => {
        const previous = moved[index - 1] ?? start;
        return Math.hypot(event.x! - previous.x!, event.y! - previous.y!);
      });
      assert.ok(distances[0]! < Math.max(...distances) / 4, "Movement accelerates gently");
      assert.ok(
        distances.at(-1)! < Math.max(...distances) / 4,
        "Movement slows before reaching the target",
      );
      for (let index = 0; index < moved.length; index++) {
        const cursor = cursors[index]?.cursor;
        assert.ok(cursor);
        assert.ok(Math.abs(cursor.x - moved[index]!.x!) < 1);
        assert.ok(Math.abs(cursor.y - moved[index]!.y!) < 1);
        assert.equal(cursor.pressed, false);
      }
      if (after)
        assert.ok(
          events.findIndex((event) => event.type === after) >
            events.findLastIndex((event) => event.type === "pointermove"),
        );
    };
    let snapshot = await observe();
    await browser.handle({
      type: "input",
      sessionId: "movement",
      event: { kind: "mouse", type: "mouseMoved", x: 12, y: 12 },
    });
    assert.equal(
      (await log()).filter((event) => event.type === "pointermove").length,
      1,
      "Raw user input must stay a single native event",
    );
    const activeSnapshot = await observe();
    assert.equal(activeSnapshot.session.userControlled, true);
    assert.deepEqual(activeSnapshot.session.userCursor, { x: 12, y: 12, pressed: false });
    await assert.rejects(
      browser.handle(
        {
          type: "fill",
          sessionId: "movement",
          ref: ref(activeSnapshot, "Name"),
          text: "Must yield",
        },
        agent,
      ),
      { code: "browser-user-active" },
    );
    await new Promise((resolve) => setTimeout(resolve, 1550));
    snapshot = await observe();
    assert.equal(snapshot.session.userControlled, false);
    await browser.handle(
      {
        type: "input",
        sessionId: "movement",
        event: { kind: "mouse", type: "mouseWheel", x: 470, y: 310, deltaX: 0, deltaY: 1 },
      },
      agent,
    );
    assert.equal(await evaluate("document.querySelector('#save').matches(':hover')"), false);
    assert.equal(cursors.length, 0, "Wheel coordinates must not invent a new pointer position");
    await reset();
    await browser.handle(
      { type: "fill", sessionId: "movement", ref: ref(snapshot, "Name"), text: "Native movement" },
      agent,
    );
    checkMovement(await log(), "focusin", { x: 12, y: 12 });
    assert.equal(await evaluate("document.querySelector('#name').value"), "Native movement");
    assert.equal(
      (await log()).some((event) => event.type === "pointerdown"),
      false,
      "Fill must not add a synthetic click",
    );
    const fieldPosition = cursors.at(-1)!.cursor!;
    await reset();
    await browser.handle(
      {
        type: "cdp",
        sessionId: "movement",
        method: "Input.dispatchMouseEvent",
        params: { type: "mouseMoved", x: 20, y: 20 },
      },
      agent,
    );
    checkMovement(await log(), undefined, fieldPosition);
    await reset();
    await browser.handle(
      { type: "click", sessionId: "movement", ref: ref(snapshot, "Save") },
      agent,
    );
    const clicked = await log();
    checkMovement(clicked, "pointerdown", { x: 20, y: 20 });
    const prepared = cursors.filter((event) => event.cursor?.preparingClick);
    assert.equal(prepared.length, 1, "the click exposes one preparation phase at the target");
    assert.deepEqual(prepared[0]!.cursor, {
      ...cursors.at(-1)!.cursor,
      preparingClick: true,
    });
    assert.ok(
      clicked.find((event) => event.type === "pointerdown")!.at -
        clicked.findLast((event) => event.type === "pointermove")!.at >=
        BROWSER_CLICK_PREPARE_MS - 20,
      "the native press waits for the visible sway without moving the hotspot",
    );
    assert.ok(
      clicked.findIndex((event) => event.type === "pointerover" && event.target === "save") <
        clicked.findIndex((event) => event.type === "pointerdown"),
    );
    assert.equal(await evaluate("window.clicks"), 1);

    for (const interrupted of ["cancel", "cover"] as const) {
      await reset();
      const cancellation = new AbortController();
      let covered: Promise<unknown> | undefined;
      const unsubscribe = browser.subscribe((event) => {
        if (event.type !== "cursor" || !event.cursor?.preparingClick) return;
        if (interrupted === "cancel") cancellation.abort();
        else
          covered = evaluate(`(() => {
            const cover = document.createElement('div');
            cover.id = 'late-cover';
            cover.style = 'position:fixed;inset:0;z-index:99';
            document.body.append(cover);
          })()`);
      });
      try {
        await assert.rejects(
          browser.handle(
            { type: "click", sessionId: "movement", ref: ref(snapshot, "Save") },
            { ...agent, signal: cancellation.signal },
          ),
          {
            code:
              interrupted === "cancel"
                ? "browser-operation-failed"
                : "browser-element-not-interactable",
          },
        );
        await covered;
        assert.equal(await evaluate("window.clicks"), 0);
        assert.equal(
          (await log()).some((event) => event.type === "pointerdown"),
          false,
        );
        assert.ok(
          !cursors.at(-1)?.cursor?.preparingClick,
          "interruption clears the preparation phase",
        );
      } finally {
        unsubscribe();
        await evaluate("document.querySelector('#late-cover')?.remove()");
      }
    }

    for (const takeover of [false, true]) {
      await browser.handle(
        {
          type: "input",
          sessionId: "movement",
          event: { kind: "mouse", type: "mouseMoved", x: 12, y: 12 },
        },
        agent,
      );
      snapshot = await observe();
      await reset();
      const cancellation = new AbortController();
      let observedMoves = 0;
      let userInput: Promise<void> | undefined;
      const unsubscribe = browser.subscribe((event) => {
        if (event.type !== "cursor" || !event.cursor || ++observedMoves !== 2) return;
        if (!takeover) cancellation.abort();
        else
          userInput = (async () => {
            for (const type of ["mousePressed", "mouseReleased"] as const)
              await browser.handle({
                type: "input",
                sessionId: "movement",
                event: { kind: "mouse", type, button: "left", x: 5, y: 5 },
              });
          })();
      });
      try {
        await assert.rejects(
          browser.handle(
            { type: "click", sessionId: "movement", ref: ref(snapshot, "Save") },
            { ...agent, signal: cancellation.signal },
          ),
          { code: takeover ? "browser-user-active" : "browser-operation-failed" },
        );
        await userInput;
        assert.equal(
          observedMoves,
          2,
          "No assistant moves may follow cancellation or user takeover",
        );
        assert.equal(
          await evaluate("window.clicks"),
          0,
          "An interrupted movement must never complete the click",
        );
        assert.equal(
          (await log()).some((event) => event.type === "pointerdown" && event.target === "save"),
          false,
        );
      } finally {
        unsubscribe();
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1550));
    snapshot = await observe();
    await reset();
    await assert.rejects(
      browser.handle(
        { type: "click", sessionId: "movement", ref: ref(snapshot, "Hover covered") },
        agent,
      ),
      { code: "browser-element-not-interactable", message: /Hovering changed or covered/ },
    );
    assert.equal(
      await evaluate("window.clicks"),
      0,
      "Hover-triggered covering UI must prevent the final click",
    );

    // A hung agent CDP reply must not hold the tool open or block the user's inputs.
    await browser.handle(
      {
        type: "input",
        sessionId: "movement",
        event: {
          kind: "key",
          type: "keyDown",
          key: "Shift",
          code: "ShiftLeft",
          windowsVirtualKeyCode: 16,
        },
      },
      agent,
    );
    await browser.handle(
      {
        type: "input",
        sessionId: "movement",
        event: { kind: "mouse", type: "mousePressed", button: "left", x: 12, y: 12 },
      },
      agent,
    );
    await reset();
    let started!: () => void;
    const sending = new Promise<void>((resolve) => {
      started = resolve;
    });
    const send = engine.browser.send.bind(engine.browser);
    const watched = t.mock.method(
      engine.browser,
      "send",
      (...args: Parameters<BrowserCdp["send"]>) => {
        const result = send(...args);
        if (args[1]?.expression === "new Promise(() => {})") started();
        return result;
      },
    );
    const yielded = assert.rejects(
      browser.handle(
        {
          type: "cdp",
          sessionId: "movement",
          method: "Runtime.evaluate",
          params: { expression: "new Promise(() => {})", awaitPromise: true },
        },
        { ...agent, signal: AbortSignal.timeout(2000) },
      ),
      { code: "browser-user-active" },
    );
    await sending;
    await browser.handle({
      type: "input",
      sessionId: "movement",
      event: { kind: "mouse", type: "mouseMoved", x: 20, y: 20 },
    });
    await yielded;
    watched.mock.restore();
    assert.equal(
      run.signal.aborted,
      false,
      "Only the conflicting action yields, not the agent run",
    );
    const takeoverEvents = await log();
    assert.ok(takeoverEvents.some((event) => event.type === "keyup"));
    assert.ok(takeoverEvents.some((event) => event.type === "pointerup"));
    assert.equal(takeoverEvents.at(-1)?.type, "pointermove");
    const userState = (await observe()).session;
    assert.equal(userState.userControlled, true);
    assert.equal(userState.agentControlled, false);
    assert.deepEqual(userState.userCursor, { x: 20, y: 20, pressed: false });
    assert.equal(
      (
        (await browser.handle({ type: "screenshot", sessionId: "movement" }, agent)) as {
          mimeType: string;
        }
      ).mimeType,
      "image/jpeg",
    );
    await assert.rejects(browser.handle({ type: "reload", sessionId: "movement" }, agent), {
      code: "browser-user-active",
    });
    await assert.rejects(
      browser.handle({ type: "cdp", sessionId: "movement", method: "Page.reload" }, agent),
      { code: "browser-user-active" },
    );
    await browser.handle({ type: "attach", sessionId: "other", projectId: "project" }, agent);
    await browser.handle({ type: "navigate", sessionId: "other", url: "about:blank" }, agent);
    assert.equal(
      (await observe()).session.userControlled,
      true,
      "Other tabs must remain available during user activity",
    );
  } finally {
    run.abort();
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
        permissions: { history: "ask", download: "deny", upload: "ask" },
        sites: [{ origin: "https://example.com", permissions: { download: "allow" } }],
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

test("browser permissions remain scoped to history, downloads and uploads with one-time responses", async (t) => {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "workbench-browser-approvals-"));
  const manager = new BrowserManager({ stateDirectory });
  t.after(async () => {
    manager.dispose();
    await rm(stateDirectory, { recursive: true, force: true });
  });
  const authorization = manager as unknown as {
    authorize(
      action: BrowserPermission,
      url: string,
      sessionId: string,
      source: "agent",
      signal?: AbortSignal,
    ): Promise<void>;
  };
  const request = async (action: BrowserPermission, signal?: AbortSignal) => {
    let resolveEvent!: (value: Extract<BrowserEvent, { type: "permission" }>) => void;
    const event = new Promise<Extract<BrowserEvent, { type: "permission" }>>((resolve) => {
      resolveEvent = resolve;
    });
    const unsubscribe = manager.subscribe((value) => {
      if (value.type === "permission") resolveEvent(value);
    });
    const operation = authorization.authorize(
      action,
      "https://example.test/path",
      "tab",
      "agent",
      signal,
    );
    void operation.catch(() => undefined);
    const permission = await event;
    unsubscribe();
    assert.equal(permission.action, action);
    assert.equal(permission.origin, "https://example.test");
    return { permission, operation };
  };
  const initial = await manager.handle({ type: "settings.get" });
  for (const action of ["history", "download", "upload"] as const) {
    const { permission, operation } = await request(action);
    const reply = {
      type: "permission.respond" as const,
      requestId: permission.requestId,
      allow: true,
    };
    await assert.rejects(manager.handle(reply, { source: "agent" }), {
      code: "browser-permission-denied",
    });
    await manager.handle(reply);
    await operation;
    await assert.rejects(manager.handle(reply), { code: "browser-invalid" });
    const again = await request(action);
    await manager.handle({
      type: "permission.respond",
      requestId: again.permission.requestId,
      allow: false,
    });
    await assert.rejects(again.operation, { code: "browser-permission-denied" });
  }
  assert.deepEqual(
    await manager.handle({ type: "settings.get" }),
    initial,
    "one-time approval must not change settings",
  );
  const controller = new AbortController();
  const canceled = await request("history", controller.signal);
  controller.abort();
  await assert.rejects(canceled.operation);
  await assert.rejects(
    manager.handle({
      type: "permission.respond",
      requestId: canceled.permission.requestId,
      allow: true,
    }),
    { code: "browser-invalid" },
  );
  await manager.handle({
    type: "settings.update",
    patch: {
      sites: [
        { origin: "https://example.test", permissions: { download: "allow", upload: "deny" } },
      ],
    },
  });
  await authorization.authorize("download", "https://example.test/file", "tab", "agent");
  await assert.rejects(
    authorization.authorize("upload", "https://example.test/file", "tab", "agent"),
    { code: "browser-permission-denied" },
  );
});

test("real Chrome navigates, streams, finds, copies, emulates and exports with native popups", async (t) => {
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
    if (request.url === "/redirect") {
      response.writeHead(302, { Location: "/?redirected" });
      response.end();
      return;
    }
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
      '<!doctype html><title>Browser test</title><meta name="viewport" content="width=device-width"><style>#responsive{display:grid;grid-template-columns:repeat(2,1fr)}@media(max-width:480px){#responsive{grid-template-columns:1fr}}</style><h1>Searchable browser fixture</h1><div id="responsive"><span>First</span><span>Second</span></div><input id="plain" value="copy me" style="position:absolute;left:100px;top:100px;width:100px;height:40px;background:rgb(255,0,0);border:0"><input id="secret" type="password" value="do not copy"><input type="file" id="upload"><div style="width:1000px">Wide content</div><a href="/download" id="download">Download</a><a href="/?popup" target="_blank" id="popup">Popup</a>',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/`;
  const manager = new BrowserManager({ stateDirectory });
  const events: BrowserEvent[] = [];
  manager.subscribe((event) => events.push(event));
  const waitFor = async (predicate: () => boolean | Promise<boolean>) => {
    const until = Date.now() + 10000;
    while (!(await predicate()) && Date.now() < until)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(await predicate(), "browser event did not arrive");
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
    const frameDimensions = async (frame: Extract<BrowserEvent, { type: "frame" }>) =>
      (
        await evaluate(`(async () => {
          const image = new Image(); image.src = 'data:${frame.mimeType};base64,${frame.data}';
          await image.decode(); return { width: image.naturalWidth, height: image.naturalHeight };
        })()`)
      ).result.value as { width: number; height: number };
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
      const encoded = await frameDimensions(visibleFrame);
      // Decode the actual stream in Chrome and click the colored input's bitmap center.
      const marker = (
        await evaluate(`(async () => {
        const image = new Image(); image.src = 'data:${visibleFrame.mimeType};base64,${visibleFrame.data}';
        await image.decode(); const canvas = new OffscreenCanvas(image.width, image.height);
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
        const { data } = context.getImageData(0, 0, image.width, image.height);
        let left = image.width, top = image.height, right = 0, bottom = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] > 230 && data[i + 1] < 25 && data[i + 2] < 25) {
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
      { zoom: 1, deviceScaleFactor: 2 },
      { zoom: 1, width: 360, deviceScaleFactor: 2 },
      { zoom: 1, deviceScaleFactor: 3 },
      { zoom: 3, deviceScaleFactor: 2 },
      { zoom: 1.5, deviceScaleFactor: 2 },
      { zoom: 1, device: { width: 390, height: 844, mobile: true } },
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
      const width = config.width ?? 600;
      const logicalWidth = Math.round((config.device?.width ?? width) / config.zoom);
      const expectedWidth = width * Math.min(config.deviceScaleFactor ?? 2, 2, 2 / config.zoom);
      // A frame already in flight may arrive after the next viewport was requested.
      const currentFrame = async () => {
        const frame = events
          .slice(start)
          .findLast(
            (event) => event.type === "frame" && (config.device || event.width === logicalWidth),
          ) as Extract<BrowserEvent, { type: "frame" }> | undefined;
        if (
          frame &&
          (config.device || Math.abs((await frameDimensions(frame)).width - expectedWidth) <= 1)
        )
          return frame;
      };
      await waitFor(async () => Boolean(await currentFrame())).catch((cause) => {
        throw new Error(
          JSON.stringify({
            config,
            frames: events
              .slice(start)
              .filter((event) => event.type === "frame")
              .map((event) => ({
                width: event.width,
                height: event.height,
                mimeType: event.mimeType,
              })),
          }),
          { cause },
        );
      });
      const visibleFrame = (await currentFrame())!;
      assert.equal(visibleFrame.mimeType, "image/jpeg");
      const encoded = await frameDimensions(visibleFrame);
      if (!config.device) {
        assert.ok(Math.abs(encoded.width - expectedWidth) <= 1, JSON.stringify(config));
        assert.equal(visibleFrame.width, logicalWidth);
        const layout = (
          await evaluate(`({
          width: innerWidth,
          height: innerHeight,
          overflow: document.documentElement.scrollWidth,
          columns: getComputedStyle(document.querySelector('#responsive')).gridTemplateColumns.split(' ').length
        })`)
        ).result.value;
        assert.equal(
          layout.width,
          logicalWidth,
          "wide content must not inflate the workspace viewport",
        );
        assert.equal(layout.height, Math.round(400 / config.zoom));
        assert.ok(
          layout.overflow >= 1000,
          "the fixed-width child should retain its natural overflow",
        );
        assert.equal(
          layout.columns,
          logicalWidth <= 480 ? 1 : 2,
          "CSS media queries must reflow at the workspace width",
        );
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
    }
    await manager.handle({
      type: "viewport",
      sessionId: "tab",
      width: 600,
      height: 400,
      visible: true,
      device: null,
      zoom: 1,
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
        permissions: { history: "deny", download: "deny", upload: "deny" },
      },
    });
    const permissionStart = events.length;
    await waitFor(
      async () =>
        !(
          (await manager.handle({
            type: "tabs.list",
            projectId: "project",
          })) as BrowserSessionState[]
        ).find((tab) => tab.id === "tab")?.userControlled,
    );
    await manager.handle(
      { type: "attach", sessionId: "tab", projectId: "project" },
      { source: "agent" },
    );
    await manager.handle(
      { type: "navigate", sessionId: "tab", url: `${url}redirect` },
      { source: "agent" },
    );
    await waitFor(() =>
      events
        .slice(permissionStart)
        .some(
          (event) =>
            event.type === "state" &&
            event.session.url.endsWith("?redirected") &&
            event.session.status === "ready",
        ),
    );
    await manager.handle({ type: "reload", sessionId: "tab" }, { source: "agent" });
    const observation = (await manager.handle(
      { type: "snapshot", sessionId: "tab" },
      { source: "agent" },
    )) as BrowserSnapshot;
    assert.equal(observation.session.url, `${url}?redirected`);
    assert.equal(
      (
        (await manager.handle({ type: "screenshot", sessionId: "tab" }, { source: "agent" })) as {
          mimeType: string;
        }
      ).mimeType,
      "image/jpeg",
    );
    await assert.rejects(manager.handle({ type: "back", sessionId: "tab" }, { source: "agent" }), {
      code: "browser-permission-denied",
    });
    assert.equal(
      events.slice(permissionStart).some((event) => event.type === "permission"),
      false,
      "opening, redirecting, observing and operating a page must not ask for navigation permission",
    );
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      manager.handle(
        { type: "navigate", sessionId: "tab", url: `${url}?blocked-request` },
        { source: "agent", signal: controller.signal },
      ),
      { code: "browser-operation-failed" },
    );
    assert.equal(blockedRequests, 0, "canceled navigation must never reach the site");
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
    assert.ok(transport.process);
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
