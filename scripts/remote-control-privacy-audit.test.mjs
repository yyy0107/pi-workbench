import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositoryRoot = new URL("../", import.meta.url);
const read = (relative) => readFile(new URL(relative, repositoryRoot), "utf8");

const CLIENT_SECRET_KEYS = new Set([
  "accesstoken",
  "challengeproof",
  "cwd",
  "privatekey",
  "rootpath",
]);
const DIRECT_SECRET_KEYS = new Set([
  "accesstoken",
  "challengeproof",
  "ciphertext",
  "enc",
  "manualcode",
  "nonce",
  "pairingsecret",
  "privatekey",
  "refreshtoken",
  "secretproof",
  "signature",
  "ticket",
]);
const SECRET_MARKERS = [
  "prompt-secret-2b710f",
  "answer-secret-83ab2c",
  "/private/project-6cd4",
  "provider-token-f177",
  "private-key-b66e",
  "tool-result-774c",
  "ciphertext-body-5e1d",
];

function normalizedKey(value) {
  return value.replaceAll(/[-_]/gu, "").toLowerCase();
}

function forbiddenPaths(value, forbidden, prefix = "$") {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => forbiddenPaths(item, forbidden, `${prefix}[${index}]`));
  }
  return Object.entries(value).flatMap(([key, nested]) => {
    const current = `${prefix}.${key}`;
    return [
      ...(forbidden.has(normalizedKey(key)) ? [current] : []),
      ...forbiddenPaths(nested, forbidden, current),
    ];
  });
}

function assertNoMarkers(value) {
  const encoded = JSON.stringify(value);
  for (const marker of SECRET_MARKERS) assert.equal(encoded.includes(marker), false, marker);
}

test("direct gateway has no central service, database, identity-provider, or push dependency", async () => {
  const manifest = JSON.parse(
    await read("packages/server/remote-control-direct-server/package.json"),
  );
  assert.deepEqual(manifest.dependencies, {
    "@workbench/remote-control-contracts": "workspace:*",
  });
  const source = [
    await read("packages/server/remote-control-direct-server/src/gateway.ts"),
    await read("packages/server/remote-control-direct-server/src/authentication.ts"),
    await read("packages/server/remote-control-direct-server/src/pairing-service.ts"),
  ].join("\n");
  assert.doesNotMatch(
    source,
    /(?:postgres|oauth|oidc|auth-session|web-browser|expo-notifications|https:\/\/)/iu,
  );
});

test("direct gateway diagnostics keep pairing, challenge, key, and ciphertext material out", () => {
  const safeDiagnostic = {
    eventType: "direct-authentication-rejected",
    occurredAt: "2030-09-13T20:00:00.000Z",
    machineId: "machine-1",
    deviceId: "device-1",
    listenerGenerationId: "generation-1",
    resultCode: "authentication_failed",
    frameBytes: 512,
  };
  assert.deepEqual(forbiddenPaths(safeDiagnostic, DIRECT_SECRET_KEYS), []);
  for (const key of [
    "accessToken",
    "challengeProof",
    "ciphertext",
    "enc",
    "manualCode",
    "nonce",
    "pairingSecret",
    "privateKey",
    "secretProof",
    "signature",
    "ticket",
  ]) {
    assert.deepEqual(forbiddenPaths({ [key]: "secret" }, DIRECT_SECRET_KEYS), [`$.${key}`]);
  }
});

test("authorized conversation projection retains requested tool transcripts but rejects host secrets", () => {
  const desktopProjection = {
    sessions: [
      {
        sessionId: "session-1",
        workspace: { workspaceId: "workspace-1", displayName: "Workspace" },
        title: "Visible session title",
        runState: "running",
        entityRevision: "revision-1",
      },
    ],
    cursor: { epoch: "epoch-1", offset: "7" },
  };
  const mobileCache = {
    machineId: "machine-1",
    sessionId: "session-1",
    draft: "user-owned local draft",
    items: [
      {
        type: "assistant-message",
        itemId: "message-1",
        text: "Visible answer",
        toolCalls: [
          {
            toolCallId: "tool-1",
            toolName: "exec",
            arguments: '{"command":"pnpm test"}',
            truncated: false,
          },
        ],
      },
      {
        type: "tool-result",
        itemId: "tool-result-1",
        toolCallId: "tool-1",
        toolName: "exec",
        output: "tool-result-774c",
        isError: false,
        truncated: false,
      },
    ],
    cursor: { epoch: "epoch-1", offset: "7" },
  };
  assert.deepEqual(forbiddenPaths(desktopProjection, CLIENT_SECRET_KEYS), []);
  assert.deepEqual(forbiddenPaths(mobileCache, CLIENT_SECRET_KEYS), []);
  assertNoMarkers(desktopProjection);
  assert.match(JSON.stringify(mobileCache), /tool-result-774c/u);
});

test("mobile production manifest and configuration contain no login, provider, or push module", async () => {
  const manifest = await read("apps/mobile/package.json");
  const configuration = await read("apps/mobile/app.config.ts");
  const productionSurface = `${manifest}\n${configuration}`;
  assert.doesNotMatch(
    productionSurface,
    /(?:expo-auth-session|expo-notifications|expo-web-browser|remote-control-relay)/iu,
  );
  assert.match(configuration, /usesCleartextTraffic:\s*true/u);
  assert.match(configuration, /NSLocalNetworkUsageDescription/u);
});

test("the direct desktop composition contains no central credential or outbound Relay path", async () => {
  const source = await read("apps/desktop-electron/src/desktop-remote-control.cjs");
  assert.doesNotMatch(
    source,
    /(?:accountId|relayOrigin|accessToken|refreshToken|issueDesktopTicket|publishNotification)/u,
  );
  assert.match(source, /createDirectRemoteGateway/u);
  assert.match(source, /createDesktopDirectFrameProcessor/u);
});
