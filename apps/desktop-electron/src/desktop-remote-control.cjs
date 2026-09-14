const { createHash } = require("node:crypto");

async function createDesktopDirectRemoteControlBridgeGeneration(options) {
  let installation;
  let configuration;
  let gateway;
  let activeListener;
  let started = false;
  let listenerState = "disabled";
  let currentEndpoints = [];
  let operationLedger;
  let frameProcessor;
  let runtimeMonitor;
  const pairingPayloads = new Map();

  const [
    directServer,
    cryptoModule,
    { createPiRpcRemoteCommandRuntime, createRemoteCommandAdapter },
    { createDesktopDirectFrameProcessor },
    { createDesktopRemoteRuntimeMonitor },
    { openSqliteRemoteOperationLedger },
    piApi,
  ] = await Promise.all([
    import("@workbench/remote-control-direct-server"),
    import("@workbench/remote-control-contracts/direct-crypto"),
    import("@workbench/pi-runtime-remote-control/command-adapter"),
    import("@workbench/pi-runtime-remote-control/direct-frame-processor"),
    import("@workbench/pi-runtime-remote-control/runtime-monitor"),
    import("@workbench/pi-runtime-remote-control/sqlite-ledger"),
    import("@workbench/pi-rpc-client/api"),
  ]);
  const epoch = `runtime-${options.generation ?? 0}-${require("node:crypto").randomUUID()}`;

  const createInstallation = async () => {
    const keys = await cryptoModule.generateDirectHpkeKeyPair();
    const publicKey = Buffer.from(keys.publicKey).toString("base64url");
    const value = {
      machineId: `machine-${require("node:crypto").randomUUID()}`,
      displayName: options.displayName?.trim() || require("node:os").hostname() || "Workbench",
      encryptionKeyId: `desktop-key-${require("node:crypto").randomUUID()}`,
      encryptionPublicKey: publicKey,
      encryptionPrivateKey: Buffer.from(keys.privateKey).toString("base64url"),
      fingerprint: `sha256:${createHash("sha256").update(keys.publicKey).digest("base64url")}`,
      createdAt: new Date().toISOString(),
    };
    await options.store.saveInstallation(value);
    return value;
  };

  const selectedAddresses = async (nextConfiguration) => {
    const addresses = await options.listener.listInterfaces();
    const selected = addresses.filter((item) =>
      nextConfiguration.selectedInterfaceIds.includes(item.interfaceId),
    );
    if (
      selected.length !== nextConfiguration.selectedInterfaceIds.length ||
      new Set(selected.map((item) => item.interfaceId)).size !== selected.length
    ) {
      throw new Error("endpoint_not_allowed");
    }
    return selected;
  };

  const endpointViews = async () => {
    if (!configuration?.enabled) return [];
    return (await selectedAddresses(configuration)).map((item) => ({
      kind: item.kind,
      host: item.address,
      port: configuration.port,
    }));
  };

  const createGateway = async () => {
    return directServer.createDirectRemoteGateway({
      installation,
      endpoints: () => currentEndpoints,
      clock: { now: () => new Date() },
      randomBytes: (size) => require("node:crypto").randomBytes(size),
      authorizationStore: {
        list: () => options.store.listAuthorizations(),
        replace: (values) => options.store.replaceAuthorizations(values),
      },
      approval: {
        publishClaim(value) {
          options.onPairingClaim?.(value);
        },
      },
      ...(frameProcessor ? { business: frameProcessor } : {}),
      epoch,
    });
  };

  const stopBusiness = () => {
    runtimeMonitor?.stop();
    runtimeMonitor = undefined;
    frameProcessor?.close();
    frameProcessor = undefined;
    operationLedger?.close();
    operationLedger = undefined;
  };

  const startBusiness = async () => {
    if (!options.runtimeConnection) return;
    if (!options.operationLedgerFile) throw new Error("remote-control-ledger-unavailable");
    const transport = piApi.createPiHttpTransport(options.runtimeConnection, (url, init) =>
      (options.fetch ?? fetch)(url, init),
    );
    const commandRuntime = createPiRpcRemoteCommandRuntime(transport);
    const commands = createRemoteCommandAdapter({ runtime: commandRuntime });
    operationLedger = await openSqliteRemoteOperationLedger({
      filename: options.operationLedgerFile,
      machineId: installation.machineId,
      clock: { now: () => new Date() },
    });
    frameProcessor = createDesktopDirectFrameProcessor({
      installation,
      epoch,
      clock: { now: () => new Date() },
      id: () => require("node:crypto").randomUUID(),
      loadAuthorizations: () => options.store.listAuthorizations(),
      ledger: operationLedger,
      commands,
      readSessionCatalog: () => commandRuntime.readSessionCatalog(),
      onOperationAccepted: (request) => runtimeMonitor?.noteOperationAccepted(request.command),
    });
    await frameProcessor.initialize();
    if (options.WebSocket) {
      runtimeMonitor = createDesktopRemoteRuntimeMonitor({
        machineId: installation.machineId,
        runtimeConnection: options.runtimeConnection,
        webSocketFactory: (url) => new options.WebSocket(url),
        frameProcessor,
        readSessionCatalog: () => commandRuntime.readSessionCatalog(),
      });
      await runtimeMonitor.start();
    }
  };

  const startListener = async () => {
    if (!configuration.enabled) {
      currentEndpoints = [];
      listenerState = "disabled";
      return;
    }
    const addresses = await selectedAddresses(configuration);
    if (addresses.length === 0) throw new Error("endpoint_not_allowed");
    currentEndpoints = addresses.map((item) => ({
      kind: item.kind,
      host: item.address,
      port: configuration.port,
    }));
    listenerState = "starting";
    const candidate = await options.listener.prepare({
      addresses,
      port: configuration.port,
      path: directServer.DIRECT_REMOTE_SOCKET_PATH,
      onSocket(socket, endpoint, mode) {
        gateway.accept(socket, endpoint, mode);
      },
    });
    try {
      const previous = activeListener;
      activeListener = await candidate.commit();
      await previous?.dispose();
      listenerState = "listening";
    } catch (error) {
      await candidate.dispose();
      listenerState = "failed";
      throw error;
    }
  };

  const requireStarted = () => {
    if (!started || !gateway) throw new Error("remote-control-unavailable");
  };

  const replaceGateway = async () => {
    gateway?.dispose();
    gateway = await createGateway();
  };

  const revision = () => `revision-${require("node:crypto").randomUUID()}`;

  const pairingView = (payload, state) => ({
    pairingId: payload.pairingId,
    state: state.state,
    expiresAt: payload.expiresAt,
    qrPayload: JSON.stringify(payload),
    manualCode: payload.manualCode,
    endpoints: payload.endpoints.map((endpoint) => ({ ...endpoint })),
    ...(state.deviceId ? { deviceId: state.deviceId } : {}),
    ...(state.deviceDisplayName ? { deviceDisplayName: state.deviceDisplayName } : {}),
    ...(state.platform ? { platform: state.platform } : {}),
    ...(state.safetyCode ? { safetyCode: state.safetyCode } : {}),
  });

  return {
    async start() {
      if (started) return;
      installation = (await options.store.loadInstallation()) ?? (await createInstallation());
      configuration = await options.store.loadConfiguration();
      try {
        await startBusiness();
        gateway = await createGateway();
        await startListener();
        started = true;
      } catch (error) {
        gateway?.dispose();
        gateway = undefined;
        stopBusiness();
        throw error;
      }
    },
    async stop() {
      started = false;
      pairingPayloads.clear();
      gateway?.dispose();
      gateway = undefined;
      await activeListener?.dispose();
      activeListener = undefined;
      currentEndpoints = [];
      listenerState = "disabled";
      stopBusiness();
    },
    async describe() {
      return {
        enabled: Boolean(configuration?.enabled),
        listenerState,
        port: configuration?.port ?? 8787,
        selectedInterfaceIds: [...(configuration?.selectedInterfaceIds ?? [])],
        revision: configuration?.revision ?? "initial",
        endpoints: await endpointViews(),
      };
    },
    listInterfaces: () => options.listener.listInterfaces(),
    async updateConfiguration(input) {
      requireStarted();
      if (input.expectedRevision !== configuration.revision) {
        throw new Error("configuration_revision_changed");
      }
      const next = {
        enabled: input.enabled,
        port: input.port,
        selectedInterfaceIds: [...input.selectedInterfaceIds],
        revision: revision(),
        updatedAt: new Date().toISOString(),
      };
      let candidate;
      let nextEndpoints = [];
      if (next.enabled) {
        const addresses = await selectedAddresses(next);
        if (addresses.length === 0) throw new Error("endpoint_not_allowed");
        nextEndpoints = addresses.map((item) => ({
          kind: item.kind,
          host: item.address,
          port: next.port,
        }));
        listenerState = activeListener ? "replacing" : "starting";
        candidate = await options.listener.prepare({
          addresses,
          port: next.port,
          path: directServer.DIRECT_REMOTE_SOCKET_PATH,
          onSocket(socket, endpoint, mode) {
            gateway.accept(socket, endpoint, mode);
          },
        });
      } else {
        listenerState = "stopping";
      }
      try {
        await options.store.saveConfiguration(next);
        const previous = activeListener;
        activeListener = candidate ? await candidate.commit() : undefined;
        await previous?.dispose();
        configuration = next;
        currentEndpoints = nextEndpoints;
        pairingPayloads.clear();
        await replaceGateway();
        listenerState = next.enabled ? "listening" : "disabled";
      } catch (error) {
        await candidate?.dispose().catch(() => undefined);
        listenerState = activeListener ? "listening" : "failed";
        throw error;
      }
      return this.describe();
    },
    createPairing() {
      requireStarted();
      if (listenerState !== "listening") throw new Error("listener_disabled");
      const payload = gateway.createPairing();
      pairingPayloads.set(payload.pairingId, payload);
      return pairingView(payload, gateway.getPairing(payload.pairingId));
    },
    getPairing(pairingId) {
      requireStarted();
      const payload = pairingPayloads.get(pairingId);
      if (!payload) throw new Error("pairing_unavailable");
      return pairingView(payload, gateway.getPairing(pairingId));
    },
    async confirmPairing(pairingId, safetyCode) {
      requireStarted();
      await gateway.confirmPairing(pairingId, safetyCode);
      await frameProcessor?.refreshAuthorizations();
    },
    async rejectPairing(pairingId) {
      requireStarted();
      await gateway.rejectPairing(pairingId);
    },
    cancelPairing(pairingId) {
      requireStarted();
      gateway.cancelPairing(pairingId);
      pairingPayloads.delete(pairingId);
    },
    async listDevices() {
      requireStarted();
      return (await options.store.listAuthorizations()).map((value) => ({
        deviceId: value.deviceId,
        deviceDisplayName: value.displayName,
        platform: value.platform,
        state: value.revokedAt ? "revoked" : "active",
        revision: value.revision,
        createdAt: value.createdAt,
        ...(value.lastSeenAt ? { lastSeenAt: value.lastSeenAt } : {}),
      }));
    },
    async revokeDevice(deviceId, expectedRevision) {
      requireStarted();
      const values = await options.store.listAuthorizations();
      const current = values.find((value) => value.deviceId === deviceId);
      if (!current || current.revision !== expectedRevision) {
        throw new Error("authorization_revision_changed");
      }
      if (current.revokedAt) return;
      const now = new Date().toISOString();
      await options.store.replaceAuthorizations(
        values.map((value) =>
          value.deviceId === deviceId
            ? {
                ...value,
                revision: `revision-${require("node:crypto").randomUUID()}`,
                revokedAt: now,
              }
            : value,
        ),
      );
      gateway?.revokeDevice?.(deviceId);
      await frameProcessor?.refreshAuthorizations();
    },
    async resetIdentity(confirmation) {
      requireStarted();
      if (confirmation !== "RESET") throw new Error("identity_reset_confirmation_required");
      const previous = activeListener;
      activeListener = undefined;
      currentEndpoints = [];
      pairingPayloads.clear();
      gateway.dispose();
      gateway = undefined;
      await previous?.dispose();
      await options.store.reset();
      stopBusiness();
      installation = await createInstallation();
      configuration = await options.store.loadConfiguration();
      await startBusiness();
      gateway = await createGateway();
      listenerState = "disabled";
    },
  };
}

module.exports = { createDesktopDirectRemoteControlBridgeGeneration };
