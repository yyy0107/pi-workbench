import { createPublicKey, verify } from "node:crypto";

import {
  negotiateRemoteProtocolVersion,
  parseDirectSealedEnvelopeV1,
  parseDirectSocketAuthenticateV1,
  remoteUtf8ByteLength,
} from "@workbench/remote-control-contracts/codecs";
import { canonicalDirectSocketAuthenticationTranscript } from "@workbench/remote-control-contracts/direct-pairing";
import type {
  DirectEndpointV1,
  DirectSocketAuthenticatedV1,
  DirectSocketChallengeV1,
  RemoteErrorCodeV1,
} from "@workbench/remote-control-contracts/protocol";

import { DirectGatewayError } from "./errors.ts";
import { DIRECT_SERVER_LIMITS } from "./lib/limits.ts";
import { createDirectReplayCache } from "../lib/replay-cache.ts";
import type {
  DesktopInstallationIdentity,
  DirectBusinessFramePort,
  DirectInstallationStorePort,
  DirectSocketPort,
  Disposable,
  PairedPhoneAuthorization,
} from "./ports.ts";

const MAXIMUM_FRAMES_PER_WINDOW = 240;
const RATE_WINDOW_MS = 60_000;

interface AuthenticatedConnection {
  readonly socket: DirectSocketPort;
  readonly remoteAddress: string;
  close(reason: string): void;
}

function encodedRandom(randomBytes: (size: number) => Uint8Array, size: number): string {
  return Buffer.from(randomBytes(size)).toString("base64url");
}

function encodedSignature(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]+$/u.test(value) || value.length % 4 === 1) return undefined;
  const result = Buffer.from(value, "base64url");
  return result.toString("base64url") === value ? result : undefined;
}

function validProof(authorization: PairedPhoneAuthorization, transcript: string, proof: string) {
  try {
    const signature = encodedSignature(proof);
    if (!signature) return false;
    const key = createPublicKey({
      key: {
        kty: authorization.signingPublicKey.kty,
        crv: authorization.signingPublicKey.crv,
        x: authorization.signingPublicKey.x,
        y: authorization.signingPublicKey.y,
        ...(authorization.signingPublicKey.key_ops
          ? { key_ops: [...authorization.signingPublicKey.key_ops] }
          : {}),
        ...(authorization.signingPublicKey.ext === undefined
          ? {}
          : { ext: authorization.signingPublicKey.ext }),
      },
      format: "jwk",
    });
    return (
      verify("sha256", Buffer.from(transcript, "utf8"), key, signature) ||
      verify(
        "sha256",
        Buffer.from(transcript, "utf8"),
        { key, dsaEncoding: "ieee-p1363" },
        signature,
      )
    );
  } catch {
    return false;
  }
}

function remoteError(code: RemoteErrorCodeV1) {
  return { type: "remote.error", version: 1, code } as const;
}

export interface DirectAuthenticationService extends Disposable {
  accept(socket: DirectSocketPort, endpoint: DirectEndpointV1): void;
  revokeDevice(deviceId: string): void;
  closeAll(reason?: "listener_disabled" | "authentication_failed"): void;
}

export function createDirectAuthenticationService(options: {
  readonly installation: DesktopInstallationIdentity;
  readonly endpointAllowed: (endpoint: DirectEndpointV1) => boolean;
  readonly clock: { now(): Date };
  readonly randomBytes: (size: number) => Uint8Array;
  readonly authorizationStore: Pick<
    DirectInstallationStorePort,
    "listAuthorizations" | "replaceAuthorizations"
  >;
  readonly business?: DirectBusinessFramePort;
  readonly epoch: string;
}): DirectAuthenticationService {
  const connections = new Set<AuthenticatedConnection>();
  const byDevice = new Map<string, Set<AuthenticatedConnection>>();
  const byAddress = new Map<string, number>();
  const replay = createDirectReplayCache({ now: options.clock.now, maximumEntries: 4096 });
  let disposed = false;

  const currentAuthorization = async (
    deviceId: string,
    revision?: string,
  ): Promise<PairedPhoneAuthorization> => {
    const value = (await options.authorizationStore.listAuthorizations()).find(
      (item) => item.deviceId === deviceId,
    );
    if (!value) throw new DirectGatewayError("device_not_paired");
    if (value.revokedAt) throw new DirectGatewayError("device_revoked");
    if (revision !== undefined && value.revision !== revision) {
      throw new DirectGatewayError("authorization_revision_changed");
    }
    return value;
  };

  return {
    accept(socket, endpoint): void {
      if (disposed || !options.endpointAllowed(endpoint)) {
        socket.close(1008, "listener_disabled");
        return;
      }
      const remoteAddress = socket.remoteAddress ?? "unknown";
      const addressCount = byAddress.get(remoteAddress) ?? 0;
      if (
        connections.size >= DIRECT_SERVER_LIMITS.maximumConnections ||
        addressCount >= DIRECT_SERVER_LIMITS.maximumConnectionsPerAddress
      ) {
        socket.close(1008, "rate_limited");
        return;
      }
      const subscriptions: Disposable[] = [];
      const connectionId = `connection-${encodedRandom(options.randomBytes, 16)}`;
      const nonce = encodedRandom(options.randomBytes, 32);
      const expiresAt = new Date(
        options.clock.now().getTime() + DIRECT_SERVER_LIMITS.challengeLifetimeMs,
      ).toISOString();
      const challenge: DirectSocketChallengeV1 = {
        type: "direct.socket.challenge",
        version: 1,
        connectionId,
        nonce,
        machineId: options.installation.machineId,
        desktopEncryptionKeyId: options.installation.encryptionKeyId,
        desktopEncryptionKeyFingerprint: options.installation.fingerprint,
        endpoint,
        protocolRange: { min: 1, max: 1 },
        expiresAt,
      };
      let state: "challenged" | "authenticated" | "closed" = "challenged";
      let authorization: PairedPhoneAuthorization | undefined;
      let businessSubscription: Disposable | undefined;
      let operation = Promise.resolve();
      let frameWindowStartedAt = options.clock.now().getTime();
      let frameCount = 0;
      const timer = setTimeout(
        () => close("authentication_failed"),
        DIRECT_SERVER_LIMITS.challengeLifetimeMs,
      );
      timer.unref?.();

      const send = async (value: unknown) => {
        const frame = JSON.stringify(value);
        if (remoteUtf8ByteLength(frame) > DIRECT_SERVER_LIMITS.sealedFrameBytes) {
          throw new DirectGatewayError("payload_too_large");
        }
        await socket.send(frame);
      };
      const connection: AuthenticatedConnection = {
        socket,
        remoteAddress,
        close: (reason) => close(reason),
      };
      const close = (reason: string) => {
        if (state === "closed") return;
        state = "closed";
        clearTimeout(timer);
        while (subscriptions.length > 0) subscriptions.pop()?.dispose();
        void businessSubscription?.dispose();
        connections.delete(connection);
        const remainingAtAddress = (byAddress.get(remoteAddress) ?? 1) - 1;
        if (remainingAtAddress <= 0) byAddress.delete(remoteAddress);
        else byAddress.set(remoteAddress, remainingAtAddress);
        if (authorization) {
          const values = byDevice.get(authorization.deviceId);
          values?.delete(connection);
          if (values?.size === 0) byDevice.delete(authorization.deviceId);
        }
        socket.close(1008, reason);
      };
      const handle = async (value: unknown) => {
        const now = options.clock.now().getTime();
        if (now - frameWindowStartedAt >= RATE_WINDOW_MS) {
          frameWindowStartedAt = now;
          frameCount = 0;
        }
        frameCount += 1;
        if (frameCount > MAXIMUM_FRAMES_PER_WINDOW) {
          close("rate_limited");
          return;
        }
        if (state === "challenged") {
          const input = parseDirectSocketAuthenticateV1(value);
          if (!input || input.connectionId !== connectionId || now >= Date.parse(expiresAt)) {
            close("authentication_failed");
            return;
          }
          if (negotiateRemoteProtocolVersion({ min: 1, max: 1 }, input.protocolRange) !== 1) {
            await send(remoteError("protocol_version_mismatch")).catch(() => undefined);
            close("authentication_failed");
            return;
          }
          try {
            authorization = await currentAuthorization(input.deviceId, input.authorizationRevision);
          } catch (error) {
            const code =
              error instanceof DirectGatewayError && error.code === "device_revoked"
                ? "device_revoked"
                : error instanceof DirectGatewayError &&
                    error.code === "authorization_revision_changed"
                  ? "authorization_revision_changed"
                  : "authentication_failed";
            await send(remoteError(code)).catch(() => undefined);
            close("authentication_failed");
            return;
          }
          const transcript = canonicalDirectSocketAuthenticationTranscript({
            connectionId,
            nonce,
            machineId: options.installation.machineId,
            deviceId: input.deviceId,
            authorizationRevision: input.authorizationRevision,
            endpoint,
            protocolVersion: 1,
            resume: input.resume,
            expiresAt,
          });
          if (!validProof(authorization, transcript, input.challengeProof)) {
            close("authentication_failed");
            return;
          }
          clearTimeout(timer);
          state = "authenticated";
          const deviceConnections = byDevice.get(authorization.deviceId) ?? new Set();
          deviceConnections.add(connection);
          byDevice.set(authorization.deviceId, deviceConnections);
          const acknowledgement: DirectSocketAuthenticatedV1 = {
            type: "direct.socket.authenticated",
            version: 1,
            protocolVersion: 1,
            connectionId,
            machineId: options.installation.machineId,
            machineDisplayName: options.installation.displayName,
            deviceId: authorization.deviceId,
            authorizationRevision: authorization.revision,
            epoch: options.epoch,
          };
          businessSubscription = options.business?.subscribe(authorization, (frame) => send(frame));
          await send(acknowledgement);
          return;
        }
        if (state !== "authenticated" || !authorization || !options.business) {
          close("authentication_failed");
          return;
        }
        const envelope = parseDirectSealedEnvelopeV1(value);
        if (
          !envelope ||
          envelope.machineId !== options.installation.machineId ||
          envelope.deviceId !== authorization.deviceId ||
          envelope.direction !== "mobile-to-desktop" ||
          envelope.contentType !== "command" ||
          !replay.consume(
            `${authorization.deviceId}:${envelope.envelopeId}`,
            new Date(envelope.expiresAt),
          )
        ) {
          close("invalid_frame");
          return;
        }
        authorization = await currentAuthorization(authorization.deviceId, authorization.revision);
        const responses = await options.business.process({
          connectionId,
          authorization,
          envelope,
        });
        for (const response of responses) await send(response);
      };
      subscriptions.push(
        socket.onMessage((frame) => {
          if (
            state === "closed" ||
            remoteUtf8ByteLength(frame) > DIRECT_SERVER_LIMITS.sealedFrameBytes
          ) {
            close("invalid_frame");
            return;
          }
          operation = operation
            .then(async () => {
              let value: unknown;
              try {
                value = JSON.parse(frame) as unknown;
              } catch {
                close("invalid_frame");
                return;
              }
              await handle(value);
            })
            .catch(() => close("invalid_frame"));
        }),
        socket.onClose(() => close("authentication_failed")),
      );
      connections.add(connection);
      byAddress.set(remoteAddress, addressCount + 1);
      void send(challenge).catch(() => close("authentication_failed"));
    },
    revokeDevice(deviceId): void {
      for (const connection of [...(byDevice.get(deviceId) ?? [])]) {
        connection.close("device_revoked");
      }
    },
    closeAll(reason = "listener_disabled"): void {
      for (const connection of [...connections]) connection.close(reason);
      replay.clear();
      byAddress.clear();
    },
    dispose(): void {
      this.closeAll();
      disposed = true;
    },
  };
}
