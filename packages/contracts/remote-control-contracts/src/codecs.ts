import {
  REMOTE_PROTOCOL_LIMITS,
  canonicalJson,
  hasOnlyKeys,
  isBoundedString,
  isJsonValueWithinLimits,
  isRemoteCursorOffset,
  isRemoteIdentifier,
  isRemotePlainObject,
  isRemoteTimestamp,
  remoteUtf8ByteLength,
} from "../lib/bounds";
import {
  REMOTE_CONTROL_PROTOCOL_VERSION,
  type DirectDesktopIdentityV1,
  type DirectEndpointV1,
  type DirectPairingHelloV1,
  type DirectPairingClaimV1,
  type DirectPairingPayloadV1,
  type DirectPairingResultV1,
  type DirectPublicJwkV1,
  type DirectSealedEnvelopeV1,
  type DirectSocketAuthenticatedV1,
  type DirectSocketAuthenticateV1,
  type DirectSocketChallengeV1,
  type RemoteCommandV1,
  type RemoteConversationItemV1,
  type RemoteConversationPageV1,
  type RemoteControlQueryV1,
  type RemoteControlRequestV1,
  type RemoteControlResponseV1,
  type RemoteCursor,
  type RemoteErrorCodeV1,
  type RemoteErrorV1,
  type RemoteEventV1,
  type RemoteOperationRequestV1,
  type RemoteOperationResultV1,
  type RemoteProtocolVersionRange,
  type RemoteQuestionAnswerV1,
  type RemoteSnapshotChunkV1,
  type RemoteSnapshotCompleteV1,
} from "./protocol";

export { REMOTE_CONTROL_PROTOCOL_VERSION } from "./protocol";
export { canonicalJson, REMOTE_PROTOCOL_LIMITS, remoteUtf8ByteLength } from "../lib/bounds";

const ERROR_CODES = new Set<RemoteErrorCodeV1>([
  "authentication_failed",
  "authorization_revision_changed",
  "protocol_version_mismatch",
  "device_not_paired",
  "device_revoked",
  "endpoint_not_allowed",
  "identity_mismatch",
  "listener_disabled",
  "listener_failed",
  "pairing_denied",
  "pairing_expired",
  "pairing_locked",
  "scope_denied",
  "machine_offline",
  "machine_lease_changed",
  "operation_expired",
  "operation_id_conflict",
  "operation_not_found",
  "entity_revision_conflict",
  "interaction_not_pending",
  "interaction_expired",
  "cursor_expired",
  "cursor_gap",
  "epoch_changed",
  "snapshot_required",
  "payload_too_large",
  "rate_limited",
  "slow_consumer",
  "invalid_frame",
  "internal",
]);

function parseProtocolVersionRange(value: unknown): RemoteProtocolVersionRange | undefined {
  if (
    !isRemotePlainObject(value) ||
    !hasOnlyKeys(value, ["min", "max"]) ||
    !Number.isSafeInteger(value.min) ||
    !Number.isSafeInteger(value.max) ||
    (value.min as number) < 1 ||
    (value.max as number) < (value.min as number)
  ) {
    return undefined;
  }
  return value as unknown as RemoteProtocolVersionRange;
}

export function negotiateRemoteProtocolVersion(
  left: RemoteProtocolVersionRange,
  right: RemoteProtocolVersionRange,
): number | undefined {
  const validLeft = parseProtocolVersionRange(left);
  const validRight = parseProtocolVersionRange(right);
  if (!validLeft || !validRight) return undefined;
  const version = Math.min(validLeft.max, validRight.max);
  return version >= Math.max(validLeft.min, validRight.min) ? version : undefined;
}

export function parseRemoteCursor(value: unknown): RemoteCursor | undefined {
  if (
    !isRemotePlainObject(value) ||
    !hasOnlyKeys(value, ["epoch", "offset"]) ||
    !isRemoteIdentifier(value.epoch) ||
    !isRemoteCursorOffset(value.offset)
  ) {
    return undefined;
  }
  return value as unknown as RemoteCursor;
}

function isBase64Url(value: unknown, maximumBytes: number): value is string {
  return isBoundedString(value, maximumBytes) && /^[A-Za-z0-9_-]+$/u.test(value);
}

function parseDirectHost(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 253 ||
    !/^[\x21-\x7e]+$/u.test(value) ||
    /[\s/?#@]/u.test(value) ||
    value.includes("[") ||
    value.includes("]") ||
    value.includes("://")
  ) {
    return undefined;
  }
  return value;
}

export function parseDirectEndpointV1(value: unknown): DirectEndpointV1 | undefined {
  if (
    !isRemotePlainObject(value) ||
    !hasOnlyKeys(value, ["kind", "host", "port"]) ||
    (value.kind !== "local-network" && value.kind !== "tailscale") ||
    !parseDirectHost(value.host) ||
    !Number.isSafeInteger(value.port) ||
    (value.port as number) < 1 ||
    (value.port as number) > 65_535
  ) {
    return undefined;
  }
  return value as unknown as DirectEndpointV1;
}

function parseDirectDesktopIdentity(
  value: Record<string, unknown>,
): DirectDesktopIdentityV1 | undefined {
  if (
    !isRemoteIdentifier(value.machineId) ||
    !isBoundedString(value.machineDisplayName, 128) ||
    !isRemoteIdentifier(value.desktopEncryptionKeyId) ||
    !isBase64Url(value.desktopEncryptionPublicKey, 4_096) ||
    value.desktopEncryptionPublicKey.length < 43 ||
    !isBoundedString(value.desktopEncryptionKeyFingerprint, 256)
  ) {
    return undefined;
  }
  return value as unknown as DirectDesktopIdentityV1;
}

function parseDirectPublicJwk(value: unknown): DirectPublicJwkV1 | undefined {
  if (
    !isRemotePlainObject(value) ||
    !hasOnlyKeys(value, ["kty", "crv", "x", "y"], ["key_ops", "ext"]) ||
    value.kty !== "EC" ||
    value.crv !== "P-256" ||
    !isBase64Url(value.x, 128) ||
    !isBase64Url(value.y, 128) ||
    value.x.length !== 43 ||
    value.y.length !== 43 ||
    (value.key_ops !== undefined &&
      (!Array.isArray(value.key_ops) ||
        value.key_ops.length !== 1 ||
        value.key_ops[0] !== "verify")) ||
    (value.ext !== undefined && value.ext !== true)
  ) {
    return undefined;
  }
  return value as unknown as DirectPublicJwkV1;
}

export function parseDirectPairingPayloadV1(value: unknown): DirectPairingPayloadV1 | undefined {
  if (
    !isRemotePlainObject(value) ||
    !hasOnlyKeys(value, [
      "type",
      "version",
      "pairingId",
      "pairingSecret",
      "manualCode",
      "machineId",
      "machineDisplayName",
      "endpoints",
      "desktopEncryptionKeyId",
      "desktopEncryptionPublicKey",
      "desktopEncryptionKeyFingerprint",
      "protocolRange",
      "expiresAt",
    ]) ||
    value.type !== "workbench.remote.direct-pairing" ||
    value.version !== REMOTE_CONTROL_PROTOCOL_VERSION ||
    !isRemoteIdentifier(value.pairingId) ||
    !isBase64Url(value.pairingSecret, 512) ||
    value.pairingSecret.length < 43 ||
    !isBoundedString(value.manualCode, 32) ||
    !/^[A-HJ-NP-Z2-9]{8,16}$/u.test(value.manualCode) ||
    !parseDirectDesktopIdentity(value) ||
    !Array.isArray(value.endpoints) ||
    value.endpoints.length < 1 ||
    value.endpoints.length > 8 ||
    !value.endpoints.every((endpoint) => parseDirectEndpointV1(endpoint) !== undefined) ||
    !parseProtocolVersionRange(value.protocolRange) ||
    !isRemoteTimestamp(value.expiresAt) ||
    !isJsonValueWithinLimits(value, {
      maximumBytes: REMOTE_PROTOCOL_LIMITS.authenticationFrameBytes,
    })
  ) {
    return undefined;
  }
  return value as unknown as DirectPairingPayloadV1;
}

export function parseDirectPairingHelloV1(value: unknown): DirectPairingHelloV1 | undefined {
  if (
    !isRemotePlainObject(value) ||
    !hasOnlyKeys(value, [
      "type",
      "version",
      "pairingId",
      "machineId",
      "machineDisplayName",
      "endpoint",
      "desktopEncryptionKeyId",
      "desktopEncryptionPublicKey",
      "desktopEncryptionKeyFingerprint",
      "protocolRange",
      "expiresAt",
    ]) ||
    value.type !== "direct.pairing.hello" ||
    value.version !== REMOTE_CONTROL_PROTOCOL_VERSION ||
    !isRemoteIdentifier(value.pairingId) ||
    !parseDirectDesktopIdentity(value) ||
    !parseDirectEndpointV1(value.endpoint) ||
    !parseProtocolVersionRange(value.protocolRange) ||
    !isRemoteTimestamp(value.expiresAt) ||
    !isJsonValueWithinLimits(value, {
      maximumBytes: REMOTE_PROTOCOL_LIMITS.authenticationFrameBytes,
    })
  ) {
    return undefined;
  }
  return value as unknown as DirectPairingHelloV1;
}

export function parseDirectPairingClaimV1(value: unknown): DirectPairingClaimV1 | undefined {
  if (
    !isRemotePlainObject(value) ||
    !hasOnlyKeys(value, [
      "type",
      "pairingId",
      "secretProof",
      "deviceId",
      "deviceDisplayName",
      "platform",
      "mobileSigningPublicJwk",
      "mobileSigningKeyFingerprint",
      "mobileEncryptionKeyId",
      "mobileEncryptionPublicKey",
      "mobileEncryptionKeyFingerprint",
      "transcriptProof",
    ]) ||
    value.type !== "direct.pairing.claim" ||
    !isRemoteIdentifier(value.pairingId) ||
    !isBase64Url(value.secretProof, 512) ||
    !isRemoteIdentifier(value.deviceId) ||
    !isBoundedString(value.deviceDisplayName, 128) ||
    (value.platform !== "ios" && value.platform !== "android") ||
    !parseDirectPublicJwk(value.mobileSigningPublicJwk) ||
    !isBoundedString(value.mobileSigningKeyFingerprint, 256) ||
    !isRemoteIdentifier(value.mobileEncryptionKeyId) ||
    !isBase64Url(value.mobileEncryptionPublicKey, 4_096) ||
    value.mobileEncryptionPublicKey.length < 43 ||
    !isBoundedString(value.mobileEncryptionKeyFingerprint, 256) ||
    !isBase64Url(value.transcriptProof, 4_096) ||
    !isJsonValueWithinLimits(value, {
      maximumBytes: REMOTE_PROTOCOL_LIMITS.authenticationFrameBytes,
    })
  ) {
    return undefined;
  }
  return value as unknown as DirectPairingClaimV1;
}

function parseRemoteActionList(
  value: unknown,
): value is readonly import("./protocol").RemoteAction[] {
  const actions = [
    "sessions.read",
    "sessions.create",
    "sessions.send",
    "sessions.stop",
    "sessions.organize",
    "interactions.respond",
  ] as const;
  return (
    Array.isArray(value) &&
    value.length === actions.length &&
    value.every((action, index) => action === actions[index])
  );
}

export function parseDirectPairingResultV1(value: unknown): DirectPairingResultV1 | undefined {
  if (
    !isRemotePlainObject(value) ||
    value.type !== "direct.pairing.result" ||
    !isRemoteIdentifier(value.pairingId) ||
    !isJsonValueWithinLimits(value, {
      maximumBytes: REMOTE_PROTOCOL_LIMITS.authenticationFrameBytes,
    })
  ) {
    return undefined;
  }
  if (value.state === "confirmed") {
    if (
      !hasOnlyKeys(value, [
        "type",
        "pairingId",
        "state",
        "deviceId",
        "authorizationRevision",
        "scope",
        "desktopIdentity",
        "approvedEndpoints",
      ]) ||
      !isRemoteIdentifier(value.deviceId) ||
      !isRemoteIdentifier(value.authorizationRevision) ||
      !parseRemoteActionList(value.scope) ||
      !isRemotePlainObject(value.desktopIdentity) ||
      !hasOnlyKeys(value.desktopIdentity, [
        "machineId",
        "machineDisplayName",
        "desktopEncryptionKeyId",
        "desktopEncryptionPublicKey",
        "desktopEncryptionKeyFingerprint",
      ]) ||
      !parseDirectDesktopIdentity(value.desktopIdentity) ||
      !Array.isArray(value.approvedEndpoints) ||
      value.approvedEndpoints.length < 1 ||
      value.approvedEndpoints.length > 8 ||
      !value.approvedEndpoints.every((endpoint) => parseDirectEndpointV1(endpoint) !== undefined)
    ) {
      return undefined;
    }
    return value as unknown as DirectPairingResultV1;
  }
  if (value.state === "denied" || value.state === "expired" || value.state === "locked") {
    if (
      !hasOnlyKeys(value, ["type", "pairingId", "state", "code"]) ||
      typeof value.code !== "string" ||
      !ERROR_CODES.has(value.code as RemoteErrorCodeV1)
    ) {
      return undefined;
    }
    return value as unknown as DirectPairingResultV1;
  }
  return undefined;
}

export function parseDirectSocketChallengeV1(value: unknown): DirectSocketChallengeV1 | undefined {
  if (
    !isRemotePlainObject(value) ||
    !hasOnlyKeys(value, [
      "type",
      "version",
      "connectionId",
      "nonce",
      "machineId",
      "desktopEncryptionKeyId",
      "desktopEncryptionKeyFingerprint",
      "endpoint",
      "protocolRange",
      "expiresAt",
    ]) ||
    value.type !== "direct.socket.challenge" ||
    value.version !== REMOTE_CONTROL_PROTOCOL_VERSION ||
    !isRemoteIdentifier(value.connectionId) ||
    !isBase64Url(value.nonce, 512) ||
    value.nonce.length < 43 ||
    !isRemoteIdentifier(value.machineId) ||
    !isRemoteIdentifier(value.desktopEncryptionKeyId) ||
    !isBoundedString(value.desktopEncryptionKeyFingerprint, 256) ||
    !parseDirectEndpointV1(value.endpoint) ||
    !parseProtocolVersionRange(value.protocolRange) ||
    !isRemoteTimestamp(value.expiresAt) ||
    !isJsonValueWithinLimits(value, {
      maximumBytes: REMOTE_PROTOCOL_LIMITS.authenticationFrameBytes,
    })
  ) {
    return undefined;
  }
  return value as unknown as DirectSocketChallengeV1;
}

export function parseDirectSocketAuthenticateV1(
  value: unknown,
): DirectSocketAuthenticateV1 | undefined {
  if (
    !isRemotePlainObject(value) ||
    !hasOnlyKeys(value, [
      "type",
      "version",
      "connectionId",
      "deviceId",
      "authorizationRevision",
      "protocolRange",
      "resume",
      "challengeProof",
    ]) ||
    value.type !== "direct.socket.authenticate" ||
    value.version !== REMOTE_CONTROL_PROTOCOL_VERSION ||
    !isRemoteIdentifier(value.connectionId) ||
    !isRemoteIdentifier(value.deviceId) ||
    !isRemoteIdentifier(value.authorizationRevision) ||
    !parseProtocolVersionRange(value.protocolRange) ||
    !isRemotePlainObject(value.resume) ||
    !hasOnlyKeys(value.resume, ["unresolvedOperationIds"], ["cursor"]) ||
    (value.resume.cursor !== undefined && !parseRemoteCursor(value.resume.cursor)) ||
    !Array.isArray(value.resume.unresolvedOperationIds) ||
    value.resume.unresolvedOperationIds.length > 100 ||
    !value.resume.unresolvedOperationIds.every(isRemoteIdentifier) ||
    !isBase64Url(value.challengeProof, 4_096) ||
    !isJsonValueWithinLimits(value, {
      maximumBytes: REMOTE_PROTOCOL_LIMITS.authenticationFrameBytes,
    })
  ) {
    return undefined;
  }
  return value as unknown as DirectSocketAuthenticateV1;
}

export function parseDirectSocketAuthenticatedV1(
  value: unknown,
): DirectSocketAuthenticatedV1 | undefined {
  if (
    !isRemotePlainObject(value) ||
    !hasOnlyKeys(value, [
      "type",
      "version",
      "protocolVersion",
      "connectionId",
      "machineId",
      "machineDisplayName",
      "deviceId",
      "authorizationRevision",
      "epoch",
    ]) ||
    value.type !== "direct.socket.authenticated" ||
    value.version !== REMOTE_CONTROL_PROTOCOL_VERSION ||
    value.protocolVersion !== REMOTE_CONTROL_PROTOCOL_VERSION ||
    !isRemoteIdentifier(value.connectionId) ||
    !isRemoteIdentifier(value.machineId) ||
    !isBoundedString(value.machineDisplayName, 128) ||
    !isRemoteIdentifier(value.deviceId) ||
    !isRemoteIdentifier(value.authorizationRevision) ||
    !isRemoteIdentifier(value.epoch) ||
    !isJsonValueWithinLimits(value, {
      maximumBytes: REMOTE_PROTOCOL_LIMITS.authenticationFrameBytes,
    })
  ) {
    return undefined;
  }
  return value as unknown as DirectSocketAuthenticatedV1;
}

export function parseDirectSealedEnvelopeV1(value: unknown): DirectSealedEnvelopeV1 | undefined {
  if (
    !isRemotePlainObject(value) ||
    !hasOnlyKeys(value, [
      "protocolVersion",
      "envelopeId",
      "machineId",
      "deviceId",
      "direction",
      "contentType",
      "keyId",
      "createdAt",
      "expiresAt",
      "hpke",
    ]) ||
    value.protocolVersion !== REMOTE_CONTROL_PROTOCOL_VERSION ||
    !isRemoteIdentifier(value.envelopeId) ||
    !isRemoteIdentifier(value.machineId) ||
    !isRemoteIdentifier(value.deviceId) ||
    (value.direction !== "mobile-to-desktop" && value.direction !== "desktop-to-mobile") ||
    !["pairing", "command", "result", "event", "snapshot-chunk"].includes(
      String(value.contentType),
    ) ||
    !isRemoteIdentifier(value.keyId) ||
    !isRemoteTimestamp(value.createdAt) ||
    !isRemoteTimestamp(value.expiresAt) ||
    Date.parse(value.expiresAt) <= Date.parse(value.createdAt) ||
    !isRemotePlainObject(value.hpke) ||
    !hasOnlyKeys(value.hpke, ["suite", "enc", "ciphertext"]) ||
    value.hpke.suite !== "P256-HKDFSHA256-AES256GCM" ||
    !isBase64Url(value.hpke.enc, 4_096) ||
    !isBase64Url(value.hpke.ciphertext, REMOTE_PROTOCOL_LIMITS.sealedEnvelopeBytes) ||
    remoteUtf8ByteLength(canonicalJson(value)) > REMOTE_PROTOCOL_LIMITS.sealedEnvelopeBytes
  ) {
    return undefined;
  }
  return value as unknown as DirectSealedEnvelopeV1;
}

function parseQuestionAnswer(value: unknown): RemoteQuestionAnswerV1 | undefined {
  if (
    !isRemotePlainObject(value) ||
    !hasOnlyKeys(value, ["questionId"], ["optionIds", "text"]) ||
    !isRemoteIdentifier(value.questionId) ||
    (value.optionIds === undefined && value.text === undefined) ||
    (value.optionIds !== undefined &&
      (!Array.isArray(value.optionIds) ||
        value.optionIds.length > 32 ||
        !value.optionIds.every(isRemoteIdentifier))) ||
    (value.text !== undefined &&
      !isBoundedString(value.text, REMOTE_PROTOCOL_LIMITS.answerAggregateBytes))
  ) {
    return undefined;
  }
  return value as unknown as RemoteQuestionAnswerV1;
}

function optionalRevision(value: unknown): boolean {
  return value === undefined || isRemoteIdentifier(value);
}

function parseRemoteCommandV1(value: unknown): RemoteCommandV1 | undefined {
  if (!isRemotePlainObject(value) || typeof value.type !== "string") return undefined;
  switch (value.type) {
    case "session.create":
      if (
        !hasOnlyKeys(value, ["type"], ["workspaceId", "title"]) ||
        (value.workspaceId !== undefined && !isRemoteIdentifier(value.workspaceId)) ||
        (value.title !== undefined &&
          !isBoundedString(value.title, REMOTE_PROTOCOL_LIMITS.titleBytes))
      ) {
        return undefined;
      }
      break;
    case "session.send":
      if (
        !hasOnlyKeys(value, ["type", "sessionId", "text"]) ||
        !isRemoteIdentifier(value.sessionId) ||
        !isBoundedString(value.text, REMOTE_PROTOCOL_LIMITS.textPromptBytes)
      ) {
        return undefined;
      }
      break;
    case "session.stop":
      if (!hasOnlyKeys(value, ["type", "sessionId"]) || !isRemoteIdentifier(value.sessionId)) {
        return undefined;
      }
      break;
    case "session.rename":
      if (
        !hasOnlyKeys(value, ["type", "sessionId", "title"], ["expectedEntityRevision"]) ||
        !isRemoteIdentifier(value.sessionId) ||
        !isBoundedString(value.title, REMOTE_PROTOCOL_LIMITS.titleBytes) ||
        !optionalRevision(value.expectedEntityRevision)
      ) {
        return undefined;
      }
      break;
    case "session.setPinned":
      if (
        !hasOnlyKeys(value, ["type", "sessionId", "pinned"], ["expectedEntityRevision"]) ||
        !isRemoteIdentifier(value.sessionId) ||
        typeof value.pinned !== "boolean" ||
        !optionalRevision(value.expectedEntityRevision)
      ) {
        return undefined;
      }
      break;
    case "session.setArchived":
      if (
        !hasOnlyKeys(value, ["type", "sessionId", "archived"], ["expectedEntityRevision"]) ||
        !isRemoteIdentifier(value.sessionId) ||
        value.archived !== true ||
        !optionalRevision(value.expectedEntityRevision)
      ) {
        return undefined;
      }
      break;
    case "interaction.answerQuestion":
      if (
        !hasOnlyKeys(value, [
          "type",
          "sessionId",
          "interactionId",
          "interactionRevision",
          "answers",
        ]) ||
        !isRemoteIdentifier(value.sessionId) ||
        !isRemoteIdentifier(value.interactionId) ||
        !isRemoteIdentifier(value.interactionRevision) ||
        !Array.isArray(value.answers) ||
        value.answers.length === 0 ||
        value.answers.length > 32 ||
        !value.answers.every((answer) => parseQuestionAnswer(answer) !== undefined) ||
        remoteUtf8ByteLength(canonicalJson(value.answers)) >
          REMOTE_PROTOCOL_LIMITS.answerAggregateBytes
      ) {
        return undefined;
      }
      break;
    default:
      return undefined;
  }
  if (remoteUtf8ByteLength(canonicalJson(value)) > REMOTE_PROTOCOL_LIMITS.commandPlaintextBytes) {
    return undefined;
  }
  return value as RemoteCommandV1;
}

export function parseRemoteOperationRequestV1(
  value: unknown,
): RemoteOperationRequestV1 | undefined {
  if (
    !isRemotePlainObject(value) ||
    !hasOnlyKeys(value, ["type", "operationId", "issuedAt", "expiresAt", "command"]) ||
    value.type !== "operation.request" ||
    !isRemoteIdentifier(value.operationId) ||
    !isRemoteTimestamp(value.issuedAt) ||
    !isRemoteTimestamp(value.expiresAt) ||
    Date.parse(value.expiresAt) <= Date.parse(value.issuedAt) ||
    !parseRemoteCommandV1(value.command) ||
    remoteUtf8ByteLength(canonicalJson(value)) > REMOTE_PROTOCOL_LIMITS.commandPlaintextBytes
  ) {
    return undefined;
  }
  return value as unknown as RemoteOperationRequestV1;
}

function parseRemoteControlQueryV1(value: unknown): RemoteControlQueryV1 | undefined {
  if (!isRemotePlainObject(value) || typeof value.type !== "string") return undefined;
  switch (value.type) {
    case "session.catalog.read":
      if (!hasOnlyKeys(value, ["type"])) return undefined;
      break;
    case "conversation.history.read":
      if (
        !hasOnlyKeys(value, ["type", "sessionId"], ["historyCursor"]) ||
        !isRemoteIdentifier(value.sessionId) ||
        (value.historyCursor !== undefined && !isRemoteIdentifier(value.historyCursor))
      ) {
        return undefined;
      }
      break;
    case "sync.recover":
      if (
        !hasOnlyKeys(value, ["type", "unresolvedOperationIds"], ["cursor"]) ||
        (value.cursor !== undefined && !parseRemoteCursor(value.cursor)) ||
        !Array.isArray(value.unresolvedOperationIds) ||
        value.unresolvedOperationIds.length > 100 ||
        !value.unresolvedOperationIds.every(isRemoteIdentifier)
      ) {
        return undefined;
      }
      break;
    case "operations.status":
      if (
        !hasOnlyKeys(value, ["type", "operationIds"]) ||
        !Array.isArray(value.operationIds) ||
        value.operationIds.length === 0 ||
        value.operationIds.length > 100 ||
        !value.operationIds.every(isRemoteIdentifier)
      ) {
        return undefined;
      }
      break;
    default:
      return undefined;
  }
  return value as RemoteControlQueryV1;
}

export function parseRemoteControlRequestV1(value: unknown): RemoteControlRequestV1 | undefined {
  if (
    !isRemotePlainObject(value) ||
    !hasOnlyKeys(value, ["type", "requestId", "issuedAt", "expiresAt", "query"]) ||
    value.type !== "control.request" ||
    !isRemoteIdentifier(value.requestId) ||
    !isRemoteTimestamp(value.issuedAt) ||
    !isRemoteTimestamp(value.expiresAt) ||
    Date.parse(value.expiresAt) <= Date.parse(value.issuedAt) ||
    !parseRemoteControlQueryV1(value.query) ||
    !isJsonValueWithinLimits(value, {
      maximumBytes: REMOTE_PROTOCOL_LIMITS.commandPlaintextBytes,
    })
  ) {
    return undefined;
  }
  return value as unknown as RemoteControlRequestV1;
}

export function parseRemoteOperationResultV1(value: unknown): RemoteOperationResultV1 | undefined {
  if (
    !isRemotePlainObject(value) ||
    !hasOnlyKeys(value, ["type", "operationId", "state"], ["code", "value", "appliedCursor"]) ||
    value.type !== "operation.result" ||
    !isRemoteIdentifier(value.operationId) ||
    !["accepted", "succeeded", "rejected", "expired"].includes(String(value.state)) ||
    (value.code !== undefined &&
      (typeof value.code !== "string" || !ERROR_CODES.has(value.code as RemoteErrorCodeV1))) ||
    (value.appliedCursor !== undefined && !parseRemoteCursor(value.appliedCursor))
  ) {
    return undefined;
  }
  if (value.value !== undefined) {
    if (!isRemotePlainObject(value.value) || typeof value.value.type !== "string") return undefined;
    switch (value.value.type) {
      case "session-created":
        if (
          !hasOnlyKeys(value.value, ["type", "sessionId"]) ||
          !isRemoteIdentifier(value.value.sessionId)
        ) {
          return undefined;
        }
        break;
      case "message-accepted":
        if (
          !hasOnlyKeys(value.value, ["type", "sessionId", "messageId"]) ||
          !isRemoteIdentifier(value.value.sessionId) ||
          !isRemoteIdentifier(value.value.messageId)
        ) {
          return undefined;
        }
        break;
      case "session-state":
        if (
          !hasOnlyKeys(value.value, ["type", "sessionId", "entityRevision"]) ||
          !isRemoteIdentifier(value.value.sessionId) ||
          !isRemoteIdentifier(value.value.entityRevision)
        ) {
          return undefined;
        }
        break;
      case "interaction-resolved":
        if (
          !hasOnlyKeys(value.value, ["type", "interactionId"]) ||
          !isRemoteIdentifier(value.value.interactionId)
        ) {
          return undefined;
        }
        break;
      default:
        return undefined;
    }
  }
  if (
    (value.state === "accepted" && (value.code !== undefined || value.value !== undefined)) ||
    ((value.state === "rejected" || value.state === "expired") && value.value !== undefined) ||
    !isJsonValueWithinLimits(value, {
      maximumBytes: REMOTE_PROTOCOL_LIMITS.commandPlaintextBytes,
    })
  ) {
    return undefined;
  }
  return value as unknown as RemoteOperationResultV1;
}

export function parseRemoteConversationItemV1(
  value: unknown,
): RemoteConversationItemV1 | undefined {
  if (!isRemotePlainObject(value) || typeof value.type !== "string") return undefined;
  switch (value.type) {
    case "conversation-node": {
      const validError = (candidate: unknown) =>
        isRemotePlainObject(candidate) &&
        hasOnlyKeys(candidate, ["code", "message"]) &&
        isBoundedString(candidate.code, REMOTE_PROTOCOL_LIMITS.titleBytes) &&
        isBoundedString(candidate.message, REMOTE_PROTOCOL_LIMITS.activitySummaryBytes);
      const validBlock = (candidate: unknown) => {
        if (!isRemotePlainObject(candidate) || typeof candidate.kind !== "string") return false;
        if (!isRemoteIdentifier(candidate.key)) return false;
        switch (candidate.kind) {
          case "text":
            return (
              hasOnlyKeys(candidate, ["kind", "key", "text"], ["truncated"]) &&
              isBoundedString(candidate.text, REMOTE_PROTOCOL_LIMITS.assistantTextBytes) &&
              (candidate.truncated === undefined || typeof candidate.truncated === "boolean")
            );
          case "reasoning":
            return (
              hasOnlyKeys(candidate, ["kind", "key", "text"], ["status", "truncated"]) &&
              isBoundedString(candidate.text, REMOTE_PROTOCOL_LIMITS.assistantTextBytes, {
                allowEmpty: true,
              }) &&
              (candidate.status === undefined ||
                ["running", "complete", "incomplete"].includes(String(candidate.status))) &&
              (candidate.truncated === undefined || typeof candidate.truncated === "boolean")
            );
          case "tool-call":
            return (
              hasOnlyKeys(
                candidate,
                ["kind", "key", "callId", "toolName", "argumentsText", "status", "truncated"],
                ["result", "error"],
              ) &&
              isRemoteIdentifier(candidate.callId) &&
              isBoundedString(candidate.toolName, REMOTE_PROTOCOL_LIMITS.titleBytes) &&
              isBoundedString(candidate.argumentsText, REMOTE_PROTOCOL_LIMITS.toolArgumentsBytes, {
                allowEmpty: true,
              }) &&
              ["running", "complete", "incomplete", "error"].includes(String(candidate.status)) &&
              typeof candidate.truncated === "boolean" &&
              (candidate.result === undefined ||
                isJsonValueWithinLimits(candidate.result, {
                  maximumBytes: REMOTE_PROTOCOL_LIMITS.toolOutputBytes,
                })) &&
              (candidate.error === undefined || validError(candidate.error))
            );
          case "data":
            return (
              hasOnlyKeys(candidate, ["kind", "key", "name", "data"]) &&
              candidate.name === "workbench.pi-context-trace-event" &&
              isJsonValueWithinLimits(candidate.data, {
                maximumBytes: REMOTE_PROTOCOL_LIMITS.toolArgumentsBytes,
              })
            );
          case "error":
            return hasOnlyKeys(candidate, ["kind", "key", "error"]) && validError(candidate.error);
          default:
            return false;
        }
      };
      if (
        !hasOnlyKeys(
          value,
          ["type", "itemId", "createdAt", "kind"],
          ["blocks", "status", "name", "input", "output", "summary", "error"],
        ) ||
        !isRemoteIdentifier(value.itemId) ||
        !isRemoteTimestamp(value.createdAt) ||
        !["user", "assistant", "system", "command", "compaction", "error"].includes(
          String(value.kind),
        ) ||
        (value.blocks !== undefined &&
          (!Array.isArray(value.blocks) ||
            value.blocks.length > 128 ||
            !value.blocks.every(validBlock))) ||
        (value.status !== undefined &&
          !["running", "complete", "incomplete", "error"].includes(String(value.status))) ||
        (value.name !== undefined &&
          !isBoundedString(value.name, REMOTE_PROTOCOL_LIMITS.titleBytes)) ||
        (value.input !== undefined &&
          !isBoundedString(value.input, REMOTE_PROTOCOL_LIMITS.toolArgumentsBytes, {
            allowEmpty: true,
          })) ||
        (value.output !== undefined &&
          !isBoundedString(value.output, REMOTE_PROTOCOL_LIMITS.toolOutputBytes, {
            allowEmpty: true,
          })) ||
        (value.summary !== undefined &&
          !isBoundedString(value.summary, REMOTE_PROTOCOL_LIMITS.activitySummaryBytes)) ||
        (value.error !== undefined && !validError(value.error)) ||
        (value.kind === "assistant" && value.status === undefined) ||
        (value.kind === "error" && value.error === undefined)
      ) {
        return undefined;
      }
      break;
    }
    case "user-message":
      if (
        !hasOnlyKeys(value, ["type", "itemId", "createdAt", "text", "state"], ["textTruncated"]) ||
        !isRemoteIdentifier(value.itemId) ||
        !isRemoteTimestamp(value.createdAt) ||
        !isBoundedString(value.text, REMOTE_PROTOCOL_LIMITS.assistantTextBytes) ||
        (value.textTruncated !== undefined && typeof value.textTruncated !== "boolean") ||
        !["complete", "streaming", "failed"].includes(String(value.state))
      ) {
        return undefined;
      }
      break;
    case "assistant-message":
      if (
        !hasOnlyKeys(
          value,
          ["type", "itemId", "createdAt", "state"],
          ["text", "textTruncated", "toolCalls"],
        ) ||
        !isRemoteIdentifier(value.itemId) ||
        !isRemoteTimestamp(value.createdAt) ||
        (value.text !== undefined &&
          !isBoundedString(value.text, REMOTE_PROTOCOL_LIMITS.assistantTextBytes)) ||
        (value.textTruncated !== undefined && typeof value.textTruncated !== "boolean") ||
        (value.textTruncated === true && value.text === undefined) ||
        (value.toolCalls !== undefined &&
          (!Array.isArray(value.toolCalls) ||
            value.toolCalls.length === 0 ||
            value.toolCalls.length > 32 ||
            !value.toolCalls.every(
              (toolCall) =>
                isRemotePlainObject(toolCall) &&
                hasOnlyKeys(toolCall, ["toolCallId", "toolName", "arguments", "truncated"]) &&
                isRemoteIdentifier(toolCall.toolCallId) &&
                isBoundedString(toolCall.toolName, REMOTE_PROTOCOL_LIMITS.titleBytes) &&
                isBoundedString(toolCall.arguments, REMOTE_PROTOCOL_LIMITS.toolArgumentsBytes, {
                  allowEmpty: true,
                }) &&
                typeof toolCall.truncated === "boolean",
            ))) ||
        (value.text === undefined && value.toolCalls === undefined) ||
        !["complete", "streaming", "failed"].includes(String(value.state))
      ) {
        return undefined;
      }
      break;
    case "tool-result":
      if (
        !hasOnlyKeys(
          value,
          [
            "type",
            "itemId",
            "createdAt",
            "toolCallId",
            "toolName",
            "output",
            "isError",
            "truncated",
          ],
          ["input"],
        ) ||
        !isRemoteIdentifier(value.itemId) ||
        !isRemoteTimestamp(value.createdAt) ||
        !isRemoteIdentifier(value.toolCallId) ||
        !isBoundedString(value.toolName, REMOTE_PROTOCOL_LIMITS.titleBytes) ||
        (value.input !== undefined &&
          !isBoundedString(value.input, REMOTE_PROTOCOL_LIMITS.toolArgumentsBytes, {
            allowEmpty: true,
          })) ||
        !isBoundedString(value.output, REMOTE_PROTOCOL_LIMITS.toolOutputBytes, {
          allowEmpty: true,
        }) ||
        typeof value.isError !== "boolean" ||
        typeof value.truncated !== "boolean"
      ) {
        return undefined;
      }
      break;
    case "activity-summary":
      if (
        !hasOnlyKeys(
          value,
          ["type", "itemId", "createdAt", "activity", "displayName"],
          ["summary"],
        ) ||
        !isRemoteIdentifier(value.itemId) ||
        !isRemoteTimestamp(value.createdAt) ||
        !["tool-running", "tool-completed", "tool-failed"].includes(String(value.activity)) ||
        !isBoundedString(value.displayName, REMOTE_PROTOCOL_LIMITS.titleBytes) ||
        (value.summary !== undefined &&
          !isBoundedString(value.summary, REMOTE_PROTOCOL_LIMITS.activitySummaryBytes))
      ) {
        return undefined;
      }
      break;
    case "ordinary-question":
      if (
        !hasOnlyKeys(value, [
          "type",
          "interactionId",
          "sessionId",
          "revision",
          "expiresAt",
          "questions",
        ]) ||
        !isRemoteIdentifier(value.interactionId) ||
        !isRemoteIdentifier(value.sessionId) ||
        !isRemoteIdentifier(value.revision) ||
        !isRemoteTimestamp(value.expiresAt) ||
        !Array.isArray(value.questions) ||
        value.questions.length === 0 ||
        value.questions.length > 32 ||
        !value.questions.every(
          (question) =>
            isRemotePlainObject(question) &&
            hasOnlyKeys(question, ["questionId", "prompt"], ["options"]) &&
            isRemoteIdentifier(question.questionId) &&
            isBoundedString(question.prompt, 4 * 1024) &&
            (question.options === undefined ||
              (Array.isArray(question.options) &&
                question.options.length <= 32 &&
                question.options.every(
                  (option) =>
                    isRemotePlainObject(option) &&
                    hasOnlyKeys(option, ["optionId", "label"]) &&
                    isRemoteIdentifier(option.optionId) &&
                    isBoundedString(option.label, REMOTE_PROTOCOL_LIMITS.titleBytes),
                ))) &&
            isJsonValueWithinLimits(question, {
              maximumBytes: REMOTE_PROTOCOL_LIMITS.answerAggregateBytes,
            }),
        )
      ) {
        return undefined;
      }
      break;
    case "system-status":
      if (
        !hasOnlyKeys(value, ["type", "itemId", "createdAt", "status"]) ||
        !isRemoteIdentifier(value.itemId) ||
        !isRemoteTimestamp(value.createdAt) ||
        !["stopped", "failed", "content-available-on-desktop"].includes(String(value.status))
      ) {
        return undefined;
      }
      break;
    default:
      return undefined;
  }
  return value as unknown as RemoteConversationItemV1;
}

export function parseRemoteConversationPageV1(
  value: unknown,
): RemoteConversationPageV1 | undefined {
  if (
    !isRemotePlainObject(value) ||
    !hasOnlyKeys(
      value,
      ["sessionId", "items", "historyCursor", "sessionRevision", "projectionCursor"],
      ["nextCursor"],
    ) ||
    !isRemoteIdentifier(value.sessionId) ||
    !Array.isArray(value.items) ||
    value.items.length > REMOTE_PROTOCOL_LIMITS.historyPageItems ||
    !value.items.every((item) => {
      const parsed = parseRemoteConversationItemV1(item);
      return (
        parsed !== undefined &&
        (parsed.type !== "ordinary-question" || parsed.sessionId === value.sessionId)
      );
    }) ||
    !isRemoteIdentifier(value.historyCursor) ||
    (value.nextCursor !== undefined && !isRemoteIdentifier(value.nextCursor)) ||
    !isRemoteIdentifier(value.sessionRevision) ||
    !parseRemoteCursor(value.projectionCursor) ||
    !isJsonValueWithinLimits(value, {
      maximumBytes: REMOTE_PROTOCOL_LIMITS.historyPageBytes,
      maximumArrayItems: REMOTE_PROTOCOL_LIMITS.historyPageItems,
    })
  ) {
    return undefined;
  }
  return value as unknown as RemoteConversationPageV1;
}

function parseRemoteSessionSummaryV1(value: unknown): boolean {
  if (
    !isRemotePlainObject(value) ||
    !hasOnlyKeys(
      value,
      ["sessionId", "updatedAt", "pinned", "archived", "attention", "runState", "entityRevision"],
      ["workspace", "title"],
    ) ||
    !isRemoteIdentifier(value.sessionId) ||
    (value.title !== undefined &&
      !isBoundedString(value.title, REMOTE_PROTOCOL_LIMITS.titleBytes)) ||
    !isRemoteTimestamp(value.updatedAt) ||
    typeof value.pinned !== "boolean" ||
    typeof value.archived !== "boolean" ||
    !["none", "unread", "input-needed", "failed"].includes(String(value.attention)) ||
    ![
      "idle",
      "queued",
      "running",
      "waiting-for-input",
      "stopping",
      "completed",
      "stopped",
      "failed",
    ].includes(String(value.runState)) ||
    !isRemoteIdentifier(value.entityRevision)
  ) {
    return false;
  }
  return (
    value.workspace === undefined ||
    (isRemotePlainObject(value.workspace) &&
      hasOnlyKeys(value.workspace, ["workspaceId", "displayName"]) &&
      isRemoteIdentifier(value.workspace.workspaceId) &&
      isBoundedString(value.workspace.displayName, REMOTE_PROTOCOL_LIMITS.titleBytes))
  );
}

export function parseRemoteEventV1(value: unknown): RemoteEventV1 | undefined {
  if (
    !isRemotePlainObject(value) ||
    !hasOnlyKeys(value, ["type", "eventId", "cursor", "createdAt", "payload"]) ||
    value.type !== "sync.event" ||
    !isRemoteIdentifier(value.eventId) ||
    !parseRemoteCursor(value.cursor) ||
    !isRemoteTimestamp(value.createdAt) ||
    !isRemotePlainObject(value.payload) ||
    typeof value.payload.type !== "string"
  ) {
    return undefined;
  }
  const payload = value.payload;
  let valid = false;
  switch (payload.type) {
    case "machine.presenceChanged":
      valid =
        hasOnlyKeys(payload, ["type", "machine"]) &&
        isRemotePlainObject(payload.machine) &&
        hasOnlyKeys(payload.machine, [
          "machineId",
          "displayName",
          "presence",
          "lastSeenAt",
          "protocolRange",
        ]) &&
        isRemoteIdentifier(payload.machine.machineId) &&
        isBoundedString(payload.machine.displayName, REMOTE_PROTOCOL_LIMITS.titleBytes) &&
        ["online", "offline", "reconnecting", "incompatible"].includes(
          String(payload.machine.presence),
        ) &&
        isRemoteTimestamp(payload.machine.lastSeenAt) &&
        parseProtocolVersionRange(payload.machine.protocolRange) !== undefined;
      break;
    case "session.upserted":
      valid =
        hasOnlyKeys(payload, ["type", "session"]) && parseRemoteSessionSummaryV1(payload.session);
      break;
    case "session.removed":
      valid = hasOnlyKeys(payload, ["type", "sessionId"]) && isRemoteIdentifier(payload.sessionId);
      break;
    case "session.runChanged":
      valid =
        hasOnlyKeys(payload, ["type", "sessionId", "runState"]) &&
        isRemoteIdentifier(payload.sessionId) &&
        [
          "idle",
          "queued",
          "running",
          "waiting-for-input",
          "stopping",
          "completed",
          "stopped",
          "failed",
        ].includes(String(payload.runState));
      break;
    case "session.messageAppended":
      valid =
        hasOnlyKeys(payload, ["type", "sessionId", "item"]) &&
        isRemoteIdentifier(payload.sessionId) &&
        parseRemoteConversationItemV1(payload.item) !== undefined;
      break;
    case "session.messageDelta":
      valid =
        hasOnlyKeys(payload, ["type", "sessionId", "streamId", "revision", "delta"]) &&
        isRemoteIdentifier(payload.sessionId) &&
        isRemoteIdentifier(payload.streamId) &&
        isRemoteIdentifier(payload.revision) &&
        isBoundedString(payload.delta, REMOTE_PROTOCOL_LIMITS.deltaBytes);
      break;
    case "interaction.upserted": {
      const interaction = parseRemoteConversationItemV1(payload.interaction);
      valid =
        hasOnlyKeys(payload, ["type", "interaction"]) && interaction?.type === "ordinary-question";
      break;
    }
    case "interaction.resolved":
      valid =
        hasOnlyKeys(payload, ["type", "interactionId"]) &&
        isRemoteIdentifier(payload.interactionId);
      break;
    case "operation.result":
      valid = parseRemoteOperationResultV1(payload) !== undefined;
      break;
  }
  if (
    !valid ||
    !isJsonValueWithinLimits(value, {
      maximumBytes: REMOTE_PROTOCOL_LIMITS.historyPageBytes,
      maximumArrayItems: REMOTE_PROTOCOL_LIMITS.historyPageItems,
    })
  ) {
    return undefined;
  }
  return value as unknown as RemoteEventV1;
}

export function parseRemoteSnapshotChunkV1(value: unknown): RemoteSnapshotChunkV1 | undefined {
  if (
    !isRemotePlainObject(value) ||
    !hasOnlyKeys(value, ["type", "snapshotId", "partIndex", "partCount", "sessions"]) ||
    value.type !== "snapshot.chunk" ||
    !isRemoteIdentifier(value.snapshotId) ||
    !Number.isSafeInteger(value.partIndex) ||
    !Number.isSafeInteger(value.partCount) ||
    (value.partIndex as number) < 0 ||
    (value.partCount as number) < 1 ||
    (value.partCount as number) > 10_000 ||
    (value.partIndex as number) >= (value.partCount as number) ||
    !Array.isArray(value.sessions) ||
    value.sessions.length > 200 ||
    !value.sessions.every(parseRemoteSessionSummaryV1) ||
    !isJsonValueWithinLimits(value, { maximumBytes: REMOTE_PROTOCOL_LIMITS.historyPageBytes })
  ) {
    return undefined;
  }
  return value as unknown as RemoteSnapshotChunkV1;
}

export function parseRemoteSnapshotCompleteV1(
  value: unknown,
): RemoteSnapshotCompleteV1 | undefined {
  if (
    !isRemotePlainObject(value) ||
    !hasOnlyKeys(value, ["type", "snapshotId", "baseCursor"]) ||
    value.type !== "snapshot.complete" ||
    !isRemoteIdentifier(value.snapshotId) ||
    !parseRemoteCursor(value.baseCursor) ||
    !isJsonValueWithinLimits(value, { maximumBytes: 4 * 1024 })
  ) {
    return undefined;
  }
  return value as unknown as RemoteSnapshotCompleteV1;
}

export function parseRemoteControlResponseV1(value: unknown): RemoteControlResponseV1 | undefined {
  if (
    !isRemotePlainObject(value) ||
    value.type !== "control.response" ||
    !isRemoteIdentifier(value.requestId)
  ) {
    return undefined;
  }
  const hasValue = Object.hasOwn(value, "value");
  const hasError = Object.hasOwn(value, "error");
  if (hasValue === hasError) return undefined;
  if (hasError) {
    return hasOnlyKeys(value, ["type", "requestId", "error"]) && parseRemoteErrorV1(value.error)
      ? (value as unknown as RemoteControlResponseV1)
      : undefined;
  }
  if (
    !hasOnlyKeys(value, ["type", "requestId", "value"]) ||
    !isRemotePlainObject(value.value) ||
    typeof value.value.type !== "string"
  ) {
    return undefined;
  }
  const response = value.value;
  let valid = false;
  switch (response.type) {
    case "session.catalog":
      valid =
        hasOnlyKeys(response, ["type", "sessions", "projectionCursor"]) &&
        Array.isArray(response.sessions) &&
        response.sessions.length <= 200 &&
        response.sessions.every(parseRemoteSessionSummaryV1) &&
        parseRemoteCursor(response.projectionCursor) !== undefined;
      break;
    case "conversation.history":
      valid =
        hasOnlyKeys(response, ["type", "page"]) &&
        parseRemoteConversationPageV1(response.page) !== undefined;
      break;
    case "sync.replay":
      valid =
        hasOnlyKeys(response, ["type", "events", "currentCursor"]) &&
        Array.isArray(response.events) &&
        response.events.length <= 1_000 &&
        response.events.every((event) => parseRemoteEventV1(event) !== undefined) &&
        parseRemoteCursor(response.currentCursor) !== undefined;
      break;
    case "sync.snapshot":
      valid =
        hasOnlyKeys(response, ["type", "snapshotId"]) && isRemoteIdentifier(response.snapshotId);
      break;
    case "operations.status":
      valid =
        hasOnlyKeys(response, ["type", "results"]) &&
        Array.isArray(response.results) &&
        response.results.length <= 100 &&
        response.results.every((result) => parseRemoteOperationResultV1(result) !== undefined);
      break;
  }
  if (
    !valid ||
    !isJsonValueWithinLimits(value, {
      maximumBytes: REMOTE_PROTOCOL_LIMITS.sealedEnvelopeBytes,
      maximumArrayItems: 1_000,
    })
  ) {
    return undefined;
  }
  return value as unknown as RemoteControlResponseV1;
}

export function parseRemoteErrorV1(value: unknown): RemoteErrorV1 | undefined {
  if (
    !isRemotePlainObject(value) ||
    !hasOnlyKeys(value, ["type", "version", "code"], ["details"]) ||
    value.type !== "remote.error" ||
    value.version !== REMOTE_CONTROL_PROTOCOL_VERSION ||
    typeof value.code !== "string" ||
    !ERROR_CODES.has(value.code as RemoteErrorCodeV1) ||
    (value.code === "internal" && value.details !== undefined) ||
    (value.details !== undefined &&
      (!isRemotePlainObject(value.details) ||
        Object.hasOwn(value.details, "stack") ||
        !isJsonValueWithinLimits(value.details, {
          maximumBytes: REMOTE_PROTOCOL_LIMITS.errorDetailsBytes,
        })))
  ) {
    return undefined;
  }
  return value as unknown as RemoteErrorV1;
}
