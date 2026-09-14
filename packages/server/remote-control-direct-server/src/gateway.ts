import {
  parseDirectPairingClaimV1,
  parseDirectSealedEnvelopeV1,
} from "@workbench/remote-control-contracts/codecs";
import {
  openDirectPairingEnvelope,
  sealDirectRemoteEnvelope,
} from "@workbench/remote-control-contracts/direct-crypto";
import type {
  DirectEndpointV1,
  DirectPairingClaimV1,
  DirectPairingPayloadV1,
  DirectPairingResultV1,
} from "@workbench/remote-control-contracts/protocol";

import { parseAllowedDirectEndpoint } from "./address-policy.ts";
import { DirectGatewayError } from "./errors.ts";
import { DIRECT_SERVER_LIMITS } from "./lib/limits.ts";
import {
  createDirectPairingService,
  type DirectAuthorizationStore,
  type DirectPairingClock,
  type DirectPairingService,
  type DirectPairingView,
} from "./pairing-service.ts";
import { createDirectAuthenticationService } from "./authentication.ts";
import type {
  DesktopInstallationIdentity,
  DirectBusinessFramePort,
  DirectPairingApprovalPort,
  DirectSocketPort,
} from "./ports.ts";
import {
  createBoundedDirectSocketSession,
  type BoundedDirectSocketSession,
} from "./socket-session.ts";

export type DirectSocketMode = "pairing" | "authenticated";

export interface DirectRemoteGateway {
  accept(socket: DirectSocketPort, endpoint: DirectEndpointV1, mode: DirectSocketMode): void;
  createPairing(): DirectPairingPayloadV1;
  getPairing(pairingId: string): DirectPairingView;
  confirmPairing(pairingId: string, safetyCode: string): Promise<DirectPairingResultV1>;
  rejectPairing(pairingId: string): Promise<void>;
  cancelPairing(pairingId: string): void;
  revokeDevice(deviceId: string): void;
  dispose(): void;
}

interface PendingPairingConnection {
  readonly claim: DirectPairingClaimV1;
  readonly session: BoundedDirectSocketSession;
}

function decodeBase64Url(value: string, expectedBytes: number): Uint8Array {
  const bytes = new Uint8Array(Buffer.from(value, "base64url"));
  if (bytes.byteLength !== expectedBytes || Buffer.from(bytes).toString("base64url") !== value) {
    throw new DirectGatewayError("invalid_frame");
  }
  return bytes;
}

function decodeJson(value: Uint8Array): unknown {
  if (value.byteLength > DIRECT_SERVER_LIMITS.preAuthenticationFrameBytes) {
    throw new DirectGatewayError("payload_too_large");
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(value)) as unknown;
  } catch {
    throw new DirectGatewayError("invalid_frame");
  }
}

export function createDirectRemoteGateway(options: {
  readonly installation: DesktopInstallationIdentity;
  readonly endpoints: () => readonly DirectEndpointV1[];
  readonly clock: DirectPairingClock;
  readonly randomBytes: (size: number) => Uint8Array;
  readonly authorizationStore: DirectAuthorizationStore;
  readonly approval: DirectPairingApprovalPort;
  readonly business?: DirectBusinessFramePort;
  readonly epoch?: string;
}): DirectRemoteGateway {
  const pairing: DirectPairingService = createDirectPairingService(options);
  const sessions = new Set<BoundedDirectSocketSession>();
  const sessionsByAddress = new Map<string, number>();
  const pendingPairings = new Map<string, PendingPairingConnection>();
  let disposed = false;
  const authentication = createDirectAuthenticationService({
    installation: options.installation,
    endpointAllowed: (candidate) =>
      options
        .endpoints()
        .some(
          (endpoint) =>
            endpoint.kind === candidate.kind &&
            endpoint.host.toLowerCase() === candidate.host.toLowerCase() &&
            endpoint.port === candidate.port,
        ),
    clock: options.clock,
    randomBytes: options.randomBytes,
    authorizationStore: {
      listAuthorizations: options.authorizationStore.list,
      replaceAuthorizations: options.authorizationStore.replace,
    },
    business: options.business,
    epoch: options.epoch ?? `epoch-${Buffer.from(options.randomBytes(16)).toString("base64url")}`,
  });

  const removeSession = (session: BoundedDirectSocketSession, remoteAddress: string): void => {
    sessions.delete(session);
    const count = sessionsByAddress.get(remoteAddress) ?? 0;
    if (count <= 1) sessionsByAddress.delete(remoteAddress);
    else sessionsByAddress.set(remoteAddress, count - 1);
    for (const [pairingId, pending] of pendingPairings) {
      if (pending.session === session) pendingPairings.delete(pairingId);
    }
  };

  const sendResult = async (
    pairingId: string,
    result: DirectPairingResultV1,
    finishReason: "pairing_complete" | "pairing_denied",
  ): Promise<void> => {
    const pending = pendingPairings.get(pairingId);
    if (!pending || pending.session.closed) return;
    const now = options.clock.now();
    const envelope = await sealDirectRemoteEnvelope({
      plaintext: new TextEncoder().encode(JSON.stringify(result)),
      header: {
        protocolVersion: 1,
        envelopeId: `pairing-result-${Buffer.from(options.randomBytes(16)).toString("base64url")}`,
        machineId: options.installation.machineId,
        deviceId: pending.claim.deviceId,
        direction: "desktop-to-mobile",
        contentType: "pairing",
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 30_000).toISOString(),
      },
      recipient: {
        keyId: pending.claim.mobileEncryptionKeyId,
        publicKey: decodeBase64Url(pending.claim.mobileEncryptionPublicKey, 65),
      },
      senderPrivateKey: decodeBase64Url(options.installation.encryptionPrivateKey, 32),
    });
    await pending.session.send(envelope);
    pendingPairings.delete(pairingId);
    pending.session.finish(finishReason);
  };

  return {
    accept(socket, endpointInput, mode): void {
      if (disposed) {
        socket.close(1008, "listener_disabled");
        return;
      }
      const endpoint = parseAllowedDirectEndpoint(endpointInput);
      if (mode === "authenticated") {
        authentication.accept(socket, endpoint);
        return;
      }
      const remoteAddress = socket.remoteAddress ?? "unknown";
      const addressCount = sessionsByAddress.get(remoteAddress) ?? 0;
      if (
        sessions.size >= DIRECT_SERVER_LIMITS.maximumConnections ||
        addressCount >= DIRECT_SERVER_LIMITS.maximumConnectionsPerAddress
      ) {
        socket.close(1008, "rate_limited");
        return;
      }
      let session: BoundedDirectSocketSession;
      session = createBoundedDirectSocketSession({
        socket,
        maximumFrameBytes: DIRECT_SERVER_LIMITS.preAuthenticationFrameBytes,
        maximumFrames: DIRECT_SERVER_LIMITS.maximumPairingFrames,
        onClose: () => removeSession(session, remoteAddress),
        onFrame: async (value, current) => {
          const envelope = parseDirectSealedEnvelopeV1(value);
          if (
            !envelope ||
            envelope.contentType !== "pairing" ||
            envelope.direction !== "mobile-to-desktop" ||
            envelope.machineId !== options.installation.machineId ||
            envelope.keyId !== options.installation.encryptionKeyId ||
            [...pendingPairings.values()].some((pending) => pending.session === current)
          ) {
            current.close("invalid_frame");
            return;
          }
          const plaintext = await openDirectPairingEnvelope({
            envelope,
            expectedMachineId: options.installation.machineId,
            expectedDeviceId: envelope.deviceId,
            expectedDirection: "mobile-to-desktop",
            now: options.clock.now(),
            resolveRecipientPrivateKey: (keyId) =>
              keyId === options.installation.encryptionKeyId
                ? decodeBase64Url(options.installation.encryptionPrivateKey, 32)
                : undefined,
          });
          const claim = parseDirectPairingClaimV1(decodeJson(plaintext));
          if (!claim || claim.deviceId !== envelope.deviceId) {
            current.close("invalid_frame");
            return;
          }
          await pairing.claim({ claim, endpoint });
          pendingPairings.set(claim.pairingId, { claim, session: current });
        },
      });
      sessions.add(session);
      sessionsByAddress.set(remoteAddress, addressCount + 1);
      void session.send(pairing.getHello(endpoint)).catch(() => session.close("invalid_frame"));
    },
    createPairing: () => pairing.createInvitation(),
    getPairing: (pairingId) => pairing.describe(pairingId),
    async confirmPairing(pairingId, safetyCode): Promise<DirectPairingResultV1> {
      const result = await pairing.confirm(pairingId, safetyCode);
      await sendResult(pairingId, result, "pairing_complete");
      return result;
    },
    async rejectPairing(pairingId): Promise<void> {
      pairing.reject(pairingId);
      await sendResult(
        pairingId,
        { type: "direct.pairing.result", pairingId, state: "denied", code: "pairing_denied" },
        "pairing_denied",
      );
    },
    cancelPairing(pairingId): void {
      pairing.cancel(pairingId);
      const pending = pendingPairings.get(pairingId);
      pendingPairings.delete(pairingId);
      pending?.session.close("listener_disabled");
    },
    revokeDevice(deviceId): void {
      authentication.revokeDevice(deviceId);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      pairing.dispose();
      authentication.dispose();
      pendingPairings.clear();
      for (const session of [...sessions]) session.dispose();
      sessions.clear();
      sessionsByAddress.clear();
    },
  };
}
