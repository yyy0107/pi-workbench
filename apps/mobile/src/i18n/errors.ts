import type { RemoteErrorCodeV1 } from "@workbench/remote-control-contracts/protocol";

import type { MobileTranslate } from "./index.ts";

export const mobileRemoteErrorMessageKeys = {
  authentication_failed: "mobile.errors.authenticationFailed",
  authorization_revision_changed: "mobile.errors.authorizationRevisionChanged",
  protocol_version_mismatch: "mobile.errors.protocolVersionMismatch",
  device_not_paired: "mobile.errors.deviceNotPaired",
  device_revoked: "mobile.errors.deviceRevoked",
  endpoint_not_allowed: "mobile.errors.endpointNotAllowed",
  identity_mismatch: "mobile.errors.identityMismatch",
  listener_disabled: "mobile.errors.listenerDisabled",
  listener_failed: "mobile.errors.listenerFailed",
  pairing_denied: "mobile.errors.pairingDenied",
  pairing_expired: "mobile.errors.pairingExpired",
  pairing_locked: "mobile.errors.pairingLocked",
  scope_denied: "mobile.errors.scopeDenied",
  machine_offline: "mobile.errors.machineOffline",
  machine_lease_changed: "mobile.errors.machineLeaseChanged",
  operation_expired: "mobile.errors.operationExpired",
  operation_id_conflict: "mobile.errors.operationIdConflict",
  operation_not_found: "mobile.errors.operationNotFound",
  entity_revision_conflict: "mobile.errors.entityRevisionConflict",
  interaction_not_pending: "mobile.errors.interactionNotPending",
  interaction_expired: "mobile.errors.interactionExpired",
  cursor_expired: "mobile.errors.cursorExpired",
  cursor_gap: "mobile.errors.cursorGap",
  epoch_changed: "mobile.errors.epochChanged",
  snapshot_required: "mobile.errors.snapshotRequired",
  payload_too_large: "mobile.errors.payloadTooLarge",
  rate_limited: "mobile.errors.rateLimited",
  slow_consumer: "mobile.errors.slowConsumer",
  invalid_frame: "mobile.errors.invalidFrame",
  internal: "mobile.errors.internal",
} as const satisfies Record<RemoteErrorCodeV1, Parameters<MobileTranslate>[0]>;

export function mobileRemoteErrorMessage(t: MobileTranslate, code: RemoteErrorCodeV1): string {
  return t(mobileRemoteErrorMessageKeys[code]);
}
