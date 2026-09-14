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
  type PairingPayloadV1,
  type RemoteCursor,
  type RemotePrincipalReference,
  type RemoteProtocolVersionRange,
  type RemotePushHintV1,
  type RemoteSealedEnvelopeV1,
  type SocketAuthenticatedV1,
  type SocketAuthenticateV1,
} from "./protocol";

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

function parseRemoteCursor(value: unknown): RemoteCursor | undefined {
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

function parsePrincipal(value: unknown): RemotePrincipalReference | undefined {
  if (
    !isRemotePlainObject(value) ||
    !hasOnlyKeys(value, ["kind", "id"]) ||
    (value.kind !== "mobile" && value.kind !== "desktop") ||
    !isRemoteIdentifier(value.id)
  ) {
    return undefined;
  }
  return value as unknown as RemotePrincipalReference;
}

function isBase64Url(value: unknown, maximumBytes: number): value is string {
  return isBoundedString(value, maximumBytes) && /^[A-Za-z0-9_-]+$/u.test(value);
}

function isSecureOrigin(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.origin === value &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

export function parsePairingPayloadV1(value: unknown): PairingPayloadV1 | undefined {
  if (
    !isRemotePlainObject(value) ||
    !hasOnlyKeys(value, [
      "type",
      "version",
      "relayOrigin",
      "pairingId",
      "pairingSecret",
      "machineId",
      "desktopEncryptionKeyId",
      "desktopEncryptionPublicKey",
      "desktopEncryptionKeyFingerprint",
      "expiresAt",
    ]) ||
    value.type !== "workbench.remote.pairing" ||
    value.version !== REMOTE_CONTROL_PROTOCOL_VERSION ||
    !isSecureOrigin(value.relayOrigin) ||
    !isRemoteIdentifier(value.pairingId) ||
    !isBase64Url(value.pairingSecret, 512) ||
    value.pairingSecret.length < 43 ||
    !isRemoteIdentifier(value.machineId) ||
    !isRemoteIdentifier(value.desktopEncryptionKeyId) ||
    !isBase64Url(value.desktopEncryptionPublicKey, 4_096) ||
    value.desktopEncryptionPublicKey.length < 43 ||
    !isBoundedString(value.desktopEncryptionKeyFingerprint, 256) ||
    !isRemoteTimestamp(value.expiresAt) ||
    !isJsonValueWithinLimits(value, {
      maximumBytes: REMOTE_PROTOCOL_LIMITS.authenticationFrameBytes,
    })
  ) {
    return undefined;
  }
  return value as unknown as PairingPayloadV1;
}

export function parseSocketAuthenticateV1(value: unknown): SocketAuthenticateV1 | undefined {
  if (
    !isRemotePlainObject(value) ||
    !hasOnlyKeys(
      value,
      ["type", "version", "ticket", "challengeProof", "protocolRange"],
      ["resume"],
    ) ||
    value.type !== "socket.authenticate" ||
    value.version !== REMOTE_CONTROL_PROTOCOL_VERSION ||
    !isBoundedString(value.ticket, 4_096) ||
    !isBoundedString(value.challengeProof, 4_096) ||
    !parseProtocolVersionRange(value.protocolRange) ||
    !isJsonValueWithinLimits(value, {
      maximumBytes: REMOTE_PROTOCOL_LIMITS.authenticationFrameBytes,
    })
  ) {
    return undefined;
  }
  if (value.resume !== undefined) {
    if (
      !isRemotePlainObject(value.resume) ||
      !hasOnlyKeys(value.resume, ["unresolvedOperationIds"], ["cursor"]) ||
      (value.resume.cursor !== undefined && !parseRemoteCursor(value.resume.cursor)) ||
      !Array.isArray(value.resume.unresolvedOperationIds) ||
      value.resume.unresolvedOperationIds.length > 100 ||
      !value.resume.unresolvedOperationIds.every(isRemoteIdentifier)
    ) {
      return undefined;
    }
  }
  return value as unknown as SocketAuthenticateV1;
}

export function parseSocketAuthenticatedV1(value: unknown): SocketAuthenticatedV1 | undefined {
  if (
    !isRemotePlainObject(value) ||
    !hasOnlyKeys(value, ["type", "version", "protocolVersion", "principal"], ["leaseGeneration"]) ||
    value.type !== "socket.authenticated" ||
    value.version !== REMOTE_CONTROL_PROTOCOL_VERSION ||
    value.protocolVersion !== REMOTE_CONTROL_PROTOCOL_VERSION ||
    !parsePrincipal(value.principal) ||
    (value.leaseGeneration !== undefined && !isRemoteIdentifier(value.leaseGeneration)) ||
    !isJsonValueWithinLimits(value, {
      maximumBytes: REMOTE_PROTOCOL_LIMITS.authenticationFrameBytes,
    })
  ) {
    return undefined;
  }
  return value as unknown as SocketAuthenticatedV1;
}

export function parseRemoteSealedEnvelopeV1(value: unknown): RemoteSealedEnvelopeV1 | undefined {
  if (
    !isRemotePlainObject(value) ||
    !hasOnlyKeys(value, [
      "protocolVersion",
      "envelopeId",
      "machineId",
      "source",
      "target",
      "contentType",
      "keyId",
      "createdAt",
      "expiresAt",
      "hpke",
    ]) ||
    value.protocolVersion !== REMOTE_CONTROL_PROTOCOL_VERSION ||
    !isRemoteIdentifier(value.envelopeId) ||
    !isRemoteIdentifier(value.machineId) ||
    !parsePrincipal(value.source) ||
    !parsePrincipal(value.target) ||
    !["command", "result", "event", "snapshot-chunk"].includes(String(value.contentType)) ||
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
  return value as unknown as RemoteSealedEnvelopeV1;
}

export function parseRemotePushHintV1(value: unknown): RemotePushHintV1 | undefined {
  if (
    !isRemotePlainObject(value) ||
    !hasOnlyKeys(value, ["version", "hintId", "machineId", "kind"], ["sessionId"]) ||
    value.version !== REMOTE_CONTROL_PROTOCOL_VERSION ||
    !isRemoteIdentifier(value.hintId) ||
    !isRemoteIdentifier(value.machineId) ||
    (value.sessionId !== undefined && !isRemoteIdentifier(value.sessionId)) ||
    (value.kind !== "attention" && value.kind !== "state-changed") ||
    remoteUtf8ByteLength(canonicalJson(value)) > 4_096
  ) {
    return undefined;
  }
  return value as unknown as RemotePushHintV1;
}
