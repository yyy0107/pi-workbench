import { createHash, createPublicKey, timingSafeEqual, verify } from "node:crypto";

import {
  parseDirectPairingClaimV1,
  parseDirectPairingPayloadV1,
} from "@workbench/remote-control-contracts/codecs";
import {
  canonicalDirectPairingTranscript,
  createDirectPairingExpiry,
  deriveDirectPairingSafetyCode,
} from "@workbench/remote-control-contracts/direct-pairing";
import type {
  DirectEndpointV1,
  DirectPairingClaimV1,
  DirectPairingHelloV1,
  DirectPairingPayloadV1,
  DirectPairingResultV1,
  RemoteAction,
} from "@workbench/remote-control-contracts/protocol";

import { parseAllowedDirectEndpoint } from "./address-policy.ts";
import { DirectGatewayError, type DirectGatewayErrorCode } from "./errors.ts";
import { DIRECT_SERVER_LIMITS } from "./lib/limits.ts";
import type {
  DesktopInstallationIdentity,
  DirectPairingApprovalPort,
  PairedPhoneAuthorization,
} from "./ports.ts";
import type { DirectPairingState } from "./types.ts";

const BASE32_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DIRECT_SCOPE: readonly RemoteAction[] = Object.freeze([
  "sessions.read",
  "sessions.create",
  "sessions.send",
  "sessions.stop",
  "sessions.organize",
  "interactions.respond",
]);

export interface DirectPairingClock {
  now(): Date;
}

export interface DirectAuthorizationStore {
  list(): Promise<readonly PairedPhoneAuthorization[]>;
  replace(value: readonly PairedPhoneAuthorization[]): Promise<void>;
}

export interface DirectPairingServiceOptions {
  readonly installation: DesktopInstallationIdentity;
  readonly endpoints: () => readonly DirectEndpointV1[];
  readonly clock: DirectPairingClock;
  readonly randomBytes: (size: number) => Uint8Array;
  readonly authorizationStore: DirectAuthorizationStore;
  readonly approval: DirectPairingApprovalPort;
}

type InternalPairingState = DirectPairingState | "verifying";

interface InvitationRecord {
  readonly pairingId: string;
  readonly secretVerifier: string;
  readonly manualCodeVerifier: string;
  readonly offeredEndpoints: readonly DirectEndpointV1[];
  readonly expiresAt: string;
  attemptsRemaining: number;
  state: InternalPairingState;
  claim?: DirectPairingClaimV1;
  claimedEndpoint?: DirectEndpointV1;
  safetyCode?: string;
}

export interface DirectPairingView {
  readonly pairingId: string;
  readonly state: DirectPairingState;
  readonly attemptsRemaining: number;
  readonly expiresAt: string;
  readonly deviceId?: string;
  readonly deviceDisplayName?: string;
  readonly platform?: "ios" | "android";
  readonly safetyCode?: string;
}

export interface DirectPairingService {
  createInvitation(): DirectPairingPayloadV1;
  getHello(endpoint: DirectEndpointV1): DirectPairingHelloV1;
  describe(pairingId: string): DirectPairingView;
  claim(input: {
    readonly claim: DirectPairingClaimV1;
    readonly endpoint: DirectEndpointV1;
  }): Promise<{ readonly pairingId: string; readonly safetyCode: string }>;
  confirm(pairingId: string, safetyCode: string): Promise<DirectPairingResultV1>;
  reject(pairingId: string): void;
  cancel(pairingId: string): void;
  dispose(): void;
}

function encodeBase32(bytes: Uint8Array): string {
  let output = "";
  let accumulator = 0;
  let bitCount = 0;
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      output += BASE32_ALPHABET[(accumulator >>> bitCount) & 31];
    }
  }
  if (bitCount > 0) output += BASE32_ALPHABET[(accumulator << (5 - bitCount)) & 31];
  return output;
}

function digestBytes(value: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(value).digest());
}

function digest(value: string): Uint8Array {
  return digestBytes(new TextEncoder().encode(value));
}

export function createDirectSecretProof(secret: string): string {
  return Buffer.from(digest(secret)).toString("base64url");
}

function equalProof(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

function sameEndpoint(left: DirectEndpointV1, right: DirectEndpointV1): boolean {
  return left.kind === right.kind && left.host === right.host && left.port === right.port;
}

function idFromRandom(randomBytes: (size: number) => Uint8Array, size: number): string {
  const bytes = randomBytes(size);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== size) {
    throw new Error("Direct pairing random source returned an invalid byte count");
  }
  return Buffer.from(bytes).toString("base64url");
}

function publicIdentity(installation: DesktopInstallationIdentity) {
  return {
    machineId: installation.machineId,
    machineDisplayName: installation.displayName,
    desktopEncryptionKeyId: installation.encryptionKeyId,
    desktopEncryptionPublicKey: installation.encryptionPublicKey,
    desktopEncryptionKeyFingerprint: installation.fingerprint,
  } as const;
}

function publicState(state: InternalPairingState): DirectPairingState {
  return state === "verifying" ? "created" : state;
}

export function createDirectPairingService(
  options: DirectPairingServiceOptions,
): DirectPairingService {
  const invitations = new Map<string, InvitationRecord>();
  let activePairingId: string | undefined;
  let disposed = false;

  const requireInvitation = (pairingId: string): InvitationRecord => {
    const invitation = invitations.get(pairingId);
    if (!invitation || disposed) throw new DirectGatewayError("pairing_unavailable");
    return invitation;
  };

  const expireIfNeeded = (invitation: InvitationRecord): void => {
    if (
      ["created", "verifying", "claimed"].includes(invitation.state) &&
      options.clock.now().getTime() >= Date.parse(invitation.expiresAt)
    ) {
      invitation.state = "expired";
      if (activePairingId === invitation.pairingId) activePairingId = undefined;
    }
  };

  const failAttempt = (
    invitation: InvitationRecord,
    code: DirectGatewayErrorCode = "pairing_secret_invalid",
  ): never => {
    invitation.attemptsRemaining -= 1;
    if (invitation.attemptsRemaining <= 0) {
      invitation.state = "locked";
      if (activePairingId === invitation.pairingId) activePairingId = undefined;
      throw new DirectGatewayError("pairing_locked");
    }
    invitation.state = "created";
    throw new DirectGatewayError(code);
  };

  return {
    createInvitation(): DirectPairingPayloadV1 {
      if (disposed) throw new DirectGatewayError("listener_disabled");
      if (activePairingId) {
        const previous = invitations.get(activePairingId);
        if (previous && ["created", "verifying", "claimed"].includes(previous.state)) {
          previous.state = "cancelled";
        }
      }
      const endpoints = options.endpoints().map(parseAllowedDirectEndpoint);
      if (endpoints.length < 1 || endpoints.length > 8) {
        throw new DirectGatewayError("endpoint_not_allowed");
      }
      const pairingId = idFromRandom(options.randomBytes, 16);
      const pairingSecret = idFromRandom(options.randomBytes, 32);
      const manualCode = encodeBase32(options.randomBytes(5));
      const expiresAt = createDirectPairingExpiry(options.clock.now());
      const payload: DirectPairingPayloadV1 = {
        type: "workbench.remote.direct-pairing",
        version: 1,
        pairingId,
        pairingSecret,
        manualCode,
        ...publicIdentity(options.installation),
        endpoints,
        protocolRange: { min: 1, max: 1 },
        expiresAt,
      };
      if (!parseDirectPairingPayloadV1(payload)) {
        throw new DirectGatewayError("invalid_frame");
      }
      invitations.set(pairingId, {
        pairingId,
        secretVerifier: createDirectSecretProof(pairingSecret),
        manualCodeVerifier: createDirectSecretProof(manualCode),
        offeredEndpoints: endpoints,
        expiresAt,
        attemptsRemaining: DIRECT_SERVER_LIMITS.pairingAttempts,
        state: "created",
      });
      activePairingId = pairingId;
      return payload;
    },
    getHello(endpoint): DirectPairingHelloV1 {
      if (!activePairingId) throw new DirectGatewayError("pairing_unavailable");
      const invitation = requireInvitation(activePairingId);
      expireIfNeeded(invitation);
      if (invitation.state !== "created") throw new DirectGatewayError("pairing_unavailable");
      const canonicalEndpoint = parseAllowedDirectEndpoint(endpoint);
      if (!invitation.offeredEndpoints.some((item) => sameEndpoint(item, canonicalEndpoint))) {
        throw new DirectGatewayError("endpoint_not_allowed");
      }
      return {
        type: "direct.pairing.hello",
        version: 1,
        pairingId: invitation.pairingId,
        ...publicIdentity(options.installation),
        endpoint: canonicalEndpoint,
        protocolRange: { min: 1, max: 1 },
        expiresAt: invitation.expiresAt,
      };
    },
    describe(pairingId): DirectPairingView {
      const invitation = requireInvitation(pairingId);
      expireIfNeeded(invitation);
      return {
        pairingId,
        state: publicState(invitation.state),
        attemptsRemaining: invitation.attemptsRemaining,
        expiresAt: invitation.expiresAt,
        ...(invitation.claim
          ? {
              deviceId: invitation.claim.deviceId,
              deviceDisplayName: invitation.claim.deviceDisplayName,
              platform: invitation.claim.platform,
            }
          : {}),
        ...(invitation.safetyCode ? { safetyCode: invitation.safetyCode } : {}),
      };
    },
    async claim({ claim, endpoint }) {
      const invitation = requireInvitation(claim.pairingId);
      expireIfNeeded(invitation);
      if (invitation.state === "expired") throw new DirectGatewayError("pairing_expired");
      if (invitation.state === "locked") throw new DirectGatewayError("pairing_locked");
      if (invitation.state !== "created") throw new DirectGatewayError("pairing_unavailable");
      invitation.state = "verifying";

      const parsedCandidate = parseDirectPairingClaimV1(claim);
      const canonicalEndpoint = parseAllowedDirectEndpoint(endpoint);
      if (!parsedCandidate) return failAttempt(invitation);
      const parsedClaim = parsedCandidate;
      if (
        !invitation.offeredEndpoints.some((item) => sameEndpoint(item, canonicalEndpoint)) ||
        (!equalProof(claim.secretProof, invitation.secretVerifier) &&
          !equalProof(claim.secretProof, invitation.manualCodeVerifier))
      ) {
        failAttempt(invitation);
      }

      const transcript = canonicalDirectPairingTranscript({
        pairingId: invitation.pairingId,
        secretProof: parsedClaim.secretProof,
        endpoint: canonicalEndpoint,
        ...publicIdentity(options.installation),
        phoneDeviceId: parsedClaim.deviceId,
        mobileEncryptionKeyId: parsedClaim.mobileEncryptionKeyId,
        mobileEncryptionKeyFingerprint: parsedClaim.mobileEncryptionKeyFingerprint,
        mobileSigningKeyFingerprint: parsedClaim.mobileSigningKeyFingerprint,
        protocolVersion: 1,
        expiresAt: invitation.expiresAt,
      });

      let signatureValid = false;
      try {
        const key = createPublicKey({
          key: {
            kty: parsedClaim.mobileSigningPublicJwk.kty,
            crv: parsedClaim.mobileSigningPublicJwk.crv,
            x: parsedClaim.mobileSigningPublicJwk.x,
            y: parsedClaim.mobileSigningPublicJwk.y,
            ...(parsedClaim.mobileSigningPublicJwk.key_ops
              ? { key_ops: [...parsedClaim.mobileSigningPublicJwk.key_ops] }
              : {}),
            ...(parsedClaim.mobileSigningPublicJwk.ext !== undefined
              ? { ext: parsedClaim.mobileSigningPublicJwk.ext }
              : {}),
          },
          format: "jwk",
        });
        const signature = Buffer.from(parsedClaim.transcriptProof, "base64url");
        signatureValid =
          verify("sha256", Buffer.from(transcript, "utf8"), key, signature) ||
          verify(
            "sha256",
            Buffer.from(transcript, "utf8"),
            { key, dsaEncoding: "ieee-p1363" },
            signature,
          );
      } catch {
        signatureValid = false;
      }
      if (!signatureValid) failAttempt(invitation, "authentication_failed");

      const safetyCode = await deriveDirectPairingSafetyCode(transcript, async (value) =>
        digestBytes(value),
      );
      invitation.claim = parsedClaim;
      invitation.claimedEndpoint = canonicalEndpoint;
      invitation.safetyCode = safetyCode;
      invitation.state = "claimed";
      options.approval.publishClaim({
        pairingId: invitation.pairingId,
        deviceId: parsedClaim.deviceId,
        deviceDisplayName: parsedClaim.deviceDisplayName,
        platform: parsedClaim.platform,
        safetyCode,
        expiresAt: invitation.expiresAt,
      });
      return { pairingId: invitation.pairingId, safetyCode };
    },
    async confirm(pairingId, safetyCode): Promise<DirectPairingResultV1> {
      const invitation = requireInvitation(pairingId);
      expireIfNeeded(invitation);
      if (invitation.state === "expired") throw new DirectGatewayError("pairing_expired");
      if (
        invitation.state !== "claimed" ||
        !invitation.claim ||
        !invitation.claimedEndpoint ||
        !invitation.safetyCode
      ) {
        throw new DirectGatewayError("pairing_unavailable");
      }
      if (!equalProof(safetyCode, invitation.safetyCode)) {
        throw new DirectGatewayError("identity_mismatch");
      }
      const claim = invitation.claim;
      const authorizationRevision = idFromRandom(options.randomBytes, 16);
      const authorization: PairedPhoneAuthorization = {
        deviceId: claim.deviceId,
        displayName: claim.deviceDisplayName,
        platform: claim.platform,
        signingPublicKey: { ...claim.mobileSigningPublicJwk },
        signingKeyFingerprint: claim.mobileSigningKeyFingerprint,
        encryptionKeyId: claim.mobileEncryptionKeyId,
        encryptionPublicKey: claim.mobileEncryptionPublicKey,
        encryptionKeyFingerprint: claim.mobileEncryptionKeyFingerprint,
        scope: DIRECT_SCOPE,
        revision: authorizationRevision,
        createdAt: options.clock.now().toISOString(),
      };
      const existing = await options.authorizationStore.list();
      await options.authorizationStore.replace([
        ...existing.filter((item) => item.deviceId !== authorization.deviceId),
        authorization,
      ]);
      invitation.state = "consumed";
      activePairingId = activePairingId === pairingId ? undefined : activePairingId;
      return {
        type: "direct.pairing.result",
        pairingId,
        state: "confirmed",
        deviceId: claim.deviceId,
        authorizationRevision,
        scope: DIRECT_SCOPE,
        desktopIdentity: publicIdentity(options.installation),
        approvedEndpoints: invitation.offeredEndpoints,
      };
    },
    reject(pairingId): void {
      const invitation = requireInvitation(pairingId);
      expireIfNeeded(invitation);
      if (!["created", "claimed"].includes(invitation.state)) {
        throw new DirectGatewayError("pairing_unavailable");
      }
      invitation.state = "denied";
      activePairingId = activePairingId === pairingId ? undefined : activePairingId;
    },
    cancel(pairingId): void {
      const invitation = requireInvitation(pairingId);
      if (!["created", "claimed"].includes(invitation.state)) {
        throw new DirectGatewayError("pairing_unavailable");
      }
      invitation.state = "cancelled";
      activePairingId = activePairingId === pairingId ? undefined : activePairingId;
    },
    dispose(): void {
      disposed = true;
      activePairingId = undefined;
      for (const invitation of invitations.values()) {
        if (["created", "verifying", "claimed"].includes(invitation.state)) {
          invitation.state = "cancelled";
        }
      }
      invitations.clear();
    },
  };
}
