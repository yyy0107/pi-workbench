export const REMOTE_CONTROL_PROTOCOL_VERSION = 1 as const;

export interface RemoteProtocolVersionRange {
  readonly min: number;
  readonly max: number;
}

export interface RemoteCursor {
  readonly epoch: string;
  readonly offset: string;
}

export type RemotePrincipalKind = "mobile" | "desktop";

export interface RemotePrincipalReference {
  readonly kind: RemotePrincipalKind;
  readonly id: string;
}

export interface PairingPayloadV1 {
  readonly type: "workbench.remote.pairing";
  readonly version: 1;
  readonly relayOrigin: string;
  readonly pairingId: string;
  readonly pairingSecret: string;
  readonly machineId: string;
  readonly desktopEncryptionKeyId: string;
  readonly desktopEncryptionPublicKey: string;
  readonly desktopEncryptionKeyFingerprint: string;
  readonly expiresAt: string;
}

export type DirectEndpointKindV1 = "local-network" | "tailscale";

export interface DirectEndpointV1 {
  readonly kind: DirectEndpointKindV1;
  readonly host: string;
  readonly port: number;
}

export interface DirectDesktopIdentityV1 {
  readonly machineId: string;
  readonly machineDisplayName: string;
  readonly desktopEncryptionKeyId: string;
  readonly desktopEncryptionPublicKey: string;
  readonly desktopEncryptionKeyFingerprint: string;
}

export interface DirectPairingPayloadV1 extends DirectDesktopIdentityV1 {
  readonly type: "workbench.remote.direct-pairing";
  readonly version: 1;
  readonly pairingId: string;
  readonly pairingSecret: string;
  readonly manualCode: string;
  readonly endpoints: readonly DirectEndpointV1[];
  readonly protocolRange: RemoteProtocolVersionRange;
  readonly expiresAt: string;
}

export interface DirectPairingHelloV1 extends DirectDesktopIdentityV1 {
  readonly type: "direct.pairing.hello";
  readonly version: 1;
  readonly pairingId: string;
  readonly endpoint: DirectEndpointV1;
  readonly protocolRange: RemoteProtocolVersionRange;
  readonly expiresAt: string;
}

export interface DirectPublicJwkV1 {
  readonly kty: "EC";
  readonly crv: "P-256";
  readonly x: string;
  readonly y: string;
  readonly key_ops?: readonly ["verify"];
  readonly ext?: true;
}

export interface DirectPairingClaimV1 {
  readonly type: "direct.pairing.claim";
  readonly pairingId: string;
  readonly secretProof: string;
  readonly deviceId: string;
  readonly deviceDisplayName: string;
  readonly platform: "ios" | "android";
  readonly mobileSigningPublicJwk: DirectPublicJwkV1;
  readonly mobileSigningKeyFingerprint: string;
  readonly mobileEncryptionKeyId: string;
  readonly mobileEncryptionPublicKey: string;
  readonly mobileEncryptionKeyFingerprint: string;
  readonly transcriptProof: string;
}

export interface DirectDeviceAuthorizationV1 {
  readonly deviceId: string;
  readonly deviceDisplayName: string;
  readonly platform: "ios" | "android";
  readonly mobileSigningPublicJwk: DirectPublicJwkV1;
  readonly mobileSigningKeyFingerprint: string;
  readonly mobileEncryptionKeyId: string;
  readonly mobileEncryptionPublicKey: string;
  readonly mobileEncryptionKeyFingerprint: string;
  readonly scope: readonly RemoteAction[];
  readonly authorizationRevision: string;
  readonly createdAt: string;
  readonly lastSeenAt?: string;
  readonly revokedAt?: string;
}

export type DirectPairingResultV1 =
  | {
      readonly type: "direct.pairing.result";
      readonly pairingId: string;
      readonly state: "confirmed";
      readonly deviceId: string;
      readonly authorizationRevision: string;
      readonly scope: readonly RemoteAction[];
      readonly desktopIdentity: DirectDesktopIdentityV1;
      readonly approvedEndpoints: readonly DirectEndpointV1[];
    }
  | {
      readonly type: "direct.pairing.result";
      readonly pairingId: string;
      readonly state: "denied" | "expired" | "locked";
      readonly code: RemoteErrorCodeV1;
    };

export interface DirectSocketChallengeV1 {
  readonly type: "direct.socket.challenge";
  readonly version: 1;
  readonly connectionId: string;
  readonly nonce: string;
  readonly machineId: string;
  readonly desktopEncryptionKeyId: string;
  readonly desktopEncryptionKeyFingerprint: string;
  readonly endpoint: DirectEndpointV1;
  readonly protocolRange: RemoteProtocolVersionRange;
  readonly expiresAt: string;
}

export interface DirectSocketAuthenticateV1 {
  readonly type: "direct.socket.authenticate";
  readonly version: 1;
  readonly connectionId: string;
  readonly deviceId: string;
  readonly authorizationRevision: string;
  readonly protocolRange: RemoteProtocolVersionRange;
  readonly resume: {
    readonly cursor?: RemoteCursor;
    readonly unresolvedOperationIds: readonly string[];
  };
  readonly challengeProof: string;
}

export interface DirectSocketAuthenticatedV1 {
  readonly type: "direct.socket.authenticated";
  readonly version: 1;
  readonly protocolVersion: 1;
  readonly connectionId: string;
  readonly machineId: string;
  readonly machineDisplayName: string;
  readonly deviceId: string;
  readonly authorizationRevision: string;
  readonly epoch: string;
}

export interface SocketAuthenticateV1 {
  readonly type: "socket.authenticate";
  readonly version: 1;
  readonly ticket: string;
  readonly challengeProof: string;
  readonly protocolRange: RemoteProtocolVersionRange;
  readonly resume?: {
    readonly cursor?: RemoteCursor;
    readonly unresolvedOperationIds: readonly string[];
  };
}

export interface SocketAuthenticatedV1 {
  readonly type: "socket.authenticated";
  readonly version: 1;
  readonly protocolVersion: 1;
  readonly principal: RemotePrincipalReference;
  readonly leaseGeneration?: string;
}

export type RemoteSealedContentType = "command" | "result" | "event" | "snapshot-chunk";

export interface RemoteSealedEnvelopeV1 {
  readonly protocolVersion: 1;
  readonly envelopeId: string;
  readonly machineId: string;
  readonly source: RemotePrincipalReference;
  readonly target: RemotePrincipalReference;
  readonly contentType: RemoteSealedContentType;
  readonly keyId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly hpke: {
    readonly suite: "P256-HKDFSHA256-AES256GCM";
    readonly enc: string;
    readonly ciphertext: string;
  };
}

export type DirectRemoteDirectionV1 = "mobile-to-desktop" | "desktop-to-mobile";
export type DirectSealedContentTypeV1 = RemoteSealedContentType | "pairing";

export interface DirectSealedEnvelopeV1 {
  readonly protocolVersion: 1;
  readonly envelopeId: string;
  readonly machineId: string;
  readonly deviceId: string;
  readonly direction: DirectRemoteDirectionV1;
  readonly contentType: DirectSealedContentTypeV1;
  readonly keyId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly hpke: {
    readonly suite: "P256-HKDFSHA256-AES256GCM";
    readonly enc: string;
    readonly ciphertext: string;
  };
}

export type RemoteAction =
  | "sessions.read"
  | "sessions.create"
  | "sessions.send"
  | "sessions.stop"
  | "sessions.organize"
  | "interactions.respond";

export interface RemoteQuestionAnswerV1 {
  readonly questionId: string;
  readonly optionIds?: readonly string[];
  readonly text?: string;
}

export type RemoteCommandV1 =
  | {
      readonly type: "session.create";
      readonly workspaceId?: string;
      readonly title?: string;
    }
  | {
      readonly type: "session.send";
      readonly sessionId: string;
      readonly text: string;
    }
  | {
      readonly type: "session.stop";
      readonly sessionId: string;
    }
  | {
      readonly type: "session.rename";
      readonly sessionId: string;
      readonly title: string;
      readonly expectedEntityRevision?: string;
    }
  | {
      readonly type: "session.setPinned";
      readonly sessionId: string;
      readonly pinned: boolean;
      readonly expectedEntityRevision?: string;
    }
  | {
      readonly type: "session.setArchived";
      readonly sessionId: string;
      readonly archived: true;
      readonly expectedEntityRevision?: string;
    }
  | {
      readonly type: "interaction.answerQuestion";
      readonly sessionId: string;
      readonly interactionId: string;
      readonly interactionRevision: string;
      readonly answers: readonly RemoteQuestionAnswerV1[];
    };

export interface RemoteOperationRequestV1 {
  readonly type: "operation.request";
  readonly operationId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly command: RemoteCommandV1;
}

export type RemoteControlQueryV1 =
  | { readonly type: "session.catalog.read" }
  | {
      readonly type: "conversation.history.read";
      readonly sessionId: string;
      readonly historyCursor?: string;
    }
  | {
      readonly type: "sync.recover";
      readonly cursor?: RemoteCursor;
      readonly unresolvedOperationIds: readonly string[];
    }
  | {
      readonly type: "operations.status";
      readonly operationIds: readonly string[];
    };

export interface RemoteControlRequestV1 {
  readonly type: "control.request";
  readonly requestId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly query: RemoteControlQueryV1;
}

export type RemoteOperationStateV1 = "accepted" | "succeeded" | "rejected" | "expired";

export type RemoteOperationResultValueV1 =
  | { readonly type: "session-created"; readonly sessionId: string }
  | {
      readonly type: "message-accepted";
      readonly sessionId: string;
      readonly messageId: string;
    }
  | {
      readonly type: "session-state";
      readonly sessionId: string;
      readonly entityRevision: string;
    }
  | { readonly type: "interaction-resolved"; readonly interactionId: string };

export interface RemoteOperationResultV1 {
  readonly type: "operation.result";
  readonly operationId: string;
  readonly state: RemoteOperationStateV1;
  readonly code?: RemoteErrorCodeV1;
  readonly value?: RemoteOperationResultValueV1;
  readonly appliedCursor?: RemoteCursor;
}

export type RemoteControlResponseValueV1 =
  | {
      readonly type: "session.catalog";
      readonly sessions: readonly RemoteSessionSummaryV1[];
      readonly projectionCursor: RemoteCursor;
    }
  | {
      readonly type: "conversation.history";
      readonly page: RemoteConversationPageV1;
    }
  | {
      readonly type: "sync.replay";
      readonly events: readonly RemoteEventV1[];
      readonly currentCursor: RemoteCursor;
    }
  | {
      readonly type: "sync.snapshot";
      readonly snapshotId: string;
    }
  | {
      readonly type: "operations.status";
      readonly results: readonly RemoteOperationResultV1[];
    };

export type RemoteControlResponseV1 =
  | {
      readonly type: "control.response";
      readonly requestId: string;
      readonly value: RemoteControlResponseValueV1;
    }
  | {
      readonly type: "control.response";
      readonly requestId: string;
      readonly error: RemoteErrorV1;
    };

export type RemoteErrorCodeV1 =
  | "authentication_failed"
  | "authorization_revision_changed"
  | "protocol_version_mismatch"
  | "device_not_paired"
  | "device_revoked"
  | "endpoint_not_allowed"
  | "identity_mismatch"
  | "listener_disabled"
  | "listener_failed"
  | "pairing_denied"
  | "pairing_expired"
  | "pairing_locked"
  | "scope_denied"
  | "machine_offline"
  | "machine_lease_changed"
  | "operation_expired"
  | "operation_id_conflict"
  | "operation_not_found"
  | "entity_revision_conflict"
  | "interaction_not_pending"
  | "interaction_expired"
  | "cursor_expired"
  | "cursor_gap"
  | "epoch_changed"
  | "snapshot_required"
  | "payload_too_large"
  | "rate_limited"
  | "slow_consumer"
  | "invalid_frame"
  | "internal";

export type RemoteJsonPrimitive = boolean | number | string | null;
export type RemoteJsonValue =
  | RemoteJsonPrimitive
  | readonly RemoteJsonValue[]
  | { readonly [key: string]: RemoteJsonValue };

export interface RemoteErrorV1 {
  readonly type: "remote.error";
  readonly version: 1;
  readonly code: RemoteErrorCodeV1;
  readonly details?: Readonly<Record<string, RemoteJsonValue>>;
}

export type RemoteMachinePresence = "online" | "offline" | "reconnecting" | "incompatible";

export interface RemoteMachineSummaryV1 {
  readonly machineId: string;
  readonly displayName: string;
  readonly presence: RemoteMachinePresence;
  readonly lastSeenAt: string;
  readonly protocolRange: RemoteProtocolVersionRange;
}

export type RemoteRunStateV1 =
  | "idle"
  | "queued"
  | "running"
  | "waiting-for-input"
  | "stopping"
  | "completed"
  | "stopped"
  | "failed";

export type RemoteAttentionStateV1 = "none" | "unread" | "input-needed" | "failed";

export interface RemoteSessionSummaryV1 {
  readonly sessionId: string;
  readonly workspace?: {
    readonly workspaceId: string;
    readonly displayName: string;
  };
  readonly title?: string;
  readonly updatedAt: string;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly attention: RemoteAttentionStateV1;
  readonly runState: RemoteRunStateV1;
  readonly entityRevision: string;
}

export interface RemoteOrdinaryQuestionV1 {
  readonly type: "ordinary-question";
  readonly interactionId: string;
  readonly sessionId: string;
  readonly revision: string;
  readonly expiresAt: string;
  readonly questions: readonly {
    readonly questionId: string;
    readonly prompt: string;
    readonly options?: readonly { readonly optionId: string; readonly label: string }[];
  }[];
}

export interface RemoteToolCallV1 {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly arguments: string;
  readonly truncated: boolean;
}

export type RemoteConversationItemV1 =
  | {
      readonly type: "user-message";
      readonly itemId: string;
      readonly createdAt: string;
      readonly text: string;
      readonly textTruncated?: boolean;
      readonly state: "complete" | "streaming" | "failed";
    }
  | {
      readonly type: "assistant-message";
      readonly itemId: string;
      readonly createdAt: string;
      readonly text?: string;
      readonly textTruncated?: boolean;
      readonly toolCalls?: readonly RemoteToolCallV1[];
      readonly state: "complete" | "streaming" | "failed";
    }
  | {
      readonly type: "tool-result";
      readonly itemId: string;
      readonly createdAt: string;
      readonly toolCallId: string;
      readonly toolName: string;
      readonly input?: string;
      readonly output: string;
      readonly isError: boolean;
      readonly truncated: boolean;
    }
  | {
      readonly type: "activity-summary";
      readonly itemId: string;
      readonly createdAt: string;
      readonly activity: "tool-running" | "tool-completed" | "tool-failed";
      readonly displayName: string;
      readonly summary?: string;
    }
  | RemoteOrdinaryQuestionV1
  | {
      readonly type: "system-status";
      readonly itemId: string;
      readonly createdAt: string;
      readonly status: "stopped" | "failed" | "content-available-on-desktop";
    };

export interface RemoteConversationPageV1 {
  readonly sessionId: string;
  readonly items: readonly RemoteConversationItemV1[];
  readonly historyCursor: string;
  readonly nextCursor?: string;
  readonly sessionRevision: string;
  readonly projectionCursor: RemoteCursor;
}

export type RemoteEventPayloadV1 =
  | { readonly type: "machine.presenceChanged"; readonly machine: RemoteMachineSummaryV1 }
  | { readonly type: "session.upserted"; readonly session: RemoteSessionSummaryV1 }
  | { readonly type: "session.removed"; readonly sessionId: string }
  | {
      readonly type: "session.runChanged";
      readonly sessionId: string;
      readonly runState: RemoteRunStateV1;
    }
  | {
      readonly type: "session.messageAppended";
      readonly sessionId: string;
      readonly item: RemoteConversationItemV1;
    }
  | {
      readonly type: "session.messageDelta";
      readonly sessionId: string;
      readonly streamId: string;
      readonly revision: string;
      readonly delta: string;
    }
  | { readonly type: "interaction.upserted"; readonly interaction: RemoteOrdinaryQuestionV1 }
  | { readonly type: "interaction.resolved"; readonly interactionId: string }
  | RemoteOperationResultV1;

export interface RemoteEventV1 {
  readonly type: "sync.event";
  readonly eventId: string;
  readonly cursor: RemoteCursor;
  readonly createdAt: string;
  readonly payload: RemoteEventPayloadV1;
}

export interface RemoteSnapshotChunkV1 {
  readonly type: "snapshot.chunk";
  readonly snapshotId: string;
  readonly partIndex: number;
  readonly partCount: number;
  readonly sessions: readonly RemoteSessionSummaryV1[];
}

export interface RemoteSnapshotCompleteV1 {
  readonly type: "snapshot.complete";
  readonly snapshotId: string;
  readonly baseCursor: RemoteCursor;
}

export interface RemotePushHintV1 {
  readonly version: 1;
  readonly hintId: string;
  readonly machineId: string;
  readonly sessionId?: string;
  readonly kind: "attention" | "state-changed";
}
