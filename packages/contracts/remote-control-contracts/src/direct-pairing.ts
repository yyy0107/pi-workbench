import { canonicalJson } from "../lib/canonical-json.ts";
import type { DirectEndpointV1, RemoteCursor } from "./protocol.ts";

export const DIRECT_PAIRING_DEFAULT_LIFETIME_MS = 2 * 60_000;
export const DIRECT_PAIRING_MAXIMUM_LIFETIME_MS = 2 * 60_000;

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

export async function deriveDirectPairingSafetyCode(
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
