export type DirectGatewayErrorCode =
  | "authentication_failed"
  | "authorization_revision_changed"
  | "device_not_paired"
  | "device_revoked"
  | "endpoint_kind_mismatch"
  | "endpoint_not_allowed"
  | "identity_mismatch"
  | "invalid_frame"
  | "listener_disabled"
  | "listener_failed"
  | "pairing_denied"
  | "pairing_expired"
  | "pairing_locked"
  | "pairing_secret_invalid"
  | "pairing_unavailable"
  | "payload_too_large"
  | "protocol_version_mismatch"
  | "rate_limited"
  | "slow_consumer";

export class DirectGatewayError extends Error {
  override readonly name = "DirectGatewayError";
  readonly code: DirectGatewayErrorCode;

  constructor(code: DirectGatewayErrorCode) {
    super(code);
    this.code = code;
  }
}
