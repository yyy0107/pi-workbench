import {
  openDirectRemoteEnvelope,
  sealDirectRemoteEnvelope,
} from "@workbench/remote-control-contracts/direct-crypto";
import type {
  DirectPublicJwkV1,
  DirectSealedEnvelopeV1,
  RemoteAction,
  RemoteSealedContentType,
  RemoteSessionSummaryV1,
} from "@workbench/remote-control-contracts/protocol";

import type { createRemoteCommandAdapter } from "./command-adapter.ts";
import { createDesktopRemoteFrameProcessor } from "./frame-processor.ts";
import type { createRemoteOperationLedger } from "./operation-ledger.ts";

type RemoteCommandAdapter = ReturnType<typeof createRemoteCommandAdapter>;
type RemoteOperationLedger = ReturnType<typeof createRemoteOperationLedger>;

export interface DirectFrameAuthorization {
  readonly deviceId: string;
  readonly displayName: string;
  readonly platform: "ios" | "android";
  readonly signingPublicKey: DirectPublicJwkV1;
  readonly signingKeyFingerprint: string;
  readonly encryptionKeyId: string;
  readonly encryptionPublicKey: string;
  readonly encryptionKeyFingerprint: string;
  readonly scope: readonly RemoteAction[];
  readonly revision: string;
  readonly createdAt: string;
  readonly lastSeenAt?: string;
  readonly revokedAt?: string;
}

export interface DirectFrameProcessorInstallation {
  readonly machineId: string;
  readonly encryptionKeyId: string;
  readonly encryptionPrivateKey: string;
}

function decodeBase64Url(value: string, expectedBytes: number): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value) || value.length % 4 === 1) throw new Error("invalid_key");
  const bytes = Buffer.from(value, "base64url");
  if (bytes.byteLength !== expectedBytes || bytes.toString("base64url") !== value) {
    throw new Error("invalid_key");
  }
  return new Uint8Array(bytes);
}

function json(value: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(value)) as unknown;
  } catch {
    throw Object.assign(new Error("invalid_frame"), { code: "invalid_frame" });
  }
}

export function createDesktopDirectFrameProcessor(options: {
  readonly installation: DirectFrameProcessorInstallation;
  readonly epoch: string;
  readonly clock: { now(): Date };
  readonly id: () => string;
  readonly loadAuthorizations: () => Promise<readonly DirectFrameAuthorization[]>;
  readonly ledger: RemoteOperationLedger;
  readonly commands: RemoteCommandAdapter;
  readonly readSessionCatalog: () => Promise<readonly RemoteSessionSummaryV1[]>;
  readonly onOperationAccepted?: (
    request: import("@workbench/remote-control-contracts/protocol").RemoteOperationRequestV1,
  ) => void | Promise<void>;
}) {
  const authorizations = new Map<string, DirectFrameAuthorization>();
  const subscribers = new Map<
    string,
    Set<(frame: DirectSealedEnvelopeV1) => void | Promise<void>>
  >();
  const desktopPrivateKey = decodeBase64Url(options.installation.encryptionPrivateKey, 32);

  const install = (values: readonly DirectFrameAuthorization[]) => {
    authorizations.clear();
    for (const value of values) authorizations.set(value.deviceId, value);
  };
  const frameAuthorization = (value: DirectFrameAuthorization) => ({
    deviceId: value.deviceId,
    allowedActions: value.scope,
    state: value.revokedAt ? ("revoked" as const) : ("active" as const),
    revision: value.revision,
  });
  const registry = {
    get(deviceId: string) {
      const value = authorizations.get(deviceId);
      return value ? frameAuthorization(value) : undefined;
    },
    authorize(input: { readonly deviceId: string; readonly action: RemoteAction }) {
      const value = authorizations.get(input.deviceId);
      if (!value || value.revokedAt || !value.scope.includes(input.action)) {
        throw Object.assign(new Error(value?.revokedAt ? "device_revoked" : "scope_denied"), {
          code: value?.revokedAt ? "device_revoked" : "scope_denied",
        });
      }
      return frameAuthorization(value);
    },
    list() {
      return [...authorizations.values()].map(frameAuthorization);
    },
  };

  const sendPlaintext = async (
    deviceId: string,
    contentType: RemoteSealedContentType,
    plaintext: object,
  ) => {
    const authorization = authorizations.get(deviceId);
    if (!authorization || authorization.revokedAt) {
      throw Object.assign(new Error("device_revoked"), { code: "device_revoked" });
    }
    const now = options.clock.now();
    const envelope = await sealDirectRemoteEnvelope({
      plaintext: new TextEncoder().encode(JSON.stringify(plaintext)),
      header: {
        protocolVersion: 1,
        envelopeId: options.id(),
        machineId: options.installation.machineId,
        deviceId,
        direction: "desktop-to-mobile",
        contentType,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 2 * 60_000).toISOString(),
      },
      recipient: {
        keyId: authorization.encryptionKeyId,
        publicKey: decodeBase64Url(authorization.encryptionPublicKey, 65),
      },
      senderPrivateKey: desktopPrivateKey,
    });
    const targets = [...(subscribers.get(deviceId) ?? [])];
    if (targets.length === 0) {
      throw Object.assign(new Error("machine_offline"), { code: "machine_offline" });
    }
    const results = await Promise.allSettled(targets.map((send) => send(envelope)));
    if (results.every((result) => result.status === "rejected")) {
      throw Object.assign(new Error("slow_consumer"), { code: "slow_consumer" });
    }
  };

  const processor = createDesktopRemoteFrameProcessor({
    machineId: options.installation.machineId,
    epoch: options.epoch,
    clock: options.clock,
    id: options.id,
    authorizations: registry,
    ledger: options.ledger,
    commands: options.commands,
    readSessionCatalog: options.readSessionCatalog,
    onOperationAccepted: options.onOperationAccepted,
    sendPlaintext,
  });

  return {
    currentCursor: processor.currentCursor,
    snapshot: processor.snapshot,
    async initialize() {
      install(await options.loadAuthorizations());
      await processor.initialize();
    },
    async refreshAuthorizations() {
      install(await options.loadAuthorizations());
    },
    refreshCatalog: processor.refreshCatalog,
    publishEvent: processor.publishEvent,
    publishRunState: processor.publishRunState,
    publishConversationEntries: processor.publishConversationEntries,
    subscribe(
      authorization: DirectFrameAuthorization,
      send: (frame: DirectSealedEnvelopeV1) => void | Promise<void>,
    ) {
      authorizations.set(authorization.deviceId, authorization);
      const values = subscribers.get(authorization.deviceId) ?? new Set();
      values.add(send);
      subscribers.set(authorization.deviceId, values);
      return {
        dispose() {
          values.delete(send);
          if (values.size === 0) subscribers.delete(authorization.deviceId);
        },
      };
    },
    async process(input: {
      readonly authorization: DirectFrameAuthorization;
      readonly envelope: DirectSealedEnvelopeV1;
    }): Promise<readonly DirectSealedEnvelopeV1[]> {
      authorizations.set(input.authorization.deviceId, input.authorization);
      const plaintext = await openDirectRemoteEnvelope({
        envelope: input.envelope,
        expectedMachineId: options.installation.machineId,
        expectedDeviceId: input.authorization.deviceId,
        expectedDirection: "mobile-to-desktop",
        senderPublicKey: decodeBase64Url(input.authorization.encryptionPublicKey, 65),
        now: options.clock.now(),
        resolveRecipientPrivateKey: (keyId) =>
          keyId === options.installation.encryptionKeyId ? desktopPrivateKey : undefined,
      });
      await processor.receivePlaintext(input.authorization.deviceId, json(plaintext));
      return [];
    },
    close() {
      subscribers.clear();
    },
  };
}
