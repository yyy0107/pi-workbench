const SENSITIVE_KEYS = new Set([
  "accessToken",
  "challengeProof",
  "ciphertext",
  "desktopEncryptionPublicKey",
  "enc",
  "manualCode",
  "mobileEncryptionPublicKey",
  "nonce",
  "pairingSecret",
  "privateKey",
  "publicKey",
  "secretProof",
  "signature",
  "ticket",
]);

export function redactDirectDiagnosticDetails(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_KEYS.has(key) ? "[redacted]" : entry,
    ]),
  );
}
