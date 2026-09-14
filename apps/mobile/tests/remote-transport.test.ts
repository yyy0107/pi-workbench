import assert from "node:assert/strict";
import test from "node:test";

import {
  parseDirectSealedEnvelopeV1,
  parseDirectSocketAuthenticateV1,
  parseRemoteControlRequestV1,
  parseRemoteOperationRequestV1,
} from "@workbench/remote-control-contracts/codecs";
import {
  generateDirectHpkeKeyPair,
  openDirectRemoteEnvelope,
  sealDirectRemoteEnvelope,
} from "@workbench/remote-control-contracts/direct-crypto";
import { canonicalDirectSocketAuthenticationTranscript } from "@workbench/remote-control-contracts/direct-pairing";
import type {
  DirectEndpointV1,
  DirectSocketChallengeV1,
  RemoteControlResponseV1,
  RemoteOperationResultV1,
  RemoteSessionSummaryV1,
} from "@workbench/remote-control-contracts/protocol";
import { createDirectConnectionProfile } from "@workbench/remote-control-client/profiles";

import type { MobileDirectPairingPrivateIdentity } from "../src/features/direct-pairing.ts";
import { createMobileProjectionStore } from "../src/state/projection-store.ts";
import { createMobileRemoteTransport } from "../src/state/remote-transport.ts";

const now = new Date("2030-09-13T20:00:00.000Z");
const LAN_ENDPOINT = { kind: "local-network", host: "192.168.1.20", port: 8787 } as const;
const TAILSCALE_ENDPOINT = { kind: "tailscale", host: "100.64.0.8", port: 8787 } as const;

function base64Url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function fromBase64Url(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

function endpointUrl(endpoint: DirectEndpointV1): string {
  return `ws://${endpoint.host}:${endpoint.port}/remote/v1/direct`;
}

async function fixture() {
  const [desktopKeys, mobileKeys, signingKeys] = await Promise.all([
    generateDirectHpkeKeyPair(),
    generateDirectHpkeKeyPair(),
    globalThis.crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]) as Promise<CryptoKeyPair>,
  ]);
  const [signingPrivateJwk, signingPublicJwk] = await Promise.all([
    globalThis.crypto.subtle.exportKey("jwk", signingKeys.privateKey),
    globalThis.crypto.subtle.exportKey("jwk", signingKeys.publicKey),
  ]);
  const identity: MobileDirectPairingPrivateIdentity = {
    deviceId: "device-1",
    signingPrivateJwk,
    signingPublicJwk: signingPublicJwk as MobileDirectPairingPrivateIdentity["signingPublicJwk"],
    signingKeyFingerprint: "sha256:signing-key",
    encryptionKeyId: "mobile-key-1",
    encryptionPrivateKey: base64Url(mobileKeys.privateKey),
    encryptionPublicKey: base64Url(mobileKeys.publicKey),
    encryptionKeyFingerprint: "sha256:mobile-key",
  };
  const profile = createDirectConnectionProfile({
    desktop: {
      machineId: "machine-1",
      machineDisplayName: "Studio Mac",
      desktopEncryptionKeyId: "desktop-key-1",
      desktopEncryptionPublicKey: base64Url(desktopKeys.publicKey),
      desktopEncryptionKeyFingerprint: "sha256:desktop-key",
    },
    deviceId: identity.deviceId,
    authorizationRevision: "authorization-1",
    endpoints: [LAN_ENDPOINT, TAILSCALE_ENDPOINT],
    approvedAt: now.toISOString(),
  });
  return { desktopKeys, mobileKeys, signingKeys, identity, profile };
}

function memoryProjection() {
  let value:
    | {
        readonly sessions: readonly RemoteSessionSummaryV1[];
        readonly cursor: { readonly epoch: string; readonly offset: string };
        readonly stale: boolean;
      }
    | undefined = {
    sessions: [],
    cursor: { epoch: "epoch-1", offset: "0" },
    stale: false,
  };
  return createMobileProjectionStore({
    persistence: {
      load: async () => value,
      replace: async (_machineId, next) => void (value = next),
      markStale: async () => {
        if (value) value = { ...value, stale: true };
      },
    },
  });
}

test("falls back from LAN to Tailscale, signs the pinned challenge, and exchanges direct HPKE frames", async () => {
  const { desktopKeys, identity, mobileKeys, profile } = await fixture();
  const urls: string[] = [];
  const requests: string[] = [];
  const successfulEndpoints: string[] = [];
  const session: RemoteSessionSummaryV1 = {
    sessionId: "session-1",
    title: "Direct session",
    updatedAt: now.toISOString(),
    pinned: false,
    archived: false,
    attention: "none",
    runState: "idle",
    entityRevision: "revision-1",
  };
  let lifecycleListener: ((state: "active" | "background") => void) | undefined;
  let envelopeId = 0;

  class FakeSocket {
    readonly bufferedAmount = 0;
    readonly readyState = 1;
    readonly url: string;
    private readonly listeners = new Map<
      string,
      Array<(event?: { readonly data: unknown }) => void>
    >();
    private readonly endpoint: DirectEndpointV1;

    constructor(url: string) {
      this.url = url;
      urls.push(url);
      this.endpoint = url === endpointUrl(TAILSCALE_ENDPOINT) ? TAILSCALE_ENDPOINT : LAN_ENDPOINT;
      queueMicrotask(() => {
        if (this.endpoint.kind === "local-network") {
          this.emit("error");
          return;
        }
        const challenge: DirectSocketChallengeV1 = {
          type: "direct.socket.challenge",
          version: 1,
          connectionId: "connection-1",
          nonce: "A".repeat(43),
          machineId: profile.machineId,
          desktopEncryptionKeyId: profile.desktopEncryptionKeyId,
          desktopEncryptionKeyFingerprint: profile.desktopFingerprint,
          endpoint: this.endpoint,
          protocolRange: { min: 1, max: 1 },
          expiresAt: new Date(now.getTime() + 5_000).toISOString(),
        };
        this.serverMessage(challenge);
      });
    }

    addEventListener(type: string, listener: (event?: { readonly data: unknown }) => void): void {
      const values = this.listeners.get(type) ?? [];
      values.push(listener);
      this.listeners.set(type, values);
    }

    send(frame: string): void {
      void this.receive(frame).catch((error) => this.emit("error", { data: error }));
    }

    close(): void {
      this.emit("close");
    }

    private emit(type: string, event?: { readonly data: unknown }): void {
      for (const listener of this.listeners.get(type) ?? []) listener(event);
    }

    private serverMessage(value: object): void {
      this.emit("message", { data: JSON.stringify(value) });
    }

    private async sealedResponse(value: object, contentType: "result" | "event") {
      const createdAt = now;
      this.serverMessage(
        await sealDirectRemoteEnvelope({
          plaintext: new TextEncoder().encode(JSON.stringify(value)),
          header: {
            protocolVersion: 1,
            envelopeId: `desktop-${++envelopeId}`,
            machineId: profile.machineId,
            deviceId: identity.deviceId,
            direction: "desktop-to-mobile",
            contentType,
            createdAt: createdAt.toISOString(),
            expiresAt: new Date(createdAt.getTime() + 60_000).toISOString(),
          },
          recipient: { keyId: identity.encryptionKeyId, publicKey: mobileKeys.publicKey },
          senderPrivateKey: desktopKeys.privateKey,
        }),
      );
    }

    private async receive(frame: string): Promise<void> {
      const value = JSON.parse(frame) as unknown;
      const authentication = parseDirectSocketAuthenticateV1(value);
      if (authentication) {
        const transcript = canonicalDirectSocketAuthenticationTranscript({
          connectionId: "connection-1",
          nonce: "A".repeat(43),
          machineId: profile.machineId,
          deviceId: identity.deviceId,
          authorizationRevision: profile.authorizationRevision,
          endpoint: this.endpoint,
          protocolVersion: 1,
          resume: authentication.resume,
          expiresAt: new Date(now.getTime() + 5_000).toISOString(),
        });
        const publicKey = await globalThis.crypto.subtle.importKey(
          "jwk",
          identity.signingPublicJwk as JsonWebKey,
          { name: "ECDSA", namedCurve: "P-256" },
          false,
          ["verify"],
        );
        assert.equal(
          await globalThis.crypto.subtle.verify(
            { name: "ECDSA", hash: "SHA-256" },
            publicKey,
            Uint8Array.from(fromBase64Url(authentication.challengeProof)).buffer,
            new TextEncoder().encode(transcript),
          ),
          true,
        );
        this.serverMessage({
          type: "direct.socket.authenticated",
          version: 1,
          protocolVersion: 1,
          connectionId: "connection-1",
          machineId: profile.machineId,
          deviceId: identity.deviceId,
          authorizationRevision: profile.authorizationRevision,
          epoch: "epoch-1",
        });
        return;
      }

      const envelope = parseDirectSealedEnvelopeV1(value);
      assert.ok(envelope);
      const plaintext = await openDirectRemoteEnvelope({
        envelope,
        expectedMachineId: profile.machineId,
        expectedDeviceId: identity.deviceId,
        expectedDirection: "mobile-to-desktop",
        senderPublicKey: mobileKeys.publicKey,
        now,
        resolveRecipientPrivateKey: (keyId) =>
          keyId === profile.desktopEncryptionKeyId ? desktopKeys.privateKey : undefined,
      });
      const decoded = JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
      const control = parseRemoteControlRequestV1(decoded);
      if (control) {
        requests.push(control.query.type);
        const response: RemoteControlResponseV1 =
          control.query.type === "session.catalog.read"
            ? {
                type: "control.response",
                requestId: control.requestId,
                value: {
                  type: "session.catalog",
                  sessions: [session],
                  projectionCursor: { epoch: "epoch-1", offset: "1" },
                },
              }
            : {
                type: "control.response",
                requestId: control.requestId,
                value: {
                  type: "sync.replay",
                  events: [],
                  currentCursor: { epoch: "epoch-1", offset: "0" },
                },
              };
        await this.sealedResponse(response, "result");
        return;
      }
      const operation = parseRemoteOperationRequestV1(decoded);
      assert.ok(operation);
      requests.push(operation.command.type);
      const result: RemoteOperationResultV1 = {
        type: "operation.result",
        operationId: operation.operationId,
        state: "succeeded",
        value: { type: "session-created", sessionId: "session-created" },
        appliedCursor: { epoch: "epoch-1", offset: "2" },
      };
      await this.sealedResponse(result, "result");
    }
  }

  const transport = createMobileRemoteTransport({
    secureStore: {
      loadMachineKeys: async <T extends object>() => identity as unknown as T,
    },
    profileStore: {
      get: async () => profile,
      noteEndpointSuccess: async (_machineId, endpointId) =>
        void successfulEndpoints.push(endpointId),
    },
    projection: memoryProjection(),
    lifecycle: {
      current: () => "active",
      subscribe: (listener) => {
        lifecycleListener = listener;
        return () => void (lifecycleListener = undefined);
      },
    },
    network: {
      current: async () => ({ connected: true, reachable: true }),
      subscribe: () => () => {},
    },
    WebSocket: FakeSocket as never,
    clock: { now: () => now },
    id: (() => {
      let value = 0;
      return () => `mobile-${++value}`;
    })(),
  });
  await transport.start();

  await transport.probeEndpoint(profile.machineId, TAILSCALE_ENDPOINT);
  assert.deepEqual(urls, [endpointUrl(TAILSCALE_ENDPOINT)]);
  assert.deepEqual(requests, []);
  urls.length = 0;

  assert.deepEqual(await transport.read(profile.machineId), [session]);
  assert.deepEqual(urls, [endpointUrl(LAN_ENDPOINT), endpointUrl(TAILSCALE_ENDPOINT)]);
  assert.deepEqual(requests.slice(0, 2), ["sync.recover", "session.catalog.read"]);
  assert.equal(successfulEndpoints[0], profile.endpoints[1]?.endpointId);

  assert.equal(
    (
      await transport.submit({
        machineId: profile.machineId,
        request: {
          type: "operation.request",
          operationId: "operation-1",
          issuedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 60_000).toISOString(),
          command: { type: "session.create", title: "From phone" },
        },
      })
    ).state,
    "succeeded",
  );
  lifecycleListener?.("background");
  await assert.rejects(() => transport.read(profile.machineId), /machine_offline/u);
  transport.stop();
});

test("stops endpoint fallback when a reachable address presents a different pinned computer", async () => {
  const { identity, profile } = await fixture();
  const urls: string[] = [];

  class IdentityMismatchSocket {
    readonly bufferedAmount = 0;
    readonly readyState = 1;
    private readonly listeners = new Map<
      string,
      Array<(event?: { readonly data: unknown }) => void>
    >();

    constructor(url: string) {
      urls.push(url);
      queueMicrotask(() =>
        this.emit("message", {
          data: JSON.stringify({
            type: "direct.socket.challenge",
            version: 1,
            connectionId: "connection-other",
            nonce: "B".repeat(43),
            machineId: profile.machineId,
            desktopEncryptionKeyId: profile.desktopEncryptionKeyId,
            desktopEncryptionKeyFingerprint: "sha256:different-computer",
            endpoint: LAN_ENDPOINT,
            protocolRange: { min: 1, max: 1 },
            expiresAt: new Date(now.getTime() + 5_000).toISOString(),
          }),
        }),
      );
    }

    addEventListener(type: string, listener: (event?: { readonly data: unknown }) => void): void {
      const values = this.listeners.get(type) ?? [];
      values.push(listener);
      this.listeners.set(type, values);
    }

    send(): void {}
    close(): void {
      this.emit("close");
    }
    private emit(type: string, event?: { readonly data: unknown }) {
      for (const listener of this.listeners.get(type) ?? []) listener(event);
    }
  }

  const transport = createMobileRemoteTransport({
    secureStore: {
      loadMachineKeys: async <T extends object>() => identity as unknown as T,
    },
    profileStore: { get: async () => profile, noteEndpointSuccess: async () => assert.fail() },
    projection: memoryProjection(),
    lifecycle: { current: () => "active", subscribe: () => () => {} },
    network: {
      current: async () => ({ connected: true, reachable: true }),
      subscribe: () => () => {},
    },
    WebSocket: IdentityMismatchSocket as never,
    clock: { now: () => now },
  });
  await transport.start();
  await assert.rejects(
    () => transport.probeEndpoint(profile.machineId, LAN_ENDPOINT),
    /identity_mismatch/u,
  );
  assert.deepEqual(urls, [endpointUrl(LAN_ENDPOINT)]);
  urls.length = 0;
  await assert.rejects(() => transport.read(profile.machineId), /identity_mismatch/u);
  assert.deepEqual(urls, [endpointUrl(LAN_ENDPOINT)]);
  transport.stop();
});
