const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  configureDesktopSecureStorageBackend,
  createDesktopRemoteControlBridgeLifecycle,
  createDesktopDirectRemoteControlStore,
} = require("../src/desktop-services.cjs");
const {
  copyRemoteControlRequest,
  copyRemoteControlResult,
} = require("../src/desktop-renderer-protocol.cjs");
const {
  createDesktopDirectRemoteControlBridgeGeneration,
} = require("../src/desktop-remote-control.cjs");

test("selects Linux Secret Service without overriding an explicit password store", () => {
  const switches = [];
  let selected = false;
  const app = {
    commandLine: {
      hasSwitch(name) {
        assert.equal(name, "password-store");
        return selected;
      },
      appendSwitch(name, value) {
        switches.push([name, value]);
        selected = true;
      },
    },
  };

  configureDesktopSecureStorageBackend(app, { platform: "linux" });
  configureDesktopSecureStorageBackend(app, { platform: "linux" });
  configureDesktopSecureStorageBackend(app, { platform: "darwin" });

  assert.deepEqual(switches, [["password-store", "gnome-libsecret"]]);
});

test("rejects Electron basic_text instead of persisting remote secrets in plaintext", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workbench-unsafe-direct-access-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "direct-access.json");
  const store = createDesktopDirectRemoteControlStore({
    file,
    safeStorage: {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => "basic_text",
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => value.toString("utf8"),
    },
  });

  await assert.rejects(
    () => store.loadConfiguration(),
    /Remote control secure storage unavailable/u,
  );
  assert.equal(fs.existsSync(file), false);
});

test("stores direct installation, disabled configuration, and paired phones only through safeStorage", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workbench-direct-access-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "direct-access.json");
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (value) => value.toString("utf8").slice("encrypted:".length),
  };
  const store = createDesktopDirectRemoteControlStore({
    file,
    safeStorage,
    now: () => new Date("2026-09-13T12:00:00.000Z"),
  });
  assert.deepEqual(await store.loadConfiguration(), {
    enabled: false,
    port: 8787,
    selectedInterfaceIds: [],
    revision: "initial",
    updatedAt: "2026-09-13T12:00:00.000Z",
  });
  const installation = {
    machineId: "machine-1",
    displayName: "Studio",
    encryptionKeyId: "desktop-key-1",
    encryptionPublicKey: "public-key-bytes",
    encryptionPrivateKey: "private-key-bytes",
    fingerprint: "sha256:fingerprint",
    createdAt: "2026-09-13T12:00:00.000Z",
  };
  const configuration = {
    enabled: true,
    port: 8787,
    selectedInterfaceIds: ["interface-1"],
    revision: "revision-1",
    updatedAt: "2026-09-13T12:00:01.000Z",
  };
  const authorizations = [
    {
      deviceId: "phone-1",
      displayName: "My phone",
      platform: "ios",
      signingPublicKey: {
        kty: "EC",
        crv: "P-256",
        x: "x",
        y: "y",
      },
      signingKeyFingerprint: "sha256:signing",
      encryptionKeyId: "mobile-key-1",
      encryptionPublicKey: "mobile-public-key",
      encryptionKeyFingerprint: "sha256:mobile",
      scope: [
        "sessions.read",
        "sessions.create",
        "sessions.send",
        "sessions.stop",
        "sessions.organize",
        "interactions.respond",
      ],
      revision: "revision-1",
      createdAt: "2026-09-13T12:00:02.000Z",
    },
  ];
  await store.saveInstallation(installation);
  await store.saveConfiguration(configuration);
  await store.replaceAuthorizations(authorizations);
  assert.deepEqual(await store.loadInstallation(), installation);
  assert.deepEqual(await store.loadConfiguration(), configuration);
  assert.deepEqual(await store.listAuthorizations(), authorizations);

  const persisted = fs.readFileSync(file, "utf8");
  for (const secret of ["private-key-bytes", "mobile-public-key", "interface-1"]) {
    assert.equal(persisted.includes(secret), false, secret);
  }
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);

  fs.writeFileSync(file, JSON.stringify({ directInstallation: "not-base64" }), { mode: 0o600 });
  await assert.rejects(
    () => store.loadInstallation(),
    /Remote control direct installation is invalid/u,
  );
});

test("keeps one bridge generation and replaces it when RuntimeConnection changes", async () => {
  const records = [];
  const lifecycle = createDesktopRemoteControlBridgeLifecycle({
    async createBridge({ runtimeConnection, generation }) {
      records.push(["create", runtimeConnection.instanceId, generation]);
      return {
        async start() {
          records.push(["start", runtimeConnection.instanceId, generation]);
        },
        async stop() {
          records.push(["stop", runtimeConnection.instanceId, generation]);
        },
        createPairing() {
          return { pairingId: `pairing-${generation}` };
        },
        getPairing(pairingId) {
          return { pairingId };
        },
        confirmPairing(pairingId, safetyCode) {
          return { pairingId, safetyCode };
        },
        rejectPairing() {},
        cancelPairing() {},
        listDevices() {
          return [];
        },
        revokeDevice(deviceId, expectedRevision) {
          return { deviceId, expectedRevision };
        },
      };
    },
  });
  const first = {
    instanceId: "runtime-1",
    httpOrigin: "http://127.0.0.1:3210",
    accessToken: "local-sidecar-token-1",
  };
  const second = {
    instanceId: "runtime-2",
    httpOrigin: "http://127.0.0.1:3211",
    accessToken: "local-sidecar-token-2",
  };

  await lifecycle.replaceRuntime(first);
  await lifecycle.replaceRuntime(first);
  await lifecycle.replaceRuntime(second);
  assert.deepEqual(records, [
    ["create", "runtime-1", 1],
    ["start", "runtime-1", 1],
    ["stop", "runtime-1", 1],
    ["create", "runtime-2", 2],
    ["start", "runtime-2", 2],
  ]);
  assert.deepEqual(lifecycle.snapshot(), { state: "running", generation: 2 });
  assert.deepEqual(await lifecycle.invoke("listDevices"), []);
  assert.deepEqual(
    await lifecycle.invoke("revokeDevice", { deviceId: "phone-1", expectedRevision: "r1" }),
    {
      deviceId: "phone-1",
      expectedRevision: "r1",
    },
  );
  const serialized = JSON.stringify(lifecycle.snapshot());
  assert.equal(serialized.includes("sidecar-token"), false);
  assert.equal(serialized.includes("127.0.0.1"), false);

  await lifecycle.stop();
  assert.deepEqual(records.at(-1), ["stop", "runtime-2", 2]);
  assert.deepEqual(lifecycle.snapshot(), { state: "idle", generation: 2 });
});

test("rejects non-loopback Runtime connections before bridge creation", async () => {
  let created = 0;
  const lifecycle = createDesktopRemoteControlBridgeLifecycle({
    async createBridge() {
      created++;
      return { async start() {}, async stop() {} };
    },
  });
  await assert.rejects(
    () =>
      lifecycle.replaceRuntime({
        instanceId: "runtime-remote",
        httpOrigin: "https://attacker.example",
        accessToken: "must-not-leak",
      }),
    /loopback RuntimeConnection/u,
  );
  assert.equal(created, 0);
});

test("contains secure-storage startup failure inside the optional remote bridge", async () => {
  const failure = new Error("Remote control secure storage unavailable");
  const failures = [];
  let stopped = 0;
  const lifecycle = createDesktopRemoteControlBridgeLifecycle({
    onUnavailable: (error) => failures.push(error),
    async createBridge() {
      return {
        async start() {
          throw failure;
        },
        async stop() {
          stopped++;
        },
      };
    },
  });

  await lifecycle.replaceRuntime({
    instanceId: "runtime-1",
    httpOrigin: "http://127.0.0.1:3210",
    accessToken: "local-sidecar-token-1",
  });

  assert.deepEqual(failures, [failure]);
  assert.equal(stopped, 1);
  assert.deepEqual(lifecycle.snapshot(), { state: "failed", generation: 0 });
  await assert.rejects(() => lifecycle.invoke("describe"), /remote-control-unavailable/u);
});

test("keeps the direct listener disabled by default and creates pairing only after enablement", async () => {
  let installation;
  let authorizations = [];
  let prepared = 0;
  let disposed = 0;
  const configuration = {
    enabled: false,
    port: 8787,
    selectedInterfaceIds: [],
    revision: "initial",
    updatedAt: "2026-09-13T12:00:00.000Z",
  };
  const store = {
    loadInstallation: async () => installation,
    saveInstallation: async (value) => void (installation = value),
    loadConfiguration: async () => configuration,
    saveConfiguration: async () => {},
    listAuthorizations: async () => authorizations,
    replaceAuthorizations: async (values) => void (authorizations = [...values]),
  };
  const listener = {
    listInterfaces: async () => [],
    prepare: async () => {
      prepared += 1;
      return { commit: async () => ({ dispose: async () => void (disposed += 1) }), dispose() {} };
    },
  };
  const generation = await createDesktopDirectRemoteControlBridgeGeneration({ store, listener });
  await generation.start();
  assert.deepEqual(await generation.describe(), {
    enabled: false,
    listenerState: "disabled",
    port: 8787,
    selectedInterfaceIds: [],
    revision: "initial",
    endpoints: [],
  });
  assert.equal(prepared, 0);
  assert.throws(() => generation.createPairing(), /listener_disabled/u);
  assert.equal(JSON.stringify(await generation.listDevices()).includes("PublicKey"), false);
  await generation.stop();
  assert.equal(disposed, 0);
  assert.ok(installation?.encryptionPrivateKey);
});

test("migrates the legacy product label to the desktop hostname without rotating identity", async () => {
  const original = {
    machineId: "machine-1",
    displayName: "Pi Workbench",
    encryptionKeyId: "desktop-key-1",
    encryptionPublicKey: "public-key",
    encryptionPrivateKey: "private-key",
    fingerprint: "sha256:fingerprint",
    createdAt: "2026-09-13T12:00:00.000Z",
  };
  let installation = original;
  const generation = await createDesktopDirectRemoteControlBridgeGeneration({
    displayName: "wy-ubuntu",
    legacyDisplayName: "Pi Workbench",
    store: {
      loadInstallation: async () => installation,
      saveInstallation: async (value) => void (installation = value),
      loadConfiguration: async () => ({
        enabled: false,
        port: 8787,
        selectedInterfaceIds: [],
        revision: "initial",
        updatedAt: "2026-09-13T12:00:00.000Z",
      }),
      listAuthorizations: async () => [],
      replaceAuthorizations: async () => {},
    },
    listener: { listInterfaces: async () => [] },
  });

  await generation.start();
  assert.deepEqual(installation, { ...original, displayName: "wy-ubuntu" });
  assert.equal(installation.machineId, original.machineId);
  assert.equal(installation.encryptionPrivateKey, original.encryptionPrivateKey);
  await generation.stop();
});

test("copies only the local renderer pairing/device contract and rejects secret-shaped results", () => {
  assert.deepEqual(
    copyRemoteControlRequest("confirmPairing", {
      pairingId: "pairing-1",
      safetyCode: "123 456",
    }),
    { pairingId: "pairing-1", safetyCode: "123 456" },
  );
  const payload = {
    type: "workbench.remote.direct-pairing",
    version: 1,
    pairingId: "pairing-1",
    pairingSecret: "A".repeat(43),
    manualCode: "ABCDEFGH",
    machineId: "machine-1",
    machineDisplayName: "Studio",
    desktopEncryptionKeyId: "desktop-key-1",
    desktopEncryptionPublicKey: "B".repeat(87),
    desktopEncryptionKeyFingerprint: "sha256:desktop-key-1",
    endpoints: [{ kind: "local-network", host: "192.168.1.10", port: 8787 }],
    protocolRange: { min: 1, max: 1 },
    expiresAt: "2029-01-01T00:00:00.000Z",
  };
  const view = {
    pairingId: payload.pairingId,
    state: "created",
    expiresAt: payload.expiresAt,
    qrPayload: JSON.stringify(payload),
    manualCode: payload.manualCode,
    endpoints: payload.endpoints,
  };
  assert.deepEqual(copyRemoteControlResult("createPairing", view), view);
  assert.throws(
    () => copyRemoteControlResult("getPairing", { ...view, privateKey: "must-not-cross" }),
    /invalid-remote-control-response/u,
  );
  assert.throws(
    () => copyRemoteControlResult("listDevices", [{ machineCredential: "must-not-cross" }]),
    /invalid-remote-control-response/u,
  );
});
