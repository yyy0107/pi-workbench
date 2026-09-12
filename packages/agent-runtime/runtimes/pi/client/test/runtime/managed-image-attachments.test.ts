import assert from "node:assert/strict";
import test from "node:test";

import type { PiComposerMessage } from "../../src/conversation/pi-conversation-message";
import { PiSessionManager } from "../../src/runtime/manager";

const PNG_BASE64 = "iVBORw0KGgo=";

test("uploads every selected file immediately and keeps the Runtime descriptor in the draft", async (t) => {
  const calls: Array<{ method: string; payload: Record<string, string> }> = [];
  const manager = new PiSessionManager({
    transport: {
      http: async (_path, init) => {
        const request = JSON.parse(String(init?.body));
        calls.push(request);
        if (request.method === "composer.attachments.discard") {
          return Response.json({
            type: "server-response",
            rpcId: request.rpcId,
            result: { ok: true, value: { discarded: true } },
          });
        }
        const id = request.payload.id;
        const name = request.payload.name;
        const fileType = name.split(".").at(-1)?.toLowerCase() ?? "file";
        const mediaType = name === "generic-clipboard" ? "image/png" : request.payload.mediaType;
        return Response.json({
          type: "server-response",
          rpcId: request.rpcId,
          result: {
            ok: true,
            value: {
              id,
              name,
              mediaType,
              path: `/runtime/attachments/2026-09-12/${fileType}/${id}/${name}`,
              bytes: Buffer.from(request.payload.data, "base64").length,
            },
          },
        });
      },
    },
  });
  t.after(() => manager.dispose());

  const session = manager.getSession("image-draft");
  const source = `data:image/png;base64,${PNG_BASE64}`;
  await session.actions.addComposerAttachment!({
    key: globalThis.crypto.randomUUID(),
    name: "image.png",
    source,
    mediaType: "image/png",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.method, "composer.attachments.createFile");
  assert.equal(calls[0]!.payload.data, PNG_BASE64);
  const attachment = session.snapshot.getSnapshot().composer.attachments[0]!;
  assert.equal(attachment.kind, "managed-file");
  assert.equal(attachment.kind === "managed-file" && attachment.status, "ready");
  assert.equal(
    attachment.kind === "managed-file" &&
      attachment.status === "ready" &&
      attachment.attachment.path,
    `/runtime/attachments/2026-09-12/png/${attachment.key}/image.png`,
  );

  await session.actions.addComposerAttachment!({
    key: globalThis.crypto.randomUUID(),
    name: "slides.pptx",
    source:
      "data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,UEs=",
    mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
  const presentation = session.snapshot.getSnapshot().composer.attachments[1]!;
  assert.equal(calls[1]!.method, "composer.attachments.createFile");
  assert.equal(presentation.kind, "managed-file");
  assert.equal(
    presentation.kind === "managed-file" &&
      presentation.status === "ready" &&
      presentation.attachment.path,
    `/runtime/attachments/2026-09-12/pptx/${presentation.key}/slides.pptx`,
  );

  await session.actions.addComposerAttachment!({
    key: globalThis.crypto.randomUUID(),
    name: "generic-clipboard",
    source: `data:application/octet-stream;base64,${PNG_BASE64}`,
    mediaType: "application/octet-stream",
  });
  const correctedImage = session.snapshot.getSnapshot().composer.attachments[2]!;
  assert.equal(correctedImage.mediaType, "image/png");
  assert.equal(
    correctedImage.kind === "managed-file" && correctedImage.source,
    `data:image/png;base64,${PNG_BASE64}`,
  );

  session.actions.removeComposerAttachment!(attachment.key);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.at(-1)!.method, "composer.attachments.discard");
});

test("a send click waits for an in-flight attachment upload and then submits it", async (t) => {
  let finishUpload: ((response: Response) => void) | undefined;
  let uploadRequest: { rpcId: string; payload: Record<string, string> } | undefined;
  const manager = new PiSessionManager({
    transport: {
      http: async (_path, init) => {
        const request = JSON.parse(String(init?.body));
        assert.equal(request.method, "composer.attachments.createFile");
        uploadRequest = request;
        return new Promise<Response>((resolve) => {
          finishUpload = resolve;
        });
      },
    },
  });
  t.after(() => manager.dispose());

  const session = manager.getSession("pending-upload");
  const sent: PiComposerMessage[] = [];
  (session as unknown as { send(message: PiComposerMessage): Promise<void> }).send = async (
    message,
  ) => {
    sent.push(message);
  };
  const add = session.actions.addComposerAttachment!({
    key: "8b95d58b-3189-45f0-9be6-f7a9e4de7248",
    name: "image.png",
    source: `data:image/png;base64,${PNG_BASE64}`,
    mediaType: "image/png",
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const saving = session.snapshot.getSnapshot().composer.attachments[0];
  assert.equal(saving?.kind, "managed-file");
  assert.equal(saving?.kind === "managed-file" && saving.status, "saving");

  const submit = session.actions.send!({
    version: 2,
    document: [],
    sourceText: "",
    text: "",
    context: [],
    metadata: {},
    commands: [],
  });
  assert.equal(session.snapshot.getSnapshot().composer.phase, "submitting");
  assert.equal(sent.length, 0);

  assert.ok(uploadRequest);
  finishUpload?.(
    Response.json({
      type: "server-response",
      rpcId: uploadRequest.rpcId,
      result: {
        ok: true,
        value: {
          id: uploadRequest.payload.id,
          name: uploadRequest.payload.name,
          mediaType: uploadRequest.payload.mediaType,
          path: `/runtime/attachments/${uploadRequest.payload.id}/${uploadRequest.payload.name}`,
          bytes: Buffer.from(uploadRequest.payload.data, "base64").length,
        },
      },
    }),
  );
  await Promise.all([add, submit]);

  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.attachments[0]?.content[0]?.type, "image");
  assert.equal(session.snapshot.getSnapshot().composer.phase, "idle");
  assert.deepEqual(session.snapshot.getSnapshot().composer.attachments, []);
});
