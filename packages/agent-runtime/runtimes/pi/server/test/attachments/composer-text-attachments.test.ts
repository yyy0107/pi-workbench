import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PASTED_TEXT_MAX_BYTES,
  canRestorePastedText,
} from "@workbench/agent-runtime-contracts/composer-attachments";
import { ComposerTextAttachmentStore } from "../../src/attachments/composer-text-attachments";
import { createComposerAttachmentRpcRoutes } from "../../src/transport/routes/composer-attachment-rpc-routes";

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), "pasted-text-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return new ComposerTextAttachmentStore(path.join(root, "attachments"));
}

test("preserves UTF-8, BOM, CRLF, whitespace and JSON, pages without splitting emoji, and protects retained files", async (t) => {
  const store = await fixture(t);
  const text = "\ufeff" + " ".repeat(24998) + '😀中文\r\n{ "key": "<script>" }\n\t';
  const id = randomUUID();
  const [first, retry] = await Promise.all([
    store.create({ id, text }),
    store.create({ id, text }),
  ]);
  assert.deepEqual(first, retry);
  assert.equal(first.characterCount, text.length);
  assert.equal(first.bytes, Buffer.byteLength(text));
  assert.equal(await readFile(first.path, "utf8"), text);
  assert.equal((await stat(first.path)).mode & 0o777, 0o600);
  const page = await store.read({ id });
  assert.equal(page.nextOffset, 24999);
  const rest = await store.read({ id, offset: page.nextOffset });
  assert.equal(page.text + rest.text, text);
  assert.equal(rest.nextOffset, undefined);
  await assert.rejects(store.create({ id, text: text + "different" }), {
    code: "text-attachment-conflict",
  });
  await store.retain([id]);
  await store.discard({ id });
  assert.equal(await readFile(first.path, "utf8"), text);
  assert.deepEqual(await store.retain([id, id]), [first]);
  assert.deepEqual([4999, 5000, 25000, 25001].map(canRestorePastedText), [
    false,
    true,
    true,
    false,
  ]);
});

test("RPC accepts escaped text above 1 MiB and rejects actual UTF-8 content above 5 MiB", async (t) => {
  const store = await fixture(t);
  const routes = createComposerAttachmentRpcRoutes(store);
  const invoke = async (text: string) => {
    const method = "composer.attachments.create";
    const response = await routes.handle(
      new Request(`http://localhost/api/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json", host: "localhost" },
        body: JSON.stringify({
          type: "client-request",
          method,
          rpcId: "create-1",
          payload: { id: randomUUID(), text },
        }),
      }),
      method,
    );
    assert.ok(response);
    return response.json();
  };
  const text = "\u0000".repeat(1024 * 1024 + 1);
  const result = await invoke(text);
  assert.equal(result.result.ok, true);
  assert.equal(await readFile(result.result.value.path, "utf8"), text);
  const tooLarge = await invoke("中".repeat(Math.ceil(PASTED_TEXT_MAX_BYTES / 3)));
  assert.equal(tooLarge.result.ok, false);
  assert.equal(tooLarge.result.error.code, "attachment-too-large");
});

test("discard is idempotent and wins both orders of create/discard races", async (t) => {
  const store = await fixture(t);
  const id = randomUUID();
  await Promise.allSettled([store.create({ id, text: "a".repeat(5000) }), store.discard({ id })]);
  await assert.rejects(store.read({ id }), { code: "text-attachment-unavailable" });
  await assert.rejects(store.create({ id, text: "a".repeat(5000) }), {
    code: "text-attachment-discarded",
  });
  await store.discard({ id });
  const cancelled = randomUUID();
  await store.discard({ id: cancelled });
  await assert.rejects(store.create({ id: cancelled, text: "later" }), {
    code: "text-attachment-discarded",
  });
});

test("rejects arbitrary ids, offsets, symlink paths, malformed Unicode and unavailable files", async (t) => {
  const store = await fixture(t);
  for (const id of ["../../etc/passwd", "__proto__", "not-a-uuid"]) {
    await assert.rejects(store.create({ id, text: "x" }), { code: "text-attachment-invalid" });
    await assert.rejects(store.read({ id }), { code: "text-attachment-invalid" });
    await assert.rejects(store.discard({ id }), { code: "text-attachment-invalid" });
  }
  await assert.rejects(store.create({ id: randomUUID(), text: "\ud800" }), {
    code: "text-attachment-invalid",
  });
  const id = randomUUID();
  const attachment = await store.create({ id, text: "hello" });
  for (const offset of [-1, 1.5, 6])
    await assert.rejects(store.read({ id, offset }), { code: "text-attachment-invalid" });
  await rm(attachment.path);
  await symlink(path.join(store.directory, "registry.json"), attachment.path);
  await assert.rejects(store.read({ id }), { code: "text-attachment-unavailable" });
  await assert.rejects(store.retain([id]), { code: "text-attachment-unavailable" });
  await store.discard({ id });
  const broken = new ComposerTextAttachmentStore(path.join(store.directory, "not-directory"));
  await writeFile(broken.directory, "occupied");
  await assert.rejects(broken.create({ id: randomUUID(), text: "keep original" }));
});
