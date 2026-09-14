import assert from "node:assert/strict";
import test from "node:test";

import { Aes256Gcm, CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from "@hpke/core";

import {
  generateRemoteHpkeKeyPair,
  openRemoteEnvelope,
  RemoteEnvelopeCryptoError,
  sealRemoteEnvelope,
} from "../src/crypto";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function fromHex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16));
}

function toHex(value: ArrayBufferLike | ArrayBufferView): string {
  const bytes = ArrayBuffer.isView(value)
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : new Uint8Array(value);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function mutateBase64Url(value: string): string {
  const replacement = value.at(-1) === "A" ? "B" : "A";
  return `${value.slice(0, -1)}${replacement}`;
}

const header = {
  protocolVersion: 1,
  envelopeId: "envelope-1",
  machineId: "machine-1",
  source: { kind: "mobile", id: "device-1" },
  target: { kind: "desktop", id: "machine-1" },
  contentType: "command",
  createdAt: "2026-09-13T20:00:00.000Z",
  expiresAt: "2026-09-13T20:02:00.000Z",
} as const;

test("matches the RFC 9180 Auth/P-256/HKDF-SHA256/AES-256-GCM known-answer vector", async () => {
  const suite = new CipherSuite({
    kem: new DhkemP256HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Aes256Gcm(),
  });
  const recipient = await suite.kem.deriveKeyPair(
    fromHex("3c56756948f1c27aed3eb27a923c891dc073eccf94bb6c1b64a8bfaa95f1f8f7"),
  );
  const sender = await suite.kem.deriveKeyPair(
    fromHex("0f3def8cc45967f86c566f2c2a7decedff0d5f8b20a34ab65318144c80cb6b2b"),
  );
  const ephemeral = await suite.kem.deriveKeyPair(
    fromHex("d6c49e442aad90bcc1bc0d166e5c4d3df845c803ba08b8a4d891af2eeae4f97e"),
  );
  const senderContext = await suite.createSenderContext({
    recipientPublicKey: recipient.publicKey,
    senderKey: sender,
    ekm: ephemeral,
    info: fromHex("4f6465206f6e2061204772656369616e2055726e"),
  });
  const ciphertext = await senderContext.seal(
    fromHex("4265617574792069732074727574682c20747275746820626561757479"),
    fromHex("436f756e742d30"),
  );

  assert.equal(
    toHex(senderContext.enc),
    "04a7aeac79fda402674ef247c12d6f5fdfd21498d896b67ff04ec181382d4516b7662be32b4a2ae817c2d57104ecb6fcaa527438939810612d1b3d0af36ffc66ce",
  );
  assert.equal(
    toHex(ciphertext),
    "59b9890aabf94c1d502c39d8d356989ab0880ed43e984255db7b32a8d7b0ad5beba799a4ec326a0ddca3dd5e5d",
  );
});

test("opens an authenticated envelope and rejects wrong recipient or sender keys", async () => {
  const sender = await generateRemoteHpkeKeyPair();
  const recipient = await generateRemoteHpkeKeyPair();
  const wrong = await generateRemoteHpkeKeyPair();
  const envelope = await sealRemoteEnvelope({
    header,
    recipient: { keyId: "desktop-key-1", publicKey: recipient.publicKey },
    senderPrivateKey: sender.privateKey,
    plaintext: encoder.encode("仅远程会话正文"),
    associatedData: encoder.encode("operation.request"),
  });
  const open = (recipientPrivateKey = recipient.privateKey, senderPublicKey = sender.publicKey) =>
    openRemoteEnvelope({
      envelope,
      senderPublicKey,
      associatedData: encoder.encode("operation.request"),
      now: new Date("2026-09-13T20:01:00.000Z"),
      resolveRecipientPrivateKey: (keyId) =>
        keyId === "desktop-key-1" ? recipientPrivateKey : undefined,
    });

  assert.equal(decoder.decode(await open()), "仅远程会话正文");
  await assert.rejects(open(wrong.privateKey), RemoteEnvelopeCryptoError);
  await assert.rejects(open(recipient.privateKey, wrong.publicKey), RemoteEnvelopeCryptoError);
});

test("authenticates caller AAD and every relay-visible routing header", async () => {
  const sender = await generateRemoteHpkeKeyPair();
  const recipient = await generateRemoteHpkeKeyPair();
  const envelope = await sealRemoteEnvelope({
    header,
    recipient: { keyId: "desktop-key-1", publicKey: recipient.publicKey },
    senderPrivateKey: sender.privateKey,
    plaintext: encoder.encode("private"),
    associatedData: encoder.encode("expected-aad"),
  });
  const open = (candidate: typeof envelope, associatedData = encoder.encode("expected-aad")) =>
    openRemoteEnvelope({
      envelope: candidate,
      senderPublicKey: sender.publicKey,
      associatedData,
      now: new Date("2026-09-13T20:01:00.000Z"),
      resolveRecipientPrivateKey: (keyId) =>
        keyId === "desktop-key-1" || keyId === "desktop-key-2" ? recipient.privateKey : undefined,
    });

  await assert.rejects(open(envelope, encoder.encode("tampered-aad")));
  await assert.rejects(open({ ...envelope, envelopeId: "envelope-2" }));
  await assert.rejects(open({ ...envelope, machineId: "machine-2" }));
  await assert.rejects(open({ ...envelope, source: { ...envelope.source, id: "device-2" } }));
  await assert.rejects(open({ ...envelope, target: { ...envelope.target, id: "machine-2" } }));
  await assert.rejects(open({ ...envelope, contentType: "event" }));
  await assert.rejects(open({ ...envelope, keyId: "desktop-key-2" }));
  await assert.rejects(open({ ...envelope, createdAt: "2026-09-13T19:59:59.000Z" }));
  await assert.rejects(open({ ...envelope, expiresAt: "2026-09-13T20:03:00.000Z" }));
  await assert.rejects(open({ ...envelope, protocolVersion: 2 } as unknown as typeof envelope));
  await assert.rejects(
    open({ ...envelope, hpke: { ...envelope.hpke, enc: mutateBase64Url(envelope.hpke.enc) } }),
  );
  await assert.rejects(
    open({
      ...envelope,
      hpke: { ...envelope.hpke, ciphertext: mutateBase64Url(envelope.hpke.ciphertext) },
    }),
  );
});

test("fails closed for expiry and for a retired recipient key outside its decrypt-only grace", async () => {
  const sender = await generateRemoteHpkeKeyPair();
  const retiredRecipient = await generateRemoteHpkeKeyPair();
  const currentRecipient = await generateRemoteHpkeKeyPair();
  const envelope = await sealRemoteEnvelope({
    header,
    recipient: { keyId: "desktop-key-retired", publicKey: retiredRecipient.publicKey },
    senderPrivateKey: sender.privateKey,
    plaintext: encoder.encode("rotation"),
  });
  const input = {
    envelope,
    senderPublicKey: sender.publicKey,
    now: new Date("2026-09-13T20:01:00.000Z"),
  } as const;

  await assert.rejects(
    openRemoteEnvelope({
      ...input,
      now: new Date("2026-09-13T20:03:00.000Z"),
      resolveRecipientPrivateKey: () => retiredRecipient.privateKey,
    }),
    (error: unknown) => error instanceof RemoteEnvelopeCryptoError && error.code === "expired",
  );
  await assert.rejects(
    openRemoteEnvelope({
      ...input,
      resolveRecipientPrivateKey: (keyId) =>
        keyId === "desktop-key-current" ? currentRecipient.privateKey : undefined,
    }),
    (error: unknown) =>
      error instanceof RemoteEnvelopeCryptoError && error.code === "key_not_found",
  );
  assert.equal(
    decoder.decode(
      await openRemoteEnvelope({
        ...input,
        resolveRecipientPrivateKey: (keyId) =>
          keyId === "desktop-key-retired" ? retiredRecipient.privateKey : undefined,
      }),
    ),
    "rotation",
  );
});
