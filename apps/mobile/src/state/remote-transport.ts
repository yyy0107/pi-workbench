import {
  parseDirectSealedEnvelopeV1,
  parseDirectSocketAuthenticatedV1,
  parseDirectSocketChallengeV1,
  parseRemoteControlResponseV1,
  parseRemoteErrorV1,
  parseRemoteEventV1,
  parseRemoteOperationResultV1,
  parseRemoteSnapshotChunkV1,
  parseRemoteSnapshotCompleteV1,
  remoteUtf8ByteLength,
} from "@workbench/remote-control-contracts/codecs";
import {
  openDirectRemoteEnvelope,
  sealDirectRemoteEnvelope,
} from "@workbench/remote-control-contracts/direct-crypto";
import { canonicalDirectSocketAuthenticationTranscript } from "@workbench/remote-control-contracts/direct-pairing";
import type {
  DirectEndpointV1,
  DirectSocketAuthenticateV1,
  RemoteControlRequestV1,
  RemoteControlResponseV1,
  RemoteCursor,
  RemoteEventV1,
  RemoteOperationRequestV1,
  RemoteOperationResultV1,
  RemoteSnapshotChunkV1,
} from "@workbench/remote-control-contracts/protocol";
import type { DirectConnectionProfile } from "@workbench/remote-control-client/profiles";
import { validateDirectClientEndpoint } from "@workbench/remote-control-client/endpoint-policy";

import type { MobileDirectPairingPrivateIdentity } from "../features/direct-pairing.ts";
import type { MobileAppState } from "../platform/app-state.ts";
import { initializeMobileHpkeRuntime } from "../platform/crypto.ts";
import type { MobileNetworkState } from "../platform/network.ts";
import type { createMobileProjectionStore } from "./projection-store.ts";

const AUTHENTICATION_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 30_000;
const SOCKET_SUBPROTOCOL = "workbench.remote.direct.v1";
const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

interface MobileTransportSecureStore {
  loadMachineKeys<T extends object>(machineId: string): Promise<T | undefined>;
}

interface MobileTransportProfileStore {
  get(machineId: string): Promise<DirectConnectionProfile | undefined>;
  noteEndpointSuccess(machineId: string, endpointId: string, at?: Date): Promise<void>;
}

interface MobileTransportLifecycle {
  current(): MobileAppState;
  subscribe(listener: (state: MobileAppState) => void): () => void;
}

interface MobileTransportNetwork {
  current(): Promise<MobileNetworkState>;
  subscribe(listener: (state: MobileNetworkState) => void): () => void;
}

interface MobileWebSocketMessageEvent {
  readonly data: unknown;
}

interface MobileWebSocket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: MobileWebSocketMessageEvent) => void): void;
  addEventListener(type: "close" | "error", listener: () => void): void;
  send(frame: string): void;
  close(code?: number, reason?: string): void;
}

interface MobileWebSocketConstructor {
  new (url: string, protocols?: string | readonly string[]): MobileWebSocket;
}

type ProjectionStore = ReturnType<typeof createMobileProjectionStore>;
type RemotePayload = RemoteOperationResultV1 | RemoteEventV1;

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
    throw new Error("remote_key_invalid");
  }
  const output = new Uint8Array(Math.floor((value.length * 6) / 8));
  let outputOffset = 0;
  for (let offset = 0; offset < value.length; offset += 4) {
    let bits = 0;
    let count = 0;
    for (let index = 0; index < 4 && offset + index < value.length; index += 1) {
      const digit = BASE64URL_ALPHABET.indexOf(value[offset + index] ?? "");
      if (digit < 0) throw new Error("remote_key_invalid");
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
    throw new Error("remote_key_invalid");
  }
  return output;
}

function assertIdentity(
  value: MobileDirectPairingPrivateIdentity | undefined,
  profile: DirectConnectionProfile,
) {
  if (
    !value ||
    value.deviceId !== profile.deviceId ||
    typeof value.signingPrivateJwk !== "object" ||
    typeof value.encryptionKeyId !== "string" ||
    typeof value.encryptionPrivateKey !== "string"
  ) {
    throw new Error("device_not_paired");
  }
  return value;
}

function endpointUrl(endpoint: DirectEndpointV1): string {
  const host = endpoint.host.includes(":") ? `[${endpoint.host}]` : endpoint.host;
  return `ws://${host}:${endpoint.port}/remote/v1/direct`;
}

async function signChallenge(
  identity: MobileDirectPairingPrivateIdentity,
  transcript: string,
): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    "jwk",
    identity.signingPrivateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await globalThis.crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(transcript),
    ),
  );
  if (signature.byteLength !== 64) throw new Error("remote_control_proof_invalid");
  return base64UrlEncode(signature);
}

function remoteFailure(response: Extract<RemoteControlResponseV1, { readonly error: unknown }>) {
  return Object.assign(new Error(response.error.code), { code: response.error.code });
}

function asError(error: unknown, fallback = "network_error"): Error {
  return error instanceof Error ? error : new Error(fallback);
}

export function createMobileRemoteTransport(options: {
  readonly secureStore: MobileTransportSecureStore;
  readonly profileStore: MobileTransportProfileStore;
  readonly projection: ProjectionStore;
  readonly lifecycle: MobileTransportLifecycle;
  readonly network: MobileTransportNetwork;
  readonly WebSocket?: MobileWebSocketConstructor;
  readonly clock?: { now(): Date };
  readonly id?: () => string;
}) {
  const WebSocketImpl =
    options.WebSocket ?? (globalThis.WebSocket as unknown as MobileWebSocketConstructor);
  const clock = options.clock ?? { now: () => new Date() };
  const id = options.id ?? (() => globalThis.crypto.randomUUID());
  const connections = new Map<string, ReturnType<typeof createMachineConnection>>();
  const subscribers = new Map<string, Set<(payload: RemotePayload) => void>>();
  let appState = options.lifecycle.current();
  let network: MobileNetworkState = { connected: false, reachable: false };
  let started = false;
  let unsubscribeLifecycle: (() => void) | undefined;
  let unsubscribeNetwork: (() => void) | undefined;

  const canConnect = () => started && appState === "active" && network.reachable;
  const emit = (machineId: string, payload: RemotePayload) => {
    for (const listener of subscribers.get(machineId) ?? []) listener(payload);
  };

  function createMachineConnection(machineId: string) {
    let state: "idle" | "connecting" | "ready" | "suspended" = "idle";
    let socket: MobileWebSocket | undefined;
    let connectPromise: Promise<void> | undefined;
    let identity: MobileDirectPairingPrivateIdentity | undefined;
    let profile: DirectConnectionProfile | undefined;
    const controls = new Map<
      string,
      {
        readonly resolve: (value: RemoteControlResponseV1) => void;
        readonly reject: (error: Error) => void;
        readonly timer: ReturnType<typeof setTimeout>;
      }
    >();
    const operations = new Map<
      string,
      {
        readonly resolve: (value: RemoteOperationResultV1) => void;
        readonly reject: (error: Error) => void;
        readonly timer: ReturnType<typeof setTimeout>;
      }
    >();
    let snapshotAssembly:
      | {
          readonly snapshotId: string;
          readonly partCount: number;
          readonly parts: Map<number, RemoteSnapshotChunkV1>;
          readonly requestId: string;
        }
      | undefined;

    const rejectPending = (error: Error) => {
      for (const pending of [...controls.values(), ...operations.values()]) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      controls.clear();
      operations.clear();
      snapshotAssembly = undefined;
    };

    const receivePlaintext = async (value: unknown) => {
      const response = parseRemoteControlResponseV1(value);
      if (response) {
        const pending = controls.get(response.requestId);
        if (!pending) return;
        if ("error" in response) {
          clearTimeout(pending.timer);
          controls.delete(response.requestId);
          pending.reject(remoteFailure(response));
          return;
        }
        if (response.value.type === "session.catalog") {
          await options.projection.replaceSnapshot(
            machineId,
            response.value.sessions,
            response.value.projectionCursor,
          );
        } else if (response.value.type === "sync.replay") {
          await options.projection.applyEvents(machineId, response.value.events).catch(async () => {
            await options.projection.markStale(machineId);
            throw new Error("snapshot_required");
          });
        } else if (response.value.type === "sync.snapshot") {
          snapshotAssembly = {
            snapshotId: response.value.snapshotId,
            partCount: 0,
            parts: new Map(),
            requestId: response.requestId,
          };
          return;
        }
        clearTimeout(pending.timer);
        controls.delete(response.requestId);
        pending.resolve(response);
        return;
      }
      const result = parseRemoteOperationResultV1(value);
      if (result) {
        emit(machineId, result);
        const pending = operations.get(result.operationId);
        if (pending && result.state !== "accepted") {
          clearTimeout(pending.timer);
          operations.delete(result.operationId);
          pending.resolve(result);
        }
        return;
      }
      const event = parseRemoteEventV1(value);
      if (event) {
        await options.projection.applyEvents(machineId, [event]).catch(() => undefined);
        emit(machineId, event);
        return;
      }
      const chunk = parseRemoteSnapshotChunkV1(value);
      if (chunk) {
        if (!snapshotAssembly || snapshotAssembly.snapshotId !== chunk.snapshotId) {
          throw new Error("snapshot_required");
        }
        if (snapshotAssembly.partCount !== 0 && snapshotAssembly.partCount !== chunk.partCount) {
          throw new Error("snapshot_required");
        }
        snapshotAssembly = {
          ...snapshotAssembly,
          partCount: chunk.partCount,
          parts: new Map(snapshotAssembly.parts).set(chunk.partIndex, chunk),
        };
        return;
      }
      const complete = parseRemoteSnapshotCompleteV1(value);
      if (complete) {
        const assembly = snapshotAssembly;
        if (
          !assembly ||
          assembly.snapshotId !== complete.snapshotId ||
          assembly.partCount < 1 ||
          assembly.parts.size !== assembly.partCount
        ) {
          throw new Error("snapshot_required");
        }
        const sessions = Array.from(
          { length: assembly.partCount },
          (_, partIndex) => assembly.parts.get(partIndex)?.sessions ?? [],
        ).flat();
        await options.projection.replaceSnapshot(machineId, sessions, complete.baseCursor);
        const pending = controls.get(assembly.requestId);
        snapshotAssembly = undefined;
        if (pending) {
          clearTimeout(pending.timer);
          controls.delete(assembly.requestId);
          pending.resolve({
            type: "control.response",
            requestId: assembly.requestId,
            value: { type: "sync.snapshot", snapshotId: complete.snapshotId },
          });
        }
        return;
      }
      throw new Error("invalid_frame");
    };

    const receiveEnvelope = async (value: unknown) => {
      const envelope = parseDirectSealedEnvelopeV1(value);
      if (
        !envelope ||
        !identity ||
        !profile ||
        envelope.machineId !== machineId ||
        envelope.deviceId !== profile.deviceId ||
        envelope.direction !== "desktop-to-mobile" ||
        envelope.keyId !== identity.encryptionKeyId
      ) {
        throw new Error("invalid_frame");
      }
      const plaintext = await openDirectRemoteEnvelope({
        envelope,
        expectedMachineId: machineId,
        expectedDeviceId: profile.deviceId,
        expectedDirection: "desktop-to-mobile",
        senderPublicKey: base64UrlDecode(profile.desktopEncryptionPublicKey, 65),
        now: clock.now(),
        resolveRecipientPrivateKey: (keyId) =>
          keyId === identity?.encryptionKeyId
            ? base64UrlDecode(identity.encryptionPrivateKey, 32)
            : undefined,
      });
      let decoded: unknown;
      try {
        decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
      } catch {
        throw new Error("invalid_frame");
      }
      await receivePlaintext(decoded);
    };

    const sendSealed = async (payload: RemoteControlRequestV1 | RemoteOperationRequestV1) => {
      if (!socket || state !== "ready" || !identity || !profile) {
        throw new Error("machine_offline");
      }
      const createdAt = clock.now();
      const envelope = await sealDirectRemoteEnvelope({
        plaintext: new TextEncoder().encode(JSON.stringify(payload)),
        header: {
          protocolVersion: 1,
          envelopeId: id(),
          machineId,
          deviceId: profile.deviceId,
          direction: "mobile-to-desktop",
          contentType: "command",
          createdAt: createdAt.toISOString(),
          expiresAt: new Date(createdAt.getTime() + 2 * 60_000).toISOString(),
        },
        recipient: {
          keyId: profile.desktopEncryptionKeyId,
          publicKey: base64UrlDecode(profile.desktopEncryptionPublicKey, 65),
        },
        senderPrivateKey: base64UrlDecode(identity.encryptionPrivateKey, 32),
      });
      const frame = JSON.stringify(envelope);
      if (socket.bufferedAmount + remoteUtf8ByteLength(frame) > 1024 * 1024) {
        throw new Error("slow_consumer");
      }
      socket.send(frame);
    };

    const requestControl = async (query: RemoteControlRequestV1["query"]) => {
      if (controls.size >= 100) throw new Error("rate_limited");
      const issuedAt = clock.now();
      const request: RemoteControlRequestV1 = {
        type: "control.request",
        requestId: id(),
        issuedAt: issuedAt.toISOString(),
        expiresAt: new Date(issuedAt.getTime() + 2 * 60_000).toISOString(),
        query,
      };
      const pending = new Promise<RemoteControlResponseV1>((resolve, reject) => {
        const timer = setTimeout(() => {
          controls.delete(request.requestId);
          reject(new Error("network_error"));
        }, REQUEST_TIMEOUT_MS);
        controls.set(request.requestId, { resolve, reject, timer });
      });
      try {
        const [, response] = await Promise.all([sendSealed(request), pending]);
        return response;
      } catch (error) {
        const waiter = controls.get(request.requestId);
        if (waiter) clearTimeout(waiter.timer);
        controls.delete(request.requestId);
        throw error;
      }
    };

    const recover = async () => {
      const current = await options.projection.load(machineId);
      const response = await requestControl({
        type: "sync.recover",
        ...(current?.cursor ? { cursor: current.cursor } : {}),
        unresolvedOperationIds: [],
      });
      if ("error" in response) throw remoteFailure(response);
    };

    const connectEndpoint = async (
      endpoint: DirectConnectionProfile["endpoints"][number],
    ): Promise<void> => {
      const nextSocket = new WebSocketImpl(endpointUrl(endpoint), [SOCKET_SUBPROTOCOL]);
      socket = nextSocket;
      await new Promise<void>((resolve, reject) => {
        let challengeAccepted = false;
        let authenticated = false;
        let settled = false;
        let terminalAuthenticationError: Error | undefined;
        let receiveTail = Promise.resolve();
        const timer = setTimeout(() => {
          if (!settled) reject(new Error("authentication_failed"));
        }, AUTHENTICATION_TIMEOUT_MS);
        const fail = (error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(asError(error));
        };
        nextSocket.addEventListener("message", (event) => {
          if (!authenticated && challengeAccepted && typeof event.data === "string") {
            try {
              const error = parseRemoteErrorV1(JSON.parse(event.data) as unknown);
              if (error) {
                terminalAuthenticationError = Object.assign(new Error(error.code), {
                  code: error.code,
                });
              }
            } catch {
              // The serialized receive chain below owns malformed-frame handling.
            }
          }
          receiveTail = receiveTail
            .then(async () => {
              if (typeof event.data !== "string") throw new Error("invalid_frame");
              const value = JSON.parse(event.data) as unknown;
              if (!challengeAccepted) {
                const challenge = parseDirectSocketChallengeV1(value);
                if (!challenge || !profile || !identity) throw new Error("authentication_failed");
                if (
                  challenge.machineId !== profile.machineId ||
                  challenge.desktopEncryptionKeyId !== profile.desktopEncryptionKeyId ||
                  challenge.desktopEncryptionKeyFingerprint !== profile.desktopFingerprint
                ) {
                  throw new Error("identity_mismatch");
                }
                if (
                  challenge.endpoint.kind !== endpoint.kind ||
                  challenge.endpoint.host.toLowerCase() !== endpoint.host.toLowerCase() ||
                  challenge.endpoint.port !== endpoint.port ||
                  Date.parse(challenge.expiresAt) <= clock.now().getTime()
                ) {
                  throw new Error("authentication_failed");
                }
                const current = await options.projection.load(machineId);
                const resume = {
                  ...(current?.cursor ? { cursor: current.cursor } : {}),
                  unresolvedOperationIds: [],
                };
                const transcript = canonicalDirectSocketAuthenticationTranscript({
                  connectionId: challenge.connectionId,
                  nonce: challenge.nonce,
                  machineId,
                  deviceId: profile.deviceId,
                  authorizationRevision: profile.authorizationRevision,
                  endpoint: challenge.endpoint,
                  protocolVersion: 1,
                  resume,
                  expiresAt: challenge.expiresAt,
                });
                const authentication: DirectSocketAuthenticateV1 = {
                  type: "direct.socket.authenticate",
                  version: 1,
                  connectionId: challenge.connectionId,
                  deviceId: profile.deviceId,
                  authorizationRevision: profile.authorizationRevision,
                  protocolRange: profile.protocolRange,
                  resume,
                  challengeProof: await signChallenge(identity, transcript),
                };
                challengeAccepted = true;
                nextSocket.send(JSON.stringify(authentication));
                return;
              }
              if (!authenticated) {
                const acknowledgement = parseDirectSocketAuthenticatedV1(value);
                if (
                  acknowledgement?.machineId === machineId &&
                  acknowledgement.deviceId === profile?.deviceId &&
                  acknowledgement.authorizationRevision === profile.authorizationRevision
                ) {
                  authenticated = true;
                  state = "ready";
                  settled = true;
                  clearTimeout(timer);
                  resolve();
                  return;
                }
                const error = parseRemoteErrorV1(value);
                throw Object.assign(new Error(error?.code ?? "authentication_failed"), {
                  code: error?.code ?? "authentication_failed",
                });
              }
              const remoteError = parseRemoteErrorV1(value);
              if (remoteError) throw Object.assign(new Error(remoteError.code), remoteError);
              await receiveEnvelope(value);
            })
            .catch((error) => {
              fail(error);
              nextSocket.close(1008, "invalid_frame");
            });
        });
        const closed = () => {
          clearTimeout(timer);
          if (!authenticated) fail(terminalAuthenticationError ?? new Error("network_error"));
          if (socket === nextSocket) {
            socket = undefined;
            state = "idle";
            rejectPending(new Error("outcome_unknown"));
            void options.projection.markStale(machineId).catch(() => undefined);
          }
        };
        nextSocket.addEventListener("close", closed);
        nextSocket.addEventListener("error", () => {
          if (!authenticated) fail(new Error("network_error"));
        });
      });
      await options.profileStore.noteEndpointSuccess(machineId, endpoint.endpointId, clock.now());
    };

    return {
      get ready() {
        return state === "ready";
      },
      async connect(): Promise<void> {
        if (state === "ready") return;
        if (!canConnect()) throw new Error("machine_offline");
        if (connectPromise) return connectPromise;
        state = "connecting";
        connectPromise = (async () => {
          await initializeMobileHpkeRuntime();
          profile = await options.profileStore.get(machineId);
          if (!profile) throw new Error("device_not_paired");
          identity = assertIdentity(
            (await options.secureStore.loadMachineKeys(machineId)) as
              | MobileDirectPairingPrivateIdentity
              | undefined,
            profile,
          );
          const preferred = profile.endpoints.find(
            (endpoint) => endpoint.endpointId === profile?.preferredEndpointId,
          );
          const endpoints = [
            ...(preferred ? [preferred] : []),
            ...profile.endpoints.filter(
              (endpoint) => endpoint.endpointId !== preferred?.endpointId,
            ),
          ];
          let lastError: Error = new Error("network_error");
          for (const endpoint of endpoints) {
            try {
              await connectEndpoint(endpoint);
              await recover();
              return;
            } catch (error) {
              lastError = asError(error);
              socket?.close(1000, "connection_failed");
              socket = undefined;
              state = "connecting";
              if (
                ["identity_mismatch", "device_revoked", "protocol_version_mismatch"].includes(
                  lastError.message,
                )
              ) {
                break;
              }
            }
          }
          throw lastError;
        })()
          .catch((error) => {
            state = "idle";
            socket?.close(1000, "connection_failed");
            socket = undefined;
            throw error;
          })
          .finally(() => {
            connectPromise = undefined;
          });
        return connectPromise;
      },
      suspend(): void {
        state = "suspended";
        const current = socket;
        socket = undefined;
        current?.close(1000, "suspended");
        rejectPending(new Error("outcome_unknown"));
        void options.projection.markStale(machineId).catch(() => undefined);
      },
      async request(query: RemoteControlRequestV1["query"]) {
        await this.connect();
        return requestControl(query);
      },
      async submit(request: RemoteOperationRequestV1) {
        await this.connect();
        if (operations.size >= 100) throw new Error("rate_limited");
        const pending = new Promise<RemoteOperationResultV1>((resolve, reject) => {
          const timer = setTimeout(() => {
            operations.delete(request.operationId);
            reject(new Error("outcome_unknown"));
          }, REQUEST_TIMEOUT_MS);
          operations.set(request.operationId, { resolve, reject, timer });
        });
        try {
          const [, result] = await Promise.all([sendSealed(request), pending]);
          return result;
        } catch (error) {
          const waiter = operations.get(request.operationId);
          if (waiter) clearTimeout(waiter.timer);
          operations.delete(request.operationId);
          throw error;
        }
      },
    };
  }

  const connection = (machineId: string) => {
    let value = connections.get(machineId);
    if (!value) {
      value = createMachineConnection(machineId);
      connections.set(machineId, value);
    }
    return value;
  };

  const resumeAll = () => {
    if (!canConnect()) return;
    for (const value of connections.values()) void value.connect().catch(() => undefined);
  };
  const suspendAll = () => {
    for (const value of connections.values()) value.suspend();
  };

  return {
    async start(): Promise<void> {
      if (started) return;
      network = await options.network.current();
      started = true;
      unsubscribeLifecycle = options.lifecycle.subscribe((value) => {
        appState = value;
        if (value === "active") resumeAll();
        else suspendAll();
      });
      unsubscribeNetwork = options.network.subscribe((value) => {
        network = value;
        if (value.reachable) resumeAll();
        else suspendAll();
      });
    },
    stop(): void {
      if (!started) return;
      started = false;
      unsubscribeLifecycle?.();
      unsubscribeNetwork?.();
      unsubscribeLifecycle = undefined;
      unsubscribeNetwork = undefined;
      suspendAll();
      connections.clear();
      subscribers.clear();
    },
    async probeEndpoint(machineId: string, endpointInput: DirectEndpointV1): Promise<void> {
      if (!canConnect()) throw new Error("machine_offline");
      const endpoint = validateDirectClientEndpoint(endpointInput);
      await initializeMobileHpkeRuntime();
      const profile = await options.profileStore.get(machineId);
      if (!profile) throw new Error("device_not_paired");
      const identity = assertIdentity(
        (await options.secureStore.loadMachineKeys(machineId)) as
          | MobileDirectPairingPrivateIdentity
          | undefined,
        profile,
      );
      const probeSocket = new WebSocketImpl(endpointUrl(endpoint), [SOCKET_SUBPROTOCOL]);
      await new Promise<void>((resolve, reject) => {
        let state: "challenge" | "acknowledgement" | "complete" = "challenge";
        let settled = false;
        let receiveTail = Promise.resolve();
        const timer = setTimeout(
          () => finish(new Error("authentication_failed")),
          AUTHENTICATION_TIMEOUT_MS,
        );
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          state = "complete";
          clearTimeout(timer);
          probeSocket.close(
            error ? 1008 : 1000,
            error ? "authentication_failed" : "endpoint_verified",
          );
          if (error) reject(error);
          else resolve();
        };
        probeSocket.addEventListener("message", (event) => {
          receiveTail = receiveTail
            .then(async () => {
              if (state === "complete" || typeof event.data !== "string") {
                throw new Error("invalid_frame");
              }
              const value = JSON.parse(event.data) as unknown;
              if (state === "challenge") {
                const challenge = parseDirectSocketChallengeV1(value);
                if (!challenge) throw new Error("authentication_failed");
                if (
                  challenge.machineId !== profile.machineId ||
                  challenge.desktopEncryptionKeyId !== profile.desktopEncryptionKeyId ||
                  challenge.desktopEncryptionKeyFingerprint !== profile.desktopFingerprint
                ) {
                  throw new Error("identity_mismatch");
                }
                if (
                  challenge.endpoint.kind !== endpoint.kind ||
                  challenge.endpoint.host.toLowerCase() !== endpoint.host.toLowerCase() ||
                  challenge.endpoint.port !== endpoint.port ||
                  challenge.protocolRange.min > 1 ||
                  challenge.protocolRange.max < 1 ||
                  Date.parse(challenge.expiresAt) <= clock.now().getTime()
                ) {
                  throw new Error("authentication_failed");
                }
                const resume = { unresolvedOperationIds: [] };
                const transcript = canonicalDirectSocketAuthenticationTranscript({
                  connectionId: challenge.connectionId,
                  nonce: challenge.nonce,
                  machineId,
                  deviceId: profile.deviceId,
                  authorizationRevision: profile.authorizationRevision,
                  endpoint: challenge.endpoint,
                  protocolVersion: 1,
                  resume,
                  expiresAt: challenge.expiresAt,
                });
                const authentication: DirectSocketAuthenticateV1 = {
                  type: "direct.socket.authenticate",
                  version: 1,
                  connectionId: challenge.connectionId,
                  deviceId: profile.deviceId,
                  authorizationRevision: profile.authorizationRevision,
                  protocolRange: profile.protocolRange,
                  resume,
                  challengeProof: await signChallenge(identity, transcript),
                };
                state = "acknowledgement";
                probeSocket.send(JSON.stringify(authentication));
                return;
              }
              const acknowledgement = parseDirectSocketAuthenticatedV1(value);
              if (
                acknowledgement?.machineId === profile.machineId &&
                acknowledgement.deviceId === profile.deviceId &&
                acknowledgement.authorizationRevision === profile.authorizationRevision &&
                acknowledgement.protocolVersion >= profile.protocolRange.min &&
                acknowledgement.protocolVersion <= profile.protocolRange.max
              ) {
                finish();
                return;
              }
              const remoteError = parseRemoteErrorV1(value);
              throw new Error(remoteError?.code ?? "authentication_failed");
            })
            .catch((error) => finish(asError(error, "authentication_failed")));
        });
        probeSocket.addEventListener("close", () => {
          if (!settled) finish(new Error("network_error"));
        });
        probeSocket.addEventListener("error", () => finish(new Error("network_error")));
      });
    },
    disconnectMachine(machineId: string): void {
      const value = connections.get(machineId);
      value?.suspend();
      connections.delete(machineId);
    },
    subscribe(machineId: string, listener: (payload: RemotePayload) => void): () => void {
      const listeners = subscribers.get(machineId) ?? new Set();
      listeners.add(listener);
      subscribers.set(machineId, listeners);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) subscribers.delete(machineId);
      };
    },
    async read(machineId: string) {
      const response = await connection(machineId).request({ type: "session.catalog.read" });
      if ("error" in response) throw remoteFailure(response);
      if (response.value.type !== "session.catalog") throw new Error("session_catalog_invalid");
      return response.value.sessions;
    },
    async readHistory(input: {
      readonly machineId: string;
      readonly sessionId: string;
      readonly historyCursor?: string;
    }) {
      const response = await connection(input.machineId).request({
        type: "conversation.history.read",
        sessionId: input.sessionId,
        ...(input.historyCursor === undefined ? {} : { historyCursor: input.historyCursor }),
      });
      if ("error" in response) throw remoteFailure(response);
      if (response.value.type !== "conversation.history") {
        throw new Error("conversation_page_invalid");
      }
      return response.value.page;
    },
    submit(input: { readonly machineId: string; readonly request: RemoteOperationRequestV1 }) {
      return connection(input.machineId).submit(input.request);
    },
    async recoverOperations(input: {
      readonly machineId: string;
      readonly operationIds: readonly string[];
    }) {
      const response = await connection(input.machineId).request({
        type: "operations.status",
        operationIds: input.operationIds,
      });
      if ("error" in response) throw remoteFailure(response);
      if (response.value.type !== "operations.status") {
        throw new Error("operation_result_invalid");
      }
      return response.value.results;
    },
    async recover(machineId: string, cursor?: RemoteCursor) {
      const response = await connection(machineId).request({
        type: "sync.recover",
        ...(cursor === undefined ? {} : { cursor }),
        unresolvedOperationIds: [],
      });
      if ("error" in response) throw remoteFailure(response);
    },
  };
}
