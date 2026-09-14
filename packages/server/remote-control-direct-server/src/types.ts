export type DirectEndpointClassification = "local-network" | "tailscale";

export type DirectListenerState =
  | "disabled"
  | "starting"
  | "listening"
  | "replacing"
  | "stopping"
  | "failed";

export type DirectPairingState =
  | "created"
  | "claimed"
  | "confirmed"
  | "denied"
  | "expired"
  | "locked"
  | "consumed"
  | "cancelled";
