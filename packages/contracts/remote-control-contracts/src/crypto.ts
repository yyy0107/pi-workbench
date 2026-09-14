import { Aes256Gcm, CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from "@hpke/core";

import { canonicalJson, isRemoteIdentifier, REMOTE_PROTOCOL_LIMITS } from "../lib/bounds";
import { parseDirectSealedEnvelopeV1 } from "./codecs";
import { parseRemoteSealedEnvelopeV1 } from "./legacy-codecs";
import type {
  DirectRemoteDirectionV1,
  DirectSealedEnvelopeV1,
  RemoteSealedEnvelopeV1,
} from "./protocol";

const REMOTE_HPKE_INFO = new TextEncoder().encode("workbench/remote-control/v1/hpke-auth");
const DIRECT_REMOTE_HPKE_INFO = new TextEncoder().encode(
  "workbench/remote-control/direct/v1/hpke-auth",
);
const DIRECT_PAIRING_HPKE_INFO = new TextEncoder().encode(
  "workbench/remote-control/direct/v1/hpke-pairing-base",
);
const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const PUBLIC_KEY_BYTES = 65;
const PRIVATE_KEY_BYTES = 32;

export type RemoteEnvelopeCryptoErrorCode =
  | "authentication_failed"
  | "expired"
  | "invalid_envelope"
  | "invalid_key"
  | "key_not_found";

export class RemoteEnvelopeCryptoError extends Error {
  readonly code: RemoteEnvelopeCryptoErrorCode;

  constructor(code: RemoteEnvelopeCryptoErrorCode) {
    super(`Remote envelope rejected: ${code}`);
    this.name = "RemoteEnvelopeCryptoError";
    this.code = code;
  }
}

export interface RemoteHpkeKeyPair {
  readonly publicKey: Uint8Array;
  readonly privateKey: Uint8Array;
}

export type RemoteSealedEnvelopeHeaderV1 = Omit<RemoteSealedEnvelopeV1, "hpke" | "keyId">;

export interface RemoteEnvelopeSealInput {
  readonly plaintext: Uint8Array;
  readonly header: RemoteSealedEnvelopeHeaderV1;
  readonly recipient: {
    readonly keyId: string;
    readonly publicKey: Uint8Array;
  };
  readonly senderPrivateKey: Uint8Array;
  readonly associatedData?: Uint8Array;
}

export interface RemoteEnvelopeOpenInput {
  readonly envelope: RemoteSealedEnvelopeV1;
  readonly senderPublicKey: Uint8Array;
  readonly associatedData?: Uint8Array;
  readonly now: Date;
  readonly resolveRecipientPrivateKey:
    | ((keyId: string) => Promise<Uint8Array | undefined>)
    | ((keyId: string) => Uint8Array | undefined);
}

export interface RemoteEnvelopeCryptoPort {
  seal(input: RemoteEnvelopeSealInput): Promise<RemoteSealedEnvelopeV1>;
  open(input: RemoteEnvelopeOpenInput): Promise<Uint8Array>;
}

export type DirectSealedEnvelopeHeaderV1 = Omit<DirectSealedEnvelopeV1, "hpke" | "keyId">;

export interface DirectEnvelopeSealInput {
  readonly plaintext: Uint8Array;
  readonly header: DirectSealedEnvelopeHeaderV1;
  readonly recipient: {
    readonly keyId: string;
    readonly publicKey: Uint8Array;
  };
  readonly senderPrivateKey: Uint8Array;
  readonly associatedData?: Uint8Array;
}

export interface DirectEnvelopeOpenInput {
  readonly envelope: DirectSealedEnvelopeV1;
  readonly expectedMachineId: string;
  readonly expectedDeviceId: string;
  readonly expectedDirection: DirectRemoteDirectionV1;
  readonly senderPublicKey: Uint8Array;
  readonly associatedData?: Uint8Array;
  readonly now: Date;
  readonly resolveRecipientPrivateKey:
    | ((keyId: string) => Promise<Uint8Array | undefined>)
    | ((keyId: string) => Uint8Array | undefined);
}

export type DirectPairingEnvelopeSealInput = Omit<DirectEnvelopeSealInput, "senderPrivateKey">;
export type DirectPairingEnvelopeOpenInput = Omit<DirectEnvelopeOpenInput, "senderPublicKey">;

function createSuite(): CipherSuite {
  return new CipherSuite({
    kem: new DhkemP256HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Aes256Gcm(),
  });
}

function assertKeyLength(value: Uint8Array, expected: number): void {
  if (!(value instanceof Uint8Array) || value.byteLength !== expected) {
    throw new RemoteEnvelopeCryptoError("invalid_key");
  }
}

function envelopeHeader(envelope: RemoteSealedEnvelopeV1): RemoteSealedEnvelopeHeaderV1 & {
  readonly keyId: string;
} {
  return {
    protocolVersion: envelope.protocolVersion,
    envelopeId: envelope.envelopeId,
    machineId: envelope.machineId,
    source: envelope.source,
    target: envelope.target,
    contentType: envelope.contentType,
    keyId: envelope.keyId,
    createdAt: envelope.createdAt,
    expiresAt: envelope.expiresAt,
  };
}

function directEnvelopeHeader(envelope: DirectSealedEnvelopeV1): DirectSealedEnvelopeHeaderV1 & {
  readonly keyId: string;
} {
  return {
    protocolVersion: envelope.protocolVersion,
    envelopeId: envelope.envelopeId,
    machineId: envelope.machineId,
    deviceId: envelope.deviceId,
    direction: envelope.direction,
    contentType: envelope.contentType,
    keyId: envelope.keyId,
    createdAt: envelope.createdAt,
    expiresAt: envelope.expiresAt,
  };
}

function hpkeAssociatedData(header: object, extra: Uint8Array | undefined): Uint8Array {
  const headerBytes = new TextEncoder().encode(canonicalJson(header));
  const extraBytes = extra ?? new Uint8Array();
  const output = new Uint8Array(4 + headerBytes.byteLength + extraBytes.byteLength);
  new DataView(output.buffer).setUint32(0, headerBytes.byteLength, false);
  output.set(headerBytes, 4);
  output.set(extraBytes, 4 + headerBytes.byteLength);
  return output;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let output = "";
  for (let offset = 0; offset < bytes.byteLength; offset += 3) {
    const first = bytes[offset] ?? 0;
    const second = bytes[offset + 1] ?? 0;
    const third = bytes[offset + 2] ?? 0;
    const bits = (first << 16) | (second << 8) | third;
    output += BASE64URL_ALPHABET[(bits >>> 18) & 63];
    output += BASE64URL_ALPHABET[(bits >>> 12) & 63];
    if (offset + 1 < bytes.byteLength) output += BASE64URL_ALPHABET[(bits >>> 6) & 63];
    if (offset + 2 < bytes.byteLength) output += BASE64URL_ALPHABET[bits & 63];
  }
  return output;
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value) || value.length % 4 === 1) {
    throw new RemoteEnvelopeCryptoError("invalid_envelope");
  }
  const output = new Uint8Array(Math.floor((value.length * 6) / 8));
  let outputOffset = 0;
  for (let offset = 0; offset < value.length; offset += 4) {
    let bits = 0;
    let characters = 0;
    for (let index = 0; index < 4 && offset + index < value.length; index += 1) {
      const digit = BASE64URL_ALPHABET.indexOf(value[offset + index]);
      if (digit < 0) throw new RemoteEnvelopeCryptoError("invalid_envelope");
      bits = (bits << 6) | digit;
      characters += 1;
    }
    bits <<= (4 - characters) * 6;
    if (characters >= 2) output[outputOffset++] = (bits >>> 16) & 255;
    if (characters >= 3) output[outputOffset++] = (bits >>> 8) & 255;
    if (characters === 4) output[outputOffset++] = bits & 255;
  }
  if (encodeBase64Url(output) !== value) {
    throw new RemoteEnvelopeCryptoError("invalid_envelope");
  }
  return output;
}

function validateSealInput(input: RemoteEnvelopeSealInput): void {
  if (
    !isRemoteIdentifier(input.recipient.keyId) ||
    !(input.plaintext instanceof Uint8Array) ||
    input.plaintext.byteLength > REMOTE_PROTOCOL_LIMITS.sealedEnvelopeBytes ||
    (input.associatedData !== undefined && !(input.associatedData instanceof Uint8Array))
  ) {
    throw new RemoteEnvelopeCryptoError("invalid_envelope");
  }
  const placeholder: RemoteSealedEnvelopeV1 = {
    ...input.header,
    keyId: input.recipient.keyId,
    hpke: {
      suite: "P256-HKDFSHA256-AES256GCM",
      enc: "AA",
      ciphertext: "AA",
    },
  };
  if (!parseRemoteSealedEnvelopeV1(placeholder)) {
    throw new RemoteEnvelopeCryptoError("invalid_envelope");
  }
}

export async function generateRemoteHpkeKeyPair(): Promise<RemoteHpkeKeyPair> {
  try {
    const suite = createSuite();
    const pair = await suite.kem.generateKeyPair();
    return {
      publicKey: new Uint8Array(await suite.kem.serializePublicKey(pair.publicKey)),
      privateKey: new Uint8Array(await suite.kem.serializePrivateKey(pair.privateKey)),
    };
  } catch {
    throw new RemoteEnvelopeCryptoError("invalid_key");
  }
}

export async function sealRemoteEnvelope(
  input: RemoteEnvelopeSealInput,
): Promise<RemoteSealedEnvelopeV1> {
  validateSealInput(input);
  assertKeyLength(input.recipient.publicKey, PUBLIC_KEY_BYTES);
  assertKeyLength(input.senderPrivateKey, PRIVATE_KEY_BYTES);
  const headerWithKey = { ...input.header, keyId: input.recipient.keyId };

  try {
    const suite = createSuite();
    const recipientPublicKey = await suite.kem.deserializePublicKey(input.recipient.publicKey);
    const senderPrivateKey = await suite.kem.deserializePrivateKey(input.senderPrivateKey);
    const sealed = await suite.seal(
      {
        recipientPublicKey,
        senderKey: senderPrivateKey,
        info: REMOTE_HPKE_INFO,
      },
      input.plaintext,
      hpkeAssociatedData(headerWithKey, input.associatedData),
    );
    const envelope: RemoteSealedEnvelopeV1 = {
      ...headerWithKey,
      hpke: {
        suite: "P256-HKDFSHA256-AES256GCM",
        enc: encodeBase64Url(new Uint8Array(sealed.enc)),
        ciphertext: encodeBase64Url(new Uint8Array(sealed.ct)),
      },
    };
    if (!parseRemoteSealedEnvelopeV1(envelope)) {
      throw new RemoteEnvelopeCryptoError("invalid_envelope");
    }
    return envelope;
  } catch (error) {
    if (error instanceof RemoteEnvelopeCryptoError) throw error;
    throw new RemoteEnvelopeCryptoError("authentication_failed");
  }
}

export async function openRemoteEnvelope(input: RemoteEnvelopeOpenInput): Promise<Uint8Array> {
  if (!parseRemoteSealedEnvelopeV1(input.envelope)) {
    throw new RemoteEnvelopeCryptoError("invalid_envelope");
  }
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) {
    throw new RemoteEnvelopeCryptoError("invalid_envelope");
  }
  if (input.now.getTime() >= Date.parse(input.envelope.expiresAt)) {
    throw new RemoteEnvelopeCryptoError("expired");
  }
  if (input.associatedData !== undefined && !(input.associatedData instanceof Uint8Array)) {
    throw new RemoteEnvelopeCryptoError("invalid_envelope");
  }

  const recipientPrivateKeyBytes = await input.resolveRecipientPrivateKey(input.envelope.keyId);
  if (recipientPrivateKeyBytes === undefined) {
    throw new RemoteEnvelopeCryptoError("key_not_found");
  }
  assertKeyLength(recipientPrivateKeyBytes, PRIVATE_KEY_BYTES);
  assertKeyLength(input.senderPublicKey, PUBLIC_KEY_BYTES);

  try {
    const suite = createSuite();
    const recipientPrivateKey = await suite.kem.deserializePrivateKey(recipientPrivateKeyBytes);
    const senderPublicKey = await suite.kem.deserializePublicKey(input.senderPublicKey);
    const plaintext = await suite.open(
      {
        recipientKey: recipientPrivateKey,
        senderPublicKey,
        enc: decodeBase64Url(input.envelope.hpke.enc),
        info: REMOTE_HPKE_INFO,
      },
      decodeBase64Url(input.envelope.hpke.ciphertext),
      hpkeAssociatedData(envelopeHeader(input.envelope), input.associatedData),
    );
    return new Uint8Array(plaintext);
  } catch (error) {
    if (error instanceof RemoteEnvelopeCryptoError) throw error;
    throw new RemoteEnvelopeCryptoError("authentication_failed");
  }
}

function validateDirectSealInput(input: DirectEnvelopeSealInput): void {
  if (
    !isRemoteIdentifier(input.recipient.keyId) ||
    !(input.plaintext instanceof Uint8Array) ||
    input.plaintext.byteLength > REMOTE_PROTOCOL_LIMITS.sealedEnvelopeBytes ||
    (input.associatedData !== undefined && !(input.associatedData instanceof Uint8Array))
  ) {
    throw new RemoteEnvelopeCryptoError("invalid_envelope");
  }
  const placeholder: DirectSealedEnvelopeV1 = {
    ...input.header,
    keyId: input.recipient.keyId,
    hpke: {
      suite: "P256-HKDFSHA256-AES256GCM",
      enc: "AA",
      ciphertext: "AA",
    },
  };
  if (!parseDirectSealedEnvelopeV1(placeholder)) {
    throw new RemoteEnvelopeCryptoError("invalid_envelope");
  }
}

export async function sealDirectRemoteEnvelope(
  input: DirectEnvelopeSealInput,
): Promise<DirectSealedEnvelopeV1> {
  validateDirectSealInput(input);
  assertKeyLength(input.recipient.publicKey, PUBLIC_KEY_BYTES);
  assertKeyLength(input.senderPrivateKey, PRIVATE_KEY_BYTES);
  const headerWithKey = { ...input.header, keyId: input.recipient.keyId };

  try {
    const suite = createSuite();
    const recipientPublicKey = await suite.kem.deserializePublicKey(input.recipient.publicKey);
    const senderPrivateKey = await suite.kem.deserializePrivateKey(input.senderPrivateKey);
    const sealed = await suite.seal(
      {
        recipientPublicKey,
        senderKey: senderPrivateKey,
        info: DIRECT_REMOTE_HPKE_INFO,
      },
      input.plaintext,
      hpkeAssociatedData(headerWithKey, input.associatedData),
    );
    const envelope: DirectSealedEnvelopeV1 = {
      ...headerWithKey,
      hpke: {
        suite: "P256-HKDFSHA256-AES256GCM",
        enc: encodeBase64Url(new Uint8Array(sealed.enc)),
        ciphertext: encodeBase64Url(new Uint8Array(sealed.ct)),
      },
    };
    if (!parseDirectSealedEnvelopeV1(envelope)) {
      throw new RemoteEnvelopeCryptoError("invalid_envelope");
    }
    return envelope;
  } catch (error) {
    if (error instanceof RemoteEnvelopeCryptoError) throw error;
    throw new RemoteEnvelopeCryptoError("authentication_failed");
  }
}

export async function openDirectRemoteEnvelope(
  input: DirectEnvelopeOpenInput,
): Promise<Uint8Array> {
  if (
    !parseDirectSealedEnvelopeV1(input.envelope) ||
    input.envelope.machineId !== input.expectedMachineId ||
    input.envelope.deviceId !== input.expectedDeviceId ||
    input.envelope.direction !== input.expectedDirection
  ) {
    throw new RemoteEnvelopeCryptoError("invalid_envelope");
  }
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) {
    throw new RemoteEnvelopeCryptoError("invalid_envelope");
  }
  if (input.now.getTime() >= Date.parse(input.envelope.expiresAt)) {
    throw new RemoteEnvelopeCryptoError("expired");
  }
  if (input.associatedData !== undefined && !(input.associatedData instanceof Uint8Array)) {
    throw new RemoteEnvelopeCryptoError("invalid_envelope");
  }

  const recipientPrivateKeyBytes = await input.resolveRecipientPrivateKey(input.envelope.keyId);
  if (recipientPrivateKeyBytes === undefined) throw new RemoteEnvelopeCryptoError("key_not_found");
  assertKeyLength(recipientPrivateKeyBytes, PRIVATE_KEY_BYTES);
  assertKeyLength(input.senderPublicKey, PUBLIC_KEY_BYTES);

  try {
    const suite = createSuite();
    const recipientPrivateKey = await suite.kem.deserializePrivateKey(recipientPrivateKeyBytes);
    const senderPublicKey = await suite.kem.deserializePublicKey(input.senderPublicKey);
    const plaintext = await suite.open(
      {
        recipientKey: recipientPrivateKey,
        senderPublicKey,
        enc: decodeBase64Url(input.envelope.hpke.enc),
        info: DIRECT_REMOTE_HPKE_INFO,
      },
      decodeBase64Url(input.envelope.hpke.ciphertext),
      hpkeAssociatedData(directEnvelopeHeader(input.envelope), input.associatedData),
    );
    return new Uint8Array(plaintext);
  } catch (error) {
    if (error instanceof RemoteEnvelopeCryptoError) throw error;
    throw new RemoteEnvelopeCryptoError("authentication_failed");
  }
}

export async function sealDirectPairingEnvelope(
  input: DirectPairingEnvelopeSealInput,
): Promise<DirectSealedEnvelopeV1> {
  validateDirectSealInput({ ...input, senderPrivateKey: new Uint8Array(PRIVATE_KEY_BYTES) });
  if (input.header.contentType !== "pairing") {
    throw new RemoteEnvelopeCryptoError("invalid_envelope");
  }
  assertKeyLength(input.recipient.publicKey, PUBLIC_KEY_BYTES);
  const headerWithKey = { ...input.header, keyId: input.recipient.keyId };
  try {
    const suite = createSuite();
    const recipientPublicKey = await suite.kem.deserializePublicKey(input.recipient.publicKey);
    const sealed = await suite.seal(
      { recipientPublicKey, info: DIRECT_PAIRING_HPKE_INFO },
      input.plaintext,
      hpkeAssociatedData(headerWithKey, input.associatedData),
    );
    const envelope: DirectSealedEnvelopeV1 = {
      ...headerWithKey,
      hpke: {
        suite: "P256-HKDFSHA256-AES256GCM",
        enc: encodeBase64Url(new Uint8Array(sealed.enc)),
        ciphertext: encodeBase64Url(new Uint8Array(sealed.ct)),
      },
    };
    if (!parseDirectSealedEnvelopeV1(envelope)) {
      throw new RemoteEnvelopeCryptoError("invalid_envelope");
    }
    return envelope;
  } catch (error) {
    if (error instanceof RemoteEnvelopeCryptoError) throw error;
    throw new RemoteEnvelopeCryptoError("authentication_failed");
  }
}

export async function openDirectPairingEnvelope(
  input: DirectPairingEnvelopeOpenInput,
): Promise<Uint8Array> {
  if (
    !parseDirectSealedEnvelopeV1(input.envelope) ||
    input.envelope.contentType !== "pairing" ||
    input.envelope.machineId !== input.expectedMachineId ||
    input.envelope.deviceId !== input.expectedDeviceId ||
    input.envelope.direction !== input.expectedDirection
  ) {
    throw new RemoteEnvelopeCryptoError("invalid_envelope");
  }
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) {
    throw new RemoteEnvelopeCryptoError("invalid_envelope");
  }
  if (input.now.getTime() >= Date.parse(input.envelope.expiresAt)) {
    throw new RemoteEnvelopeCryptoError("expired");
  }
  if (input.associatedData !== undefined && !(input.associatedData instanceof Uint8Array)) {
    throw new RemoteEnvelopeCryptoError("invalid_envelope");
  }
  const recipientPrivateKeyBytes = await input.resolveRecipientPrivateKey(input.envelope.keyId);
  if (recipientPrivateKeyBytes === undefined) throw new RemoteEnvelopeCryptoError("key_not_found");
  assertKeyLength(recipientPrivateKeyBytes, PRIVATE_KEY_BYTES);
  try {
    const suite = createSuite();
    const recipientPrivateKey = await suite.kem.deserializePrivateKey(recipientPrivateKeyBytes);
    const plaintext = await suite.open(
      {
        recipientKey: recipientPrivateKey,
        enc: decodeBase64Url(input.envelope.hpke.enc),
        info: DIRECT_PAIRING_HPKE_INFO,
      },
      decodeBase64Url(input.envelope.hpke.ciphertext),
      hpkeAssociatedData(directEnvelopeHeader(input.envelope), input.associatedData),
    );
    return new Uint8Array(plaintext);
  } catch (error) {
    if (error instanceof RemoteEnvelopeCryptoError) throw error;
    throw new RemoteEnvelopeCryptoError("authentication_failed");
  }
}
