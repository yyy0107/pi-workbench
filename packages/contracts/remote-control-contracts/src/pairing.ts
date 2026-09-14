import { canonicalJson } from "../lib/canonical-json.ts";
import type { DirectEndpointV1, PairingPayloadV1, RemoteCursor } from "./protocol.ts";

export const PAIRING_DEFAULT_LIFETIME_MS = 2 * 60_000;
export const PAIRING_MAXIMUM_LIFETIME_MS = 5 * 60_000;
export const DIRECT_PAIRING_DEFAULT_LIFETIME_MS = 2 * 60_000;
export const DIRECT_PAIRING_MAXIMUM_LIFETIME_MS = 2 * 60_000;

export type PairingStateV1 =
  | "created"
  | "claimed"
  | "consumed"
  | "denied"
  | "expired"
  | "invalidated";

export type PairingStateEventV1 = "claim" | "confirm" | "reject" | "expire" | "invalidate";

export interface PairingTranscriptInputV1 {
  readonly accountId: string;
  readonly machineId: string;
  readonly pairingId: string;
  readonly phoneDeviceId: string;
  readonly desktopEncryptionKeyId: string;
  readonly desktopEncryptionKeyFingerprint: string;
  readonly mobileEncryptionKeyId: string;
  readonly mobileEncryptionKeyFingerprint: string;
  readonly mobileSigningKeyFingerprint: string;
  readonly protocolVersion: 1;
  readonly expiresAt: string;
}

export interface DirectPairingTranscriptInputV1 {
  readonly pairingId: string;
  readonly secretProof: string;
  readonly endpoint: DirectEndpointV1;
  readonly machineId: string;
  readonly machineDisplayName: string;
  readonly desktopEncryptionKeyId: string;
  readonly desktopEncryptionPublicKey: string;
  readonly desktopEncryptionKeyFingerprint: string;
  readonly phoneDeviceId: string;
  readonly mobileEncryptionKeyId: string;
  readonly mobileEncryptionKeyFingerprint: string;
  readonly mobileSigningKeyFingerprint: string;
  readonly protocolVersion: 1;
  readonly expiresAt: string;
}

export interface DirectSocketAuthenticationTranscriptInputV1 {
  readonly connectionId: string;
  readonly nonce: string;
  readonly machineId: string;
  readonly deviceId: string;
  readonly authorizationRevision: string;
  readonly endpoint: DirectEndpointV1;
  readonly protocolVersion: 1;
  readonly resume: {
    readonly cursor?: RemoteCursor;
    readonly unresolvedOperationIds: readonly string[];
  };
  readonly expiresAt: string;
}

export function createPairingExpiry(
  createdAt: Date,
  lifetimeMs = PAIRING_DEFAULT_LIFETIME_MS,
): string {
  if (
    !Number.isSafeInteger(lifetimeMs) ||
    lifetimeMs <= 0 ||
    lifetimeMs > PAIRING_MAXIMUM_LIFETIME_MS
  ) {
    throw new RangeError("Pairing invitation lifetime cannot exceed five minutes");
  }
  const created = createdAt.getTime();
  if (!Number.isFinite(created)) throw new RangeError("Pairing creation time is invalid");
  return new Date(created + lifetimeMs).toISOString();
}

export function createDirectPairingExpiry(
  createdAt: Date,
  lifetimeMs = DIRECT_PAIRING_DEFAULT_LIFETIME_MS,
): string {
  if (
    !Number.isSafeInteger(lifetimeMs) ||
    lifetimeMs <= 0 ||
    lifetimeMs > DIRECT_PAIRING_MAXIMUM_LIFETIME_MS
  ) {
    throw new RangeError("Direct pairing invitation lifetime cannot exceed two minutes");
  }
  const created = createdAt.getTime();
  if (!Number.isFinite(created)) throw new RangeError("Direct pairing creation time is invalid");
  return new Date(created + lifetimeMs).toISOString();
}

export function assertPairingPayloadFresh(payload: PairingPayloadV1, now: Date): void {
  if (!Number.isFinite(now.getTime()) || Date.parse(payload.expiresAt) <= now.getTime()) {
    throw new Error("Pairing invitation expired");
  }
}

export function canonicalPairingTranscript(input: PairingTranscriptInputV1): string {
  return canonicalJson({
    type: "workbench.remote.pairing-transcript",
    version: 1,
    accountId: input.accountId,
    machineId: input.machineId,
    pairingId: input.pairingId,
    phoneDeviceId: input.phoneDeviceId,
    desktopEncryptionKeyId: input.desktopEncryptionKeyId,
    desktopEncryptionKeyFingerprint: input.desktopEncryptionKeyFingerprint,
    mobileEncryptionKeyId: input.mobileEncryptionKeyId,
    mobileEncryptionKeyFingerprint: input.mobileEncryptionKeyFingerprint,
    mobileSigningKeyFingerprint: input.mobileSigningKeyFingerprint,
    protocolVersion: input.protocolVersion,
    expiresAt: input.expiresAt,
  });
}

export function canonicalDirectPairingTranscript(input: DirectPairingTranscriptInputV1): string {
  return canonicalJson({
    type: "workbench.remote.direct-pairing-transcript",
    version: 1,
    pairingId: input.pairingId,
    secretProof: input.secretProof,
    endpoint: input.endpoint,
    machineId: input.machineId,
    machineDisplayName: input.machineDisplayName,
    desktopEncryptionKeyId: input.desktopEncryptionKeyId,
    desktopEncryptionPublicKey: input.desktopEncryptionPublicKey,
    desktopEncryptionKeyFingerprint: input.desktopEncryptionKeyFingerprint,
    phoneDeviceId: input.phoneDeviceId,
    mobileEncryptionKeyId: input.mobileEncryptionKeyId,
    mobileEncryptionKeyFingerprint: input.mobileEncryptionKeyFingerprint,
    mobileSigningKeyFingerprint: input.mobileSigningKeyFingerprint,
    protocolVersion: input.protocolVersion,
    expiresAt: input.expiresAt,
  });
}

export function canonicalDirectSocketAuthenticationTranscript(
  input: DirectSocketAuthenticationTranscriptInputV1,
): string {
  return canonicalJson({
    type: "workbench.remote.direct-socket-authentication",
    version: 1,
    connectionId: input.connectionId,
    nonce: input.nonce,
    machineId: input.machineId,
    deviceId: input.deviceId,
    authorizationRevision: input.authorizationRevision,
    endpoint: input.endpoint,
    protocolVersion: input.protocolVersion,
    resume: input.resume,
    expiresAt: input.expiresAt,
  });
}

export async function derivePairingSafetyCode(
  canonicalTranscript: string,
  digest: (value: Uint8Array) => Promise<Uint8Array>,
): Promise<string> {
  const bytes = await digest(new TextEncoder().encode(canonicalTranscript));
  if (bytes.byteLength < 4) throw new Error("Pairing transcript digest is too short");
  const numeric =
    (((bytes[0] ?? 0) * 0x1_00_00_00 +
      (bytes[1] ?? 0) * 0x1_00_00 +
      (bytes[2] ?? 0) * 0x1_00 +
      (bytes[3] ?? 0)) >>>
      0) %
    1_000_000;
  const code = numeric.toString().padStart(6, "0");
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

export function advancePairingState(
  state: PairingStateV1,
  event: PairingStateEventV1,
): PairingStateV1 {
  if (state === "created") {
    if (event === "claim") return "claimed";
    if (event === "reject") return "denied";
    if (event === "expire") return "expired";
    if (event === "invalidate") return "invalidated";
  }
  if (state === "claimed") {
    if (event === "confirm") return "consumed";
    if (event === "reject") return "denied";
    if (event === "expire") return "expired";
    if (event === "invalidate") return "invalidated";
  }
  throw new Error(`invalid pairing transition: ${state} -> ${event}`);
}
