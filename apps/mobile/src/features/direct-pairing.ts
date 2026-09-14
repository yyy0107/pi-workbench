import {
  parseDirectPairingClaimV1,
  parseDirectPairingHelloV1,
  parseDirectPairingPayloadV1,
  parseDirectPairingResultV1,
  parseDirectSealedEnvelopeV1,
} from "@workbench/remote-control-contracts/codecs";
import {
  generateDirectHpkeKeyPair,
  openDirectRemoteEnvelope,
  sealDirectPairingEnvelope,
} from "@workbench/remote-control-contracts/direct-crypto";
import {
  canonicalDirectPairingTranscript,
  deriveDirectPairingSafetyCode,
} from "@workbench/remote-control-contracts/direct-pairing";
import type {
  DirectDesktopIdentityV1,
  DirectEndpointV1,
  DirectPairingClaimV1,
  DirectPairingHelloV1,
  DirectPairingPayloadV1,
  DirectPublicJwkV1,
  DirectSealedEnvelopeV1,
} from "@workbench/remote-control-contracts/protocol";
import {
  classifyDirectClientHost,
  validateDirectClientEndpoint,
} from "@workbench/remote-control-client/endpoint-policy";
import {
  createDirectConnectionProfile,
  type DirectConnectionProfile,
} from "@workbench/remote-control-client/profiles";

import { initializeMobileHpkeRuntime } from "../platform/crypto.ts";

const PAIRING_INPUT_LIMIT_BYTES = 16 * 1024;
const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export interface MobileDirectPairingPrivateIdentity {
  readonly deviceId: string;
  readonly signingPrivateJwk: JsonWebKey;
  readonly signingPublicJwk: DirectPublicJwkV1;
  readonly signingKeyFingerprint: string;
  readonly encryptionKeyId: string;
  readonly encryptionPrivateKey: string;
  readonly encryptionPublicKey: string;
  readonly encryptionKeyFingerprint: string;
}

export interface MobileDirectPairingSession {
  hello(signal?: AbortSignal): Promise<DirectPairingHelloV1>;
  sendClaim(envelope: DirectSealedEnvelopeV1, signal?: AbortSignal): Promise<void>;
  receiveResult(signal?: AbortSignal): Promise<DirectSealedEnvelopeV1>;
  close(reason: "pairing_cancelled" | "pairing_complete" | "pairing_failed"): void;
}

export interface MobileDirectPairingTransportPort {
  connect(endpoint: DirectEndpointV1, signal?: AbortSignal): Promise<MobileDirectPairingSession>;
}

export interface MobileDirectPairingSecureStorePort {
  saveMachineKeys(machineId: string, value: MobileDirectPairingPrivateIdentity): Promise<void>;
  clearMachine(machineId: string): Promise<void>;
}

export interface MobileDirectPairingProfileStorePort {
  save(profile: DirectConnectionProfile): Promise<void>;
}

export interface MobileDirectPairingPending {
  readonly pairingId: string;
  readonly machineId: string;
  readonly machineDisplayName: string;
  readonly safetyCode: string;
  readonly expiresAt: string;
  complete(signal?: AbortSignal): Promise<DirectConnectionProfile>;
  cancel(): void;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function base64UrlEncode(value: Uint8Array): string {
  let output = "";
  for (let offset = 0; offset < value.byteLength; offset += 3) {
    const bits =
      ((value[offset] ?? 0) << 16) | ((value[offset + 1] ?? 0) << 8) | (value[offset + 2] ?? 0);
    output += BASE64URL_ALPHABET[(bits >>> 18) & 63];
    output += BASE64URL_ALPHABET[(bits >>> 12) & 63];
    if (offset + 1 < value.byteLength) output += BASE64URL_ALPHABET[(bits >>> 6) & 63];
    if (offset + 2 < value.byteLength) output += BASE64URL_ALPHABET[bits & 63];
  }
  return output;
}

function base64UrlDecode(value: string, expectedBytes?: number): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value) || value.length % 4 === 1) {
    throw new Error("pairing_code_invalid");
  }
  const output = new Uint8Array(Math.floor((value.length * 6) / 8));
  let outputOffset = 0;
  for (let offset = 0; offset < value.length; offset += 4) {
    let bits = 0;
    let count = 0;
    for (let index = 0; index < 4 && offset + index < value.length; index += 1) {
      const digit = BASE64URL_ALPHABET.indexOf(value[offset + index] ?? "");
      if (digit < 0) throw new Error("pairing_code_invalid");
      bits = (bits << 6) | digit;
      count += 1;
    }
    bits <<= (4 - count) * 6;
    if (count >= 2) output[outputOffset++] = (bits >>> 16) & 255;
    if (count >= 3) output[outputOffset++] = (bits >>> 8) & 255;
    if (count === 4) output[outputOffset++] = bits & 255;
  }
  if (
    base64UrlEncode(output) !== value ||
    (expectedBytes !== undefined && output.byteLength !== expectedBytes)
  ) {
    throw new Error("pairing_code_invalid");
  }
  return output;
}

async function digest(cryptoValue: Crypto, value: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await cryptoValue.subtle.digest("SHA-256", Uint8Array.from(value).buffer));
}

async function fingerprintJwk(cryptoValue: Crypto, value: DirectPublicJwkV1): Promise<string> {
  const canonical = JSON.stringify({ crv: value.crv, kty: value.kty, x: value.x, y: value.y });
  return `sha256:${base64UrlEncode(await digest(cryptoValue, new TextEncoder().encode(canonical)))}`;
}

function randomIdentifier(cryptoValue: Crypto, prefix: string): string {
  return `${prefix}-${base64UrlEncode(cryptoValue.getRandomValues(new Uint8Array(16)))}`;
}

async function createIdentity(cryptoValue: Crypto): Promise<MobileDirectPairingPrivateIdentity> {
  await initializeMobileHpkeRuntime();
  const signingKeys = (await cryptoValue.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const [signingPrivateJwk, exportedPublicJwk, encryption] = await Promise.all([
    cryptoValue.subtle.exportKey("jwk", signingKeys.privateKey),
    cryptoValue.subtle.exportKey("jwk", signingKeys.publicKey),
    generateDirectHpkeKeyPair(),
  ]);
  if (
    exportedPublicJwk.kty !== "EC" ||
    exportedPublicJwk.crv !== "P-256" ||
    !exportedPublicJwk.x ||
    !exportedPublicJwk.y
  ) {
    throw new Error("pairing_key_invalid");
  }
  const signingPublicJwk: DirectPublicJwkV1 = {
    kty: "EC",
    crv: "P-256",
    x: exportedPublicJwk.x,
    y: exportedPublicJwk.y,
    key_ops: ["verify"],
    ext: true,
  };
  const encryptionPublicKey = base64UrlEncode(encryption.publicKey);
  return {
    deviceId: randomIdentifier(cryptoValue, "mobile"),
    signingPrivateJwk,
    signingPublicJwk,
    signingKeyFingerprint: await fingerprintJwk(cryptoValue, signingPublicJwk),
    encryptionKeyId: randomIdentifier(cryptoValue, "mobile-key"),
    encryptionPrivateKey: base64UrlEncode(encryption.privateKey),
    encryptionPublicKey,
    encryptionKeyFingerprint: `sha256:${base64UrlEncode(
      await digest(cryptoValue, encryption.publicKey),
    )}`,
  };
}

async function signTranscript(
  cryptoValue: Crypto,
  identity: MobileDirectPairingPrivateIdentity,
  transcript: string,
): Promise<string> {
  const key = await cryptoValue.subtle.importKey(
    "jwk",
    identity.signingPrivateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await cryptoValue.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(transcript),
    ),
  );
  if (signature.byteLength !== 64) throw new Error("pairing_key_invalid");
  return base64UrlEncode(signature);
}

export function parseMobileDirectPairingCode(
  raw: string,
  now = new Date(),
): DirectPairingPayloadV1 {
  const trimmed = raw.trim();
  if (!trimmed || byteLength(trimmed) > PAIRING_INPUT_LIMIT_BYTES) {
    throw new Error("pairing_code_invalid");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(
      trimmed.startsWith("{")
        ? trimmed
        : new TextDecoder("utf-8", { fatal: true }).decode(base64UrlDecode(trimmed)),
    );
  } catch {
    throw new Error("pairing_code_invalid");
  }
  const payload = parseDirectPairingPayloadV1(decoded);
  if (
    !payload ||
    !Number.isFinite(now.getTime()) ||
    Date.parse(payload.expiresAt) <= now.getTime()
  ) {
    throw new Error("pairing_code_invalid");
  }
  try {
    return {
      ...payload,
      endpoints: payload.endpoints.map(validateDirectClientEndpoint),
    };
  } catch {
    throw new Error("endpoint_not_allowed");
  }
}

function desktopIdentity(value: DirectPairingHelloV1): DirectDesktopIdentityV1 {
  return {
    machineId: value.machineId,
    machineDisplayName: value.machineDisplayName,
    desktopEncryptionKeyId: value.desktopEncryptionKeyId,
    desktopEncryptionPublicKey: value.desktopEncryptionPublicKey,
    desktopEncryptionKeyFingerprint: value.desktopEncryptionKeyFingerprint,
  };
}

function matchingIdentity(left: DirectDesktopIdentityV1, right: DirectDesktopIdentityV1): boolean {
  return (
    left.machineId === right.machineId &&
    left.machineDisplayName === right.machineDisplayName &&
    left.desktopEncryptionKeyId === right.desktopEncryptionKeyId &&
    left.desktopEncryptionPublicKey === right.desktopEncryptionPublicKey &&
    left.desktopEncryptionKeyFingerprint === right.desktopEncryptionKeyFingerprint
  );
}

function jsonValue(value: Uint8Array): unknown {
  if (value.byteLength > PAIRING_INPUT_LIMIT_BYTES) throw new Error("pairing_response_invalid");
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(value));
  } catch {
    throw new Error("pairing_response_invalid");
  }
}

export function createMobileDirectPairingController(options: {
  readonly transport: MobileDirectPairingTransportPort;
  readonly secureStore: MobileDirectPairingSecureStorePort;
  readonly profileStore: MobileDirectPairingProfileStorePort;
  readonly readCrypto?: () => Crypto;
  readonly now?: () => Date;
}) {
  const readCrypto = options.readCrypto ?? (() => globalThis.crypto);
  const now = options.now ?? (() => new Date());

  const begin = async (input: {
    readonly endpoint: DirectEndpointV1;
    readonly secret: string;
    readonly expectedPayload?: DirectPairingPayloadV1;
    readonly displayName: string;
    readonly platform: "ios" | "android";
    readonly signal?: AbortSignal;
  }): Promise<MobileDirectPairingPending> => {
    const endpoint = validateDirectClientEndpoint(input.endpoint);
    const session = await options.transport.connect(endpoint, input.signal);
    let completeStarted = false;
    let cancelled = false;
    try {
      const helloCandidate = await session.hello(input.signal);
      const hello = parseDirectPairingHelloV1(helloCandidate);
      if (
        !hello ||
        hello.endpoint.kind !== endpoint.kind ||
        hello.endpoint.host.toLowerCase() !== endpoint.host ||
        hello.endpoint.port !== endpoint.port ||
        Date.parse(hello.expiresAt) <= now().getTime()
      ) {
        throw new Error("pairing_response_invalid");
      }
      if (
        input.expectedPayload &&
        (input.expectedPayload.pairingId !== hello.pairingId ||
          input.expectedPayload.expiresAt !== hello.expiresAt ||
          !matchingIdentity(input.expectedPayload, desktopIdentity(hello)))
      ) {
        throw new Error("identity_mismatch");
      }

      const cryptoValue = readCrypto();
      const identity = await createIdentity(cryptoValue);
      const secretProof = base64UrlEncode(
        await digest(cryptoValue, new TextEncoder().encode(input.secret)),
      );
      const transcript = canonicalDirectPairingTranscript({
        pairingId: hello.pairingId,
        secretProof,
        endpoint,
        ...desktopIdentity(hello),
        phoneDeviceId: identity.deviceId,
        mobileEncryptionKeyId: identity.encryptionKeyId,
        mobileEncryptionKeyFingerprint: identity.encryptionKeyFingerprint,
        mobileSigningKeyFingerprint: identity.signingKeyFingerprint,
        protocolVersion: 1,
        expiresAt: hello.expiresAt,
      });
      const claim: DirectPairingClaimV1 = {
        type: "direct.pairing.claim",
        pairingId: hello.pairingId,
        secretProof,
        deviceId: identity.deviceId,
        deviceDisplayName: input.displayName,
        platform: input.platform,
        mobileSigningPublicJwk: identity.signingPublicJwk,
        mobileSigningKeyFingerprint: identity.signingKeyFingerprint,
        mobileEncryptionKeyId: identity.encryptionKeyId,
        mobileEncryptionPublicKey: identity.encryptionPublicKey,
        mobileEncryptionKeyFingerprint: identity.encryptionKeyFingerprint,
        transcriptProof: await signTranscript(cryptoValue, identity, transcript),
      };
      if (!parseDirectPairingClaimV1(claim)) throw new Error("pairing_claim_invalid");
      const claimEnvelope = await sealDirectPairingEnvelope({
        plaintext: new TextEncoder().encode(JSON.stringify(claim)),
        header: {
          protocolVersion: 1,
          envelopeId: randomIdentifier(cryptoValue, "pairing-envelope"),
          machineId: hello.machineId,
          deviceId: identity.deviceId,
          direction: "mobile-to-desktop",
          contentType: "pairing",
          createdAt: now().toISOString(),
          expiresAt: hello.expiresAt,
        },
        recipient: {
          keyId: hello.desktopEncryptionKeyId,
          publicKey: base64UrlDecode(hello.desktopEncryptionPublicKey, 65),
        },
      });
      await session.sendClaim(claimEnvelope, input.signal);
      const safetyCode = await deriveDirectPairingSafetyCode(transcript, (value) =>
        digest(cryptoValue, value),
      );

      return {
        pairingId: hello.pairingId,
        machineId: hello.machineId,
        machineDisplayName: hello.machineDisplayName,
        safetyCode,
        expiresAt: hello.expiresAt,
        async complete(signal): Promise<DirectConnectionProfile> {
          if (cancelled) throw new Error("pairing_cancelled");
          if (completeStarted) throw new Error("pairing_completion_in_progress");
          completeStarted = true;
          try {
            const resultEnvelope = await session.receiveResult(signal);
            if (!parseDirectSealedEnvelopeV1(resultEnvelope)) {
              throw new Error("pairing_response_invalid");
            }
            const plaintext = await openDirectRemoteEnvelope({
              envelope: resultEnvelope,
              expectedMachineId: hello.machineId,
              expectedDeviceId: identity.deviceId,
              expectedDirection: "desktop-to-mobile",
              senderPublicKey: base64UrlDecode(hello.desktopEncryptionPublicKey, 65),
              now: now(),
              resolveRecipientPrivateKey: (keyId) =>
                keyId === identity.encryptionKeyId
                  ? base64UrlDecode(identity.encryptionPrivateKey, 32)
                  : undefined,
            });
            const result = parseDirectPairingResultV1(jsonValue(plaintext));
            if (!result || result.pairingId !== hello.pairingId) {
              throw new Error("pairing_response_invalid");
            }
            if (result.state !== "confirmed") throw new Error(result.code);
            if (
              result.deviceId !== identity.deviceId ||
              !matchingIdentity(result.desktopIdentity, desktopIdentity(hello))
            ) {
              throw new Error("identity_mismatch");
            }
            const profile = createDirectConnectionProfile({
              desktop: result.desktopIdentity,
              deviceId: identity.deviceId,
              authorizationRevision: result.authorizationRevision,
              endpoints: result.approvedEndpoints,
              protocolRange: hello.protocolRange,
              approvedAt: now().toISOString(),
            });
            await options.secureStore.saveMachineKeys(hello.machineId, identity);
            try {
              await options.profileStore.save(profile);
            } catch (error) {
              await options.secureStore.clearMachine(hello.machineId);
              throw error;
            }
            session.close("pairing_complete");
            return profile;
          } catch (error) {
            session.close("pairing_failed");
            throw error;
          }
        },
        cancel(): void {
          if (cancelled || completeStarted) return;
          cancelled = true;
          session.close("pairing_cancelled");
        },
      };
    } catch (error) {
      session.close("pairing_failed");
      throw error;
    }
  };

  return {
    parseCode: (raw: string) => parseMobileDirectPairingCode(raw, now()),
    async beginQr(input: {
      readonly rawCode: string;
      readonly displayName: string;
      readonly platform: "ios" | "android";
      readonly signal?: AbortSignal;
    }): Promise<MobileDirectPairingPending> {
      const payload = parseMobileDirectPairingCode(input.rawCode, now());
      let lastError: Error = new Error("network_error");
      for (const endpoint of payload.endpoints) {
        try {
          return await begin({
            endpoint,
            secret: payload.pairingSecret,
            expectedPayload: payload,
            displayName: input.displayName,
            platform: input.platform,
            signal: input.signal,
          });
        } catch (error) {
          lastError = error instanceof Error ? error : new Error("network_error");
          if (
            input.signal?.aborted ||
            !["network_error", "pairing_connection_closed"].includes(lastError.message)
          ) {
            throw lastError;
          }
        }
      }
      throw lastError;
    },
    beginManual(input: {
      readonly host: string;
      readonly port: number;
      readonly manualCode: string;
      readonly displayName: string;
      readonly platform: "ios" | "android";
      readonly signal?: AbortSignal;
    }): Promise<MobileDirectPairingPending> {
      const kind = classifyDirectClientHost(input.host);
      if (!kind) return Promise.reject(new Error("endpoint_not_allowed"));
      return begin({
        endpoint: { kind, host: input.host, port: input.port },
        secret: input.manualCode.trim().toUpperCase(),
        displayName: input.displayName,
        platform: input.platform,
        signal: input.signal,
      });
    },
  };
}
