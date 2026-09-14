export const DIRECT_SERVER_LIMITS = Object.freeze({
  maximumConnections: 32,
  maximumConnectionsPerAddress: 8,
  preAuthenticationFrameBytes: 16 * 1024,
  maximumPairingFrames: 5,
  sealedFrameBytes: 256 * 1024,
  firstFrameTimeoutMs: 5_000,
  challengeLifetimeMs: 5_000,
  pairingLifetimeMs: 2 * 60_000,
  pairingAttempts: 5,
  maximumSendBacklogBytes: 1024 * 1024,
  sendBacklogTimeoutMs: 10_000,
});
