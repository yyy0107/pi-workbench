import {
  REMOTE_CONTROL_PROTOCOL_VERSION,
  REMOTE_PROTOCOL_LIMITS,
  negotiateRemoteProtocolVersion,
  parseDirectSealedEnvelopeV1,
  parseDirectSocketAuthenticatedV1,
  parseDirectSocketChallengeV1,
  parseRemoteErrorV1,
  remoteUtf8ByteLength,
} from "@workbench/remote-control-contracts/codecs";
import { canonicalDirectSocketAuthenticationTranscript } from "@workbench/remote-control-contracts/direct-pairing";
import type {
  DirectEndpointV1,
  DirectSocketAuthenticateV1,
} from "@workbench/remote-control-contracts/protocol";

import { fullJitterBackoffDelay } from "../lib/backoff.ts";
import type {
  DirectChallengeProofPort,
  RemoteControlClientClock,
  RemoteControlClientRandom,
  RemoteControlClientSocket,
  RemoteControlClientSocketPort,
} from "./ports.ts";
import type {
  DirectRemoteControlClientState,
  DirectRemoteControlConnectionObserver,
  DirectRemoteControlConnectionStartInput,
  RemoteControlSendResult,
} from "./types.ts";
import { verifyDirectChallengeIdentity } from "./profiles.ts";

const AUTHENTICATION_TIMEOUT_MS = 5_000;
const MAXIMUM_PENDING_BYTES = 1024 * 1024;
const BACKPRESSURE_GRACE_MS = 10_000;

function parseJson(frame: string): unknown {
  try {
    return JSON.parse(frame) as unknown;
  } catch {
    return undefined;
  }
}

export interface DirectRemoteControlConnectionOptions extends DirectRemoteControlConnectionObserver {
  readonly clock: RemoteControlClientClock;
  readonly random: RemoteControlClientRandom;
  readonly socketPort: RemoteControlClientSocketPort;
  readonly challengeProof: DirectChallengeProofPort;
}

export interface DirectRemoteControlConnection {
  readonly state: DirectRemoteControlClientState;
  start(input: DirectRemoteControlConnectionStartInput): void;
  receive(frame: string): Promise<void>;
  send(frame: string): RemoteControlSendResult;
  poll(): void;
  nextReconnectDelay(attempt: number): number;
  suspend(): void;
  disconnect(): void;
}

function directSocketUrl(endpoint: DirectEndpointV1): string {
  const host = endpoint.host.includes(":") ? `[${endpoint.host}]` : endpoint.host;
  const url = new URL(`ws://${host}:${endpoint.port}/remote/v1/direct`);
  if (
    url.protocol !== "ws:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/remote/v1/direct" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Direct socket endpoint is invalid");
  }
  return url.toString();
}

function sameEndpoint(left: DirectEndpointV1, right: DirectEndpointV1): boolean {
  return (
    left.kind === right.kind &&
    left.host.toLowerCase() === right.host.toLowerCase() &&
    left.port === right.port
  );
}

export function createDirectRemoteControlConnection(
  options: DirectRemoteControlConnectionOptions,
): DirectRemoteControlConnection {
  let state: DirectRemoteControlClientState = "offline";
  let socket: RemoteControlClientSocket | undefined;
  let startInput: DirectRemoteControlConnectionStartInput | undefined;
  let endpoint: DirectEndpointV1 | undefined;
  let authenticationDeadline = 0;
  let backpressureStartedAt: number | undefined;
  let receiveGeneration = 0;

  const transition = (next: DirectRemoteControlClientState): void => {
    if (state === next) return;
    state = next;
    options.onStateChanged?.(next);
  };

  const close = (
    reason: "authentication_failed" | "identity_mismatch" | "invalid_frame" | "slow_consumer",
    next: DirectRemoteControlClientState,
  ): void => {
    receiveGeneration += 1;
    socket?.close(1008, reason);
    socket = undefined;
    authenticationDeadline = 0;
    backpressureStartedAt = undefined;
    transition(next);
  };

  return {
    get state(): DirectRemoteControlClientState {
      return state;
    },
    start(input): void {
      if (input.endpoints.length < 1 || input.endpoints.length > 8) {
        throw new Error("Direct connection requires one to eight approved endpoints");
      }
      startInput = input;
      endpoint = input.endpoints[0];
      socket = options.socketPort.connect({
        url: directSocketUrl(endpoint),
        protocols: ["workbench.remote.direct.v1"],
      });
      receiveGeneration += 1;
      authenticationDeadline = options.clock.now().getTime() + AUTHENTICATION_TIMEOUT_MS;
      backpressureStartedAt = undefined;
      transition("connecting");
    },
    async receive(frame): Promise<void> {
      if (!socket || !startInput || !endpoint) return;
      const value = parseJson(frame);
      if (state === "connecting") {
        const challenge = parseDirectSocketChallengeV1(value);
        if (!challenge || !sameEndpoint(challenge.endpoint, endpoint)) {
          close("invalid_frame", "reconnecting");
          return;
        }
        if (
          !verifyDirectChallengeIdentity(
            {
              machineId: startInput.machineId,
              desktopEncryptionKeyId: startInput.desktopEncryptionKeyId,
              desktopFingerprint: startInput.desktopEncryptionKeyFingerprint,
            },
            challenge,
          )
        ) {
          close("identity_mismatch", "identity-mismatch");
          return;
        }
        const protocolVersion = negotiateRemoteProtocolVersion(
          startInput.protocolRange,
          challenge.protocolRange,
        );
        if (protocolVersion !== REMOTE_CONTROL_PROTOCOL_VERSION) {
          close("authentication_failed", "incompatible");
          return;
        }
        if (Date.parse(challenge.expiresAt) <= options.clock.now().getTime()) {
          close("authentication_failed", "reconnecting");
          return;
        }
        const generation = receiveGeneration;
        transition("authenticating");
        const resume = startInput.resume ?? { unresolvedOperationIds: [] };
        const challengeProof = await options.challengeProof.sign(
          canonicalDirectSocketAuthenticationTranscript({
            connectionId: challenge.connectionId,
            nonce: challenge.nonce,
            machineId: challenge.machineId,
            deviceId: startInput.deviceId,
            authorizationRevision: startInput.authorizationRevision,
            endpoint: challenge.endpoint,
            protocolVersion: 1,
            resume,
            expiresAt: challenge.expiresAt,
          }),
        );
        if (!socket || generation !== receiveGeneration) return;
        const authentication: DirectSocketAuthenticateV1 = {
          type: "direct.socket.authenticate",
          version: 1,
          connectionId: challenge.connectionId,
          deviceId: startInput.deviceId,
          authorizationRevision: startInput.authorizationRevision,
          protocolRange: startInput.protocolRange,
          resume,
          challengeProof,
        };
        socket.send(JSON.stringify(authentication));
        authenticationDeadline = options.clock.now().getTime() + AUTHENTICATION_TIMEOUT_MS;
        transition("synchronizing");
        return;
      }
      if (state === "authenticating") return;
      if (state === "synchronizing") {
        const acknowledgement = parseDirectSocketAuthenticatedV1(value);
        if (
          acknowledgement &&
          acknowledgement.machineId === startInput.machineId &&
          acknowledgement.deviceId === startInput.deviceId &&
          acknowledgement.authorizationRevision === startInput.authorizationRevision &&
          acknowledgement.protocolVersion >= startInput.protocolRange.min &&
          acknowledgement.protocolVersion <= startInput.protocolRange.max
        ) {
          authenticationDeadline = 0;
          transition("ready");
          return;
        }
        const error = parseRemoteErrorV1(value);
        if (error?.code === "device_revoked") {
          close("authentication_failed", "revoked");
          return;
        }
        if (error?.code === "protocol_version_mismatch") {
          close("authentication_failed", "incompatible");
          return;
        }
        close("invalid_frame", "reconnecting");
        return;
      }
      if (state !== "ready") return;
      const envelope = parseDirectSealedEnvelopeV1(value);
      if (
        !envelope ||
        envelope.machineId !== startInput.machineId ||
        envelope.deviceId !== startInput.deviceId ||
        envelope.direction !== "desktop-to-mobile"
      ) {
        close("invalid_frame", "reconnecting");
        return;
      }
      options.onEnvelope?.(envelope);
    },
    send(frame): RemoteControlSendResult {
      if (!socket || state !== "ready") return "not-ready";
      const value = parseDirectSealedEnvelopeV1(parseJson(frame));
      if (
        !value ||
        !startInput ||
        value.machineId !== startInput.machineId ||
        value.deviceId !== startInput.deviceId ||
        value.direction !== "mobile-to-desktop"
      ) {
        return "payload-too-large";
      }
      const frameBytes = remoteUtf8ByteLength(frame);
      if (frameBytes > REMOTE_PROTOCOL_LIMITS.sealedEnvelopeBytes) return "payload-too-large";
      if (socket.bufferedAmount + frameBytes > MAXIMUM_PENDING_BYTES) {
        backpressureStartedAt ??= options.clock.now().getTime();
        return "backpressured";
      }
      backpressureStartedAt = undefined;
      socket.send(frame);
      return "sent";
    },
    poll(): void {
      if (!socket) return;
      const now = options.clock.now().getTime();
      if (
        ["connecting", "authenticating", "synchronizing"].includes(state) &&
        now >= authenticationDeadline
      ) {
        close("authentication_failed", "reconnecting");
        return;
      }
      if (state === "ready" && backpressureStartedAt !== undefined) {
        if (socket.bufferedAmount < MAXIMUM_PENDING_BYTES) {
          backpressureStartedAt = undefined;
        } else if (now - backpressureStartedAt >= BACKPRESSURE_GRACE_MS) {
          close("slow_consumer", "reconnecting");
        }
      }
    },
    nextReconnectDelay(attempt): number {
      return fullJitterBackoffDelay(attempt, () => options.random.nextUnit());
    },
    suspend(): void {
      receiveGeneration += 1;
      socket?.close(1000, "suspended");
      socket = undefined;
      authenticationDeadline = 0;
      backpressureStartedAt = undefined;
      transition("suspended");
    },
    disconnect(): void {
      receiveGeneration += 1;
      socket?.close(1000, "disconnected");
      socket = undefined;
      startInput = undefined;
      endpoint = undefined;
      authenticationDeadline = 0;
      backpressureStartedAt = undefined;
      transition("offline");
    },
  };
}
