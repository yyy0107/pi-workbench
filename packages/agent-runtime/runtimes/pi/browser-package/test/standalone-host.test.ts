import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { BrowserManager } from "@workbench/browser-server";
import type { BrowserCommand, BrowserEvent } from "@workbench/browser-contracts";
import type { BrowserHost } from "../index";
import { createBrowserHostResolver } from "../standalone-host";

async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-browser-host-"));
  const global = globalThis as typeof globalThis & {
    __workbenchPiAgentHostBindings?: { browser?: BrowserHost };
  };
  const previous = global.__workbenchPiAgentHostBindings;
  const agentDir = process.env.PI_CODING_AGENT_DIR;
  delete global.__workbenchPiAgentHostBindings;
  process.env.PI_CODING_AGENT_DIR = directory;
  const messages: unknown[] = [];
  let shutdown!: () => void;
  let receive!: (event: BrowserEvent) => void;
  const subscribe = t.mock.method(
    BrowserManager.prototype,
    "subscribe",
    (listener: (event: BrowserEvent) => void) => {
      receive = listener;
      return () => {};
    },
  );
  const dispose = t.mock.method(BrowserManager.prototype, "dispose", () => {});
  const pi = {
    on(event: string, handler: () => void) {
      assert.equal(event, "session_shutdown");
      shutdown = handler;
    },
    sendMessage(message: { content: string }) {
      messages.push(JSON.parse(message.content));
    },
  } as unknown as ExtensionAPI;
  const context = {
    cwd: directory,
    hasUI: true,
    sessionManager: { getSessionId: () => "pi-session" },
    ui: { confirm: async () => true, input: async () => "answer" },
  } as unknown as ExtensionContext;
  const resolve = createBrowserHostResolver(pi);
  t.after(async () => {
    shutdown();
    if (previous === undefined) delete global.__workbenchPiAgentHostBindings;
    else global.__workbenchPiAgentHostBindings = previous;
    if (agentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = agentDir;
    await rm(directory, { recursive: true, force: true });
  });
  return {
    directory,
    global,
    context,
    resolve,
    messages,
    subscribe,
    dispose,
    shutdown: () => shutdown(),
    emit: (event: BrowserEvent) => receive(event),
  };
}

const permission = (requestId: string): BrowserEvent => ({
  type: "permission",
  requestId,
  sessionId: "tab",
  origin: "https://example.test",
  action: "navigate",
});
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("the resolver is lazy, reuses the Workbench host, and disposes only isolated CLI managers", async (t) => {
  const current = await fixture(t);
  assert.equal(current.subscribe.mock.callCount(), 0);
  const embedded = { command: async () => "embedded" } satisfies BrowserHost;
  current.global.__workbenchPiAgentHostBindings = { browser: embedded };
  assert.equal(current.resolve(current.context), embedded);
  current.shutdown();
  assert.equal(current.dispose.mock.callCount(), 0);
  delete current.global.__workbenchPiAgentHostBindings;
  const host = current.resolve(current.context);
  assert.equal(current.resolve(current.context), host);
  assert.equal(current.subscribe.mock.callCount(), 1);
  const handle = t.mock.method(BrowserManager.prototype, "handle", async () => []);
  const controller = new AbortController();
  await host.command({ type: "tabs.list", projectId: current.directory }, controller.signal);
  const [command, options] = handle.mock.calls[0]!.arguments;
  assert.deepEqual(command, { type: "tabs.list", projectId: current.directory });
  assert.equal(options?.source, "agent");
  assert.equal(options?.signal?.aborted, false);
  controller.abort();
  assert.equal(options?.signal?.aborted, true);
  const session = current.messages[0] as { stateDirectory: string };
  assert.equal(
    path.dirname(session.stateDirectory),
    path.join(current.directory, "browser", "pi-session"),
  );
  current.shutdown();
  current.shutdown();
  assert.equal(current.dispose.mock.callCount(), 1);
  await assert.rejects(host.command({ type: "tabs.list", projectId: current.directory }));
});

test("CLI approval queues retain their request signal and never approve cancellation or unavailable UI", async (t) => {
  const current = await fixture(t);
  const replies: BrowserCommand[] = [];
  t.mock.method(BrowserManager.prototype, "handle", async (command: BrowserCommand) => {
    if (command.type === "permission.respond") replies.push(command);
  });
  const confirmations: Array<{ resolve(allow: boolean): void; signal?: AbortSignal }> = [];
  current.context.ui.confirm = async (_title, _message, options) =>
    new Promise<boolean>((resolve) => confirmations.push({ resolve, signal: options?.signal }));
  const host = current.resolve(current.context);
  const controller = new AbortController();
  await host.command({ type: "snapshot", sessionId: "tab" }, controller.signal);
  current.emit(permission("first"));
  current.emit(permission("second"));
  await settle();
  assert.equal(confirmations.length, 1, "Pi's single dialog is never replaced by another request");
  controller.abort();
  confirmations[0]!.resolve(true);
  await settle();
  assert.deepEqual(replies, [
    { type: "permission.respond", requestId: "first", allow: false },
    { type: "permission.respond", requestId: "second", allow: false },
  ]);
  assert.equal(confirmations.length, 1, "a queued canceled request never opens another dialog");
  const unattended = { ...current.context, hasUI: false };
  await current.resolve(unattended).command({ type: "snapshot", sessionId: "tab" });
  current.emit(permission("no-ui"));
  await settle();
  assert.deepEqual(replies.at(-1), {
    type: "permission.respond",
    requestId: "no-ui",
    allow: false,
  });
  assert.ok(
    current.messages.some(
      (event) => (event as { reason?: string }).reason === "browser-ui-unavailable",
    ),
  );
});

test("CLI forwards real approvals, exposes file requests, and closes a pending dialog at shutdown", async (t) => {
  const current = await fixture(t);
  const handle = t.mock.method(BrowserManager.prototype, "handle", async () => undefined);
  const host = current.resolve(current.context);
  await host.command({ type: "snapshot", sessionId: "tab" });
  current.emit(permission("approved"));
  await settle();
  assert.deepEqual(handle.mock.calls.at(-1)?.arguments, [
    { type: "permission.respond", requestId: "approved", allow: true },
    { source: "user" },
  ]);
  current.emit({ type: "file-chooser", sessionId: "tab", requestId: "upload", multiple: true });
  assert.deepEqual(current.messages.at(-1), {
    type: "file-chooser",
    sessionId: "tab",
    requestId: "upload",
    multiple: true,
  });
  let pendingSignal: AbortSignal | undefined;
  current.context.ui.confirm = async (_title, _message, options) => {
    pendingSignal = options?.signal;
    return new Promise<boolean>((resolve) =>
      pendingSignal!.addEventListener("abort", () => resolve(true), { once: true }),
    );
  };
  current.emit({
    type: "dialog",
    sessionId: "tab",
    kind: "confirm",
    message: "Page question",
    url: "https://example.test/",
  });
  await settle();
  current.shutdown();
  await settle();
  assert.equal(pendingSignal?.aborted, true);
  assert.deepEqual(handle.mock.calls.at(-1)?.arguments, [
    { type: "dialog.respond", sessionId: "tab", accept: false },
    { source: "user" },
  ]);
});
