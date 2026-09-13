import assert from "node:assert/strict";
import test from "node:test";
import { PiSessionManager } from "../../src/runtime/manager";

function descriptor(id: string, text: string) {
  return {
    id,
    name: "pasted-text.txt",
    mediaType: "text/plain",
    path: `/runtime/attachments/${id}/pasted-text.txt`,
    bytes: new TextEncoder().encode(text).length,
    characterCount: text.length,
    preview: text.slice(0, 80),
  };
}

test("uploads immediately without a remote session, retains failed text, retries one stable id and releases ready text", async (t) => {
  const originalFetch = globalThis.fetch;
  const calls: { method: string; payload: { id: string; text: string } }[] = [];
  let fail = true;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    calls.push(request);
    if (request.method === "composer.attachments.create") {
      if (fail) throw new Error("offline");
      await gate;
    }
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: { ok: true, value: descriptor(request.payload.id, request.payload.text ?? "") },
    });
  };
  const manager = new PiSessionManager();
  t.after(() => {
    manager.dispose();
    globalThis.fetch = originalFetch;
  });
  const session = manager.getSession("draft-only");
  const text = "中文😀\r\n".repeat(1000);
  await session.actions.addPastedTextAttachment!(text);
  const failed = session.snapshot.getSnapshot().composer.attachments[0]!;
  assert.equal(failed.kind, "pasted-text");
  assert.equal(failed.kind === "pasted-text" && failed.status, "error");
  assert.equal(failed.kind === "pasted-text" && failed.status !== "ready" && failed.text, text);
  fail = false;
  const first = session.actions.retryPastedTextAttachment!(failed.key);
  const duplicate = session.actions.retryPastedTextAttachment!(failed.key);
  release();
  await Promise.all([first, duplicate]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.payload.id, calls[1]!.payload.id);
  const ready = session.snapshot.getSnapshot().composer.attachments[0]!;
  assert.equal(ready.kind === "pasted-text" && ready.status, "ready");
  assert.equal("text" in ready, false);
  assert.equal(JSON.stringify(ready).includes(text), false);
});

test("deleting during upload cleans late results without changing another draft", async (t) => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    calls.push(request.method);
    if (request.method === "composer.attachments.create") await gate;
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: { ok: true, value: descriptor(request.payload.id, request.payload.text ?? "") },
    });
  };
  const manager = new PiSessionManager();
  t.after(() => {
    manager.dispose();
    globalThis.fetch = originalFetch;
  });
  const first = manager.getSession("first-draft");
  const second = manager.getSession("second-draft");
  const upload = first.actions.addPastedTextAttachment!("x".repeat(5000));
  const key = first.snapshot.getSnapshot().composer.attachments[0]!.key;
  first.actions.removeComposerAttachment!(key);
  second.actions.setComposerText!("another draft");
  release();
  await upload;
  assert.deepEqual(first.snapshot.getSnapshot().composer.attachments, []);
  assert.deepEqual(second.snapshot.getSnapshot().composer.attachments, []);
  assert.equal(second.snapshot.getSnapshot().composer.text, "another draft");
  assert.ok(calls.filter((method) => method === "composer.attachments.discard").length >= 1);
});

test("rejects excess UTF-8 bytes locally without losing pasted text", async (t) => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    calls.push(request.method);
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: { ok: true, value: {} },
    });
  };
  const manager = new PiSessionManager();
  t.after(() => {
    manager.dispose();
    globalThis.fetch = originalFetch;
  });
  const session = manager.getSession("large-draft");
  const text = "中".repeat(2 * 1024 * 1024);
  await session.actions.addPastedTextAttachment!(text);
  const item = session.snapshot.getSnapshot().composer.attachments[0]!;
  assert.ok(item.kind === "pasted-text" && item.status === "error");
  assert.equal(item.error, "attachment-too-large");
  assert.equal(item.text, text);
  assert.equal(calls.length, 0);
});
