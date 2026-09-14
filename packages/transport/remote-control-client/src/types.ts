import type {
  DirectEndpointV1,
  DirectSealedEnvelopeV1,
  RemoteCursor,
  RemoteProtocolVersionRange,
} from "@workbench/remote-control-contracts/protocol";

export type RemoteControlSendResult = "sent" | "backpressured" | "not-ready" | "payload-too-large";

export type DirectRemoteControlClientState =
  | "offline"
  | "connecting"
  | "pairing"
  | "authenticating"
  | "synchronizing"
  | "ready"
  | "reconnecting"
  | "suspended"
  | "incompatible"
  | "identity-mismatch"
  | "revoked";

export interface DirectRemoteControlConnectionStartInput {
  readonly endpoints: readonly DirectEndpointV1[];
  readonly machineId: string;
  readonly deviceId: string;
  readonly authorizationRevision: string;
  readonly desktopEncryptionKeyId: string;
  readonly desktopEncryptionKeyFingerprint: string;
  readonly protocolRange: RemoteProtocolVersionRange;
  readonly resume?: {
    readonly cursor?: RemoteCursor;
    readonly unresolvedOperationIds: readonly string[];
  };
}

export interface DirectRemoteControlConnectionObserver {
  onEnvelope?(envelope: DirectSealedEnvelopeV1): void;
  onStateChanged?(state: DirectRemoteControlClientState): void;
}
