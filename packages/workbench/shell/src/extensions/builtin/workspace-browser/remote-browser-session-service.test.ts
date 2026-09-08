import assert from "node:assert/strict";
import test from "node:test";
import type { RuntimeWebSocket } from "@workbench/host-client";
import {
  BROWSER_WEBSOCKET_PATH,
  DEFAULT_BROWSER_SETTINGS,
  type BrowserClientFrame,
  type BrowserEvent,
  type BrowserSessionState,
} from "@workbench/browser-contracts";
import { createSameOriginRuntimeConnection } from "../../../runtime-connection";
import { RemoteBrowserSessionService } from "./remote-browser-session-service";

class Socket implements RuntimeWebSocket {
  readyState = 0;
  onopen: RuntimeWebSocket["onopen"] = null;
  onmessage: RuntimeWebSocket["onmessage"] = null;
  onerror: RuntimeWebSocket["onerror"] = null;
  onclose: RuntimeWebSocket["onclose"] = null;
  readonly sent: BrowserClientFrame[] = [];
  send(data: unknown) {
    assert.equal(this.readyState, 1);
    this.sent.push(JSON.parse(String(data)) as BrowserClientFrame);
  }
  close() {
    this.readyState = 2;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  message(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
  result(result: unknown) {
    this.message({ type: "result", id: this.sent.at(-1)!.id, result });
  }
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("remote browser orders initial attach, validates frames, and isolates reconnect/disposal", async () => {
  const sockets: Socket[] = [];
  const browser = new RemoteBrowserSessionService(
    createSameOriginRuntimeConnection("http://localhost"),
    (path) => {
      assert.equal(path, BROWSER_WEBSOCKET_PATH);
      const socket = new Socket();
      sockets.push(socket);
      return socket;
    },
  );
  const events: BrowserEvent[] = [];
  browser.subscribeEvents((event) => events.push(event));
  const state: BrowserSessionState = {
    id: "tab",
    projectId: "project",
    url: "https://first.example/",
    title: "First",
    status: "ready",
    canGoBack: false,
    canGoForward: false,
    revision: 1,
    zoom: 1,
    fitToWidth: true,
    width: 800,
    height: 600,
  };
  try {
    browser.attach(state);
    const attached = browser.command({
      type: "attach",
      sessionId: state.id,
      projectId: state.projectId,
    });
    await assert.rejects(
      browser.command({ type: "attach", sessionId: state.id, projectId: "other-project" }),
      { message: "browser-invalid" },
    );
    const navigate = browser.command(
      { type: "navigate", sessionId: state.id, url: "https://next.example/" },
      "agent",
    );
    assert.equal(sockets.length, 1);
    const first = sockets[0]!;
    assert.equal(first.sent.length, 0);
    first.open();
    await settle();
    assert.equal(first.sent.length, 1);
    assert.equal(first.sent[0]!.command.type, "attach");
    assert.equal(first.sent[0]!.source, "agent");
    first.result(state);
    assert.deepEqual(await attached, state);
    await settle();
    assert.equal(first.sent[1]!.command.type, "navigate");
    assert.equal(first.sent[1]!.source, "agent");
    first.message({
      type: "state",
      session: { ...state, url: "https://next.example/", revision: 2 },
    });
    first.result(undefined);
    await navigate;
    assert.equal(browser.getSession(state.id)?.url, "https://next.example/");

    const revision = browser.getRevision();
    for (const malformed of [
      null,
      1,
      [],
      { type: "state", session: null },
      { type: "settings", settings: {} },
      { type: "frame", sessionId: "tab", width: "800" },
    ]) {
      assert.doesNotThrow(() => first.message(malformed));
    }
    assert.equal(browser.getRevision(), revision);
    assert.equal(events.length, 1);
    const invalidSettings = browser.loadSettings();
    const rejectedSettings = assert.rejects(invalidSettings, { message: "browser-invalid" });
    await settle();
    first.result({});
    await rejectedSettings;
    assert.deepEqual(browser.getSettings(), DEFAULT_BROWSER_SETTINGS);

    const pending = browser.command({ type: "settings.get" });
    const rejectedPending = assert.rejects(pending, { message: "connection_failed" });
    await settle();
    const staleClose = first.onclose!;
    const staleMessage = first.onmessage!;
    first.onerror?.({});
    await rejectedPending;
    assert.equal(first.readyState, 2);
    assert.equal(browser.getSession(state.id)?.status, "disconnected");
    const reconnect = browser.loadSettings();
    const second = sockets[1]!;
    second.open();
    await settle();
    staleClose({});
    staleMessage({ data: JSON.stringify({ type: "state", session: state }) });
    second.result({ ...DEFAULT_BROWSER_SETTINGS, showFullUrl: true });
    await reconnect;
    assert.equal(browser.getSettings().showFullUrl, true);
    assert.equal(browser.getSession(state.id)?.status, "disconnected");
    assert.equal(events.at(-1)?.type, "settings");

    const recover = browser.reload(state.id);
    await settle();
    assert.equal(second.sent.at(-1)?.command.type, "attach");
    second.result(state);
    await settle();
    assert.equal(second.sent.at(-1)?.command.type, "reload");
    second.result(undefined);
    await recover;
    assert.equal(browser.getSession(state.id)?.status, "ready");

    const close = browser.command({ type: "close", sessionId: state.id });
    await settle();
    second.result(undefined);
    await close;
    assert.equal(browser.getSession(state.id), undefined);

    const closing = browser.command({ type: "settings.get" });
    const rejectedClosing = assert.rejects(closing, { message: "disconnected" });
    await settle();
    browser.dispose();
    await rejectedClosing;
    assert.equal(browser.getSession(state.id), undefined);
    await assert.rejects(browser.command({ type: "settings.get" }), { message: "disconnected" });
    assert.equal(sockets.length, 2);
  } finally {
    browser.dispose();
  }
});
