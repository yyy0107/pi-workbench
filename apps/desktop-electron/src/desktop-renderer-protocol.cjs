const path = require("node:path");
const { pathToFileURL } = require("node:url");

const DESKTOP_RENDERER_ORIGIN = "workbench://app";
const DESKTOP_RENDERER_SCHEME = "workbench";
const DESKTOP_RENDERER_DEVELOPMENT_MARKER = 'data-workbench-desktop-renderer="1"';
const DESKTOP_RENDERER_DEVELOPMENT_HTML_MAX_BYTES = 2 * 1024 * 1024;
const REMOTE_CONTROL_CHANNELS = Object.freeze({
  describe: "workbench:remote-control:describe",
  listInterfaces: "workbench:remote-control:list-interfaces",
  updateConfiguration: "workbench:remote-control:update-configuration",
  createPairing: "workbench:remote-control:create-pairing",
  getPairing: "workbench:remote-control:get-pairing",
  confirmPairing: "workbench:remote-control:confirm-pairing",
  rejectPairing: "workbench:remote-control:reject-pairing",
  cancelPairing: "workbench:remote-control:cancel-pairing",
  listDevices: "workbench:remote-control:list-devices",
  revokeDevice: "workbench:remote-control:revoke-device",
  resetIdentity: "workbench:remote-control:reset-identity",
});

function remoteIdentifier(value) {
  return typeof value === "string" && /^[\x21-\x7e]{1,128}$/u.test(value);
}

function copyRemoteControlRequest(method, value) {
  if (["describe", "listInterfaces", "createPairing", "listDevices"].includes(method)) {
    if (value !== undefined) throw new Error("invalid-remote-control-request");
    return undefined;
  }
  if (method === "updateConfiguration") {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).sort().join("|") !==
        ["enabled", "expectedRevision", "port", "selectedInterfaceIds"].sort().join("|") ||
      typeof value.enabled !== "boolean" ||
      !Number.isSafeInteger(value.port) ||
      value.port < 1 ||
      value.port > 65_535 ||
      !Array.isArray(value.selectedInterfaceIds) ||
      value.selectedInterfaceIds.length > 8 ||
      new Set(value.selectedInterfaceIds).size !== value.selectedInterfaceIds.length ||
      !value.selectedInterfaceIds.every(remoteIdentifier) ||
      !remoteIdentifier(value.expectedRevision)
    ) {
      throw new Error("invalid-remote-control-request");
    }
    return Object.freeze({
      enabled: value.enabled,
      port: value.port,
      selectedInterfaceIds: Object.freeze([...value.selectedInterfaceIds]),
      expectedRevision: value.expectedRevision,
    });
  }
  if (method === "resetIdentity") {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).join("|") !== "confirmation" ||
      value.confirmation !== "RESET"
    ) {
      throw new Error("invalid-remote-control-request");
    }
    return { confirmation: "RESET" };
  }
  const required =
    method === "confirmPairing"
      ? ["pairingId", "safetyCode"]
      : method === "revokeDevice"
        ? ["deviceId", "expectedRevision"]
        : ["pairingId"];
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("|") !== [...required].sort().join("|") ||
    required.some((key) => key !== "safetyCode" && !remoteIdentifier(value[key])) ||
    (method === "confirmPairing" && !/^\d{3}\s?\d{3}$/u.test(value.safetyCode))
  ) {
    throw new Error("invalid-remote-control-request");
  }
  return Object.fromEntries(required.map((key) => [key, value[key]]));
}

function copyEndpoint(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("|") !== "host|kind|port" ||
    !["local-network", "tailscale"].includes(value.kind) ||
    typeof value.host !== "string" ||
    value.host.length < 1 ||
    value.host.length > 253 ||
    /[\s/?#@]/u.test(value.host) ||
    value.host.includes("[") ||
    value.host.includes("]") ||
    !Number.isSafeInteger(value.port) ||
    value.port < 1 ||
    value.port > 65_535
  ) {
    throw new Error("invalid-remote-control-response");
  }
  return Object.freeze({ kind: value.kind, host: value.host, port: value.port });
}

function copyPairingView(value) {
  const required = ["endpoints", "expiresAt", "manualCode", "pairingId", "qrPayload", "state"];
  const optional = ["deviceDisplayName", "deviceId", "platform", "safetyCode"];
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key)) ||
    !remoteIdentifier(value.pairingId) ||
    ![
      "created",
      "claimed",
      "confirmed",
      "denied",
      "expired",
      "locked",
      "consumed",
      "cancelled",
    ].includes(value.state) ||
    typeof value.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(value.expiresAt)) ||
    typeof value.manualCode !== "string" ||
    !/^[A-HJ-NP-Z2-9]{8,16}$/u.test(value.manualCode) ||
    typeof value.qrPayload !== "string" ||
    Buffer.byteLength(value.qrPayload, "utf8") > 16 * 1024 ||
    !Array.isArray(value.endpoints) ||
    value.endpoints.length < 1 ||
    value.endpoints.length > 8
  ) {
    throw new Error("invalid-remote-control-response");
  }
  let payload;
  try {
    payload = JSON.parse(value.qrPayload);
  } catch {
    throw new Error("invalid-remote-control-response");
  }
  if (
    payload?.type !== "workbench.remote.direct-pairing" ||
    payload?.version !== 1 ||
    payload?.pairingId !== value.pairingId ||
    payload?.manualCode !== value.manualCode ||
    "accountId" in payload ||
    "relayOrigin" in payload ||
    "accessToken" in payload
  ) {
    throw new Error("invalid-remote-control-response");
  }
  const result = {
    pairingId: value.pairingId,
    state: value.state,
    expiresAt: value.expiresAt,
    qrPayload: value.qrPayload,
    manualCode: value.manualCode,
    endpoints: Object.freeze(value.endpoints.map(copyEndpoint)),
  };
  if (value.deviceId !== undefined) {
    if (!remoteIdentifier(value.deviceId)) throw new Error("invalid-remote-control-response");
    result.deviceId = value.deviceId;
  }
  if (value.deviceDisplayName !== undefined) {
    if (
      typeof value.deviceDisplayName !== "string" ||
      Buffer.byteLength(value.deviceDisplayName, "utf8") > 128
    ) {
      throw new Error("invalid-remote-control-response");
    }
    result.deviceDisplayName = value.deviceDisplayName;
  }
  if (value.platform !== undefined) {
    if (!["ios", "android"].includes(value.platform)) {
      throw new Error("invalid-remote-control-response");
    }
    result.platform = value.platform;
  }
  if (value.safetyCode !== undefined) {
    if (!/^\d{3} \d{3}$/u.test(value.safetyCode)) {
      throw new Error("invalid-remote-control-response");
    }
    result.safetyCode = value.safetyCode;
  }
  return Object.freeze(result);
}

function copyDevice(value) {
  const required = ["createdAt", "deviceId", "deviceDisplayName", "platform", "revision", "state"];
  const optional = ["lastSeenAt"];
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key)) ||
    !remoteIdentifier(value.deviceId) ||
    typeof value.deviceDisplayName !== "string" ||
    Buffer.byteLength(value.deviceDisplayName, "utf8") > 128 ||
    !["ios", "android"].includes(value.platform) ||
    !["active", "revoked"].includes(value.state) ||
    !remoteIdentifier(value.revision) ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    (value.lastSeenAt !== undefined && !Number.isFinite(Date.parse(value.lastSeenAt)))
  ) {
    throw new Error("invalid-remote-control-response");
  }
  return Object.freeze({
    deviceId: value.deviceId,
    deviceDisplayName: value.deviceDisplayName,
    platform: value.platform,
    state: value.state,
    revision: value.revision,
    createdAt: value.createdAt,
    ...(value.lastSeenAt ? { lastSeenAt: value.lastSeenAt } : {}),
  });
}

function copyInterface(value) {
  const required = ["address", "family", "interfaceId", "interfaceName", "kind"];
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("|") !== required.sort().join("|") ||
    !remoteIdentifier(value.interfaceId) ||
    typeof value.interfaceName !== "string" ||
    Buffer.byteLength(value.interfaceName, "utf8") > 128 ||
    typeof value.address !== "string" ||
    value.address.length > 253 ||
    !["ipv4", "ipv6"].includes(value.family) ||
    !["local-network", "tailscale"].includes(value.kind)
  ) {
    throw new Error("invalid-remote-control-response");
  }
  return Object.freeze({
    interfaceId: value.interfaceId,
    interfaceName: value.interfaceName,
    address: value.address,
    family: value.family,
    kind: value.kind,
  });
}

function copySettingsView(value) {
  const required = [
    "enabled",
    "endpoints",
    "listenerState",
    "port",
    "revision",
    "selectedInterfaceIds",
  ];
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("|") !== required.sort().join("|") ||
    typeof value.enabled !== "boolean" ||
    !["disabled", "starting", "listening", "replacing", "stopping", "failed"].includes(
      value.listenerState,
    ) ||
    !Number.isSafeInteger(value.port) ||
    value.port < 1 ||
    value.port > 65_535 ||
    !remoteIdentifier(value.revision) ||
    !Array.isArray(value.selectedInterfaceIds) ||
    value.selectedInterfaceIds.length > 8 ||
    !value.selectedInterfaceIds.every(remoteIdentifier) ||
    !Array.isArray(value.endpoints) ||
    value.endpoints.length > 8
  ) {
    throw new Error("invalid-remote-control-response");
  }
  return Object.freeze({
    enabled: value.enabled,
    listenerState: value.listenerState,
    port: value.port,
    selectedInterfaceIds: Object.freeze([...value.selectedInterfaceIds]),
    revision: value.revision,
    endpoints: Object.freeze(value.endpoints.map(copyEndpoint)),
  });
}

function copyRemoteControlResult(method, value) {
  if (method === "describe" || method === "updateConfiguration") return copySettingsView(value);
  if (method === "listInterfaces") {
    if (!Array.isArray(value) || value.length > 64) {
      throw new Error("invalid-remote-control-response");
    }
    return Object.freeze(value.map(copyInterface));
  }
  if (method === "createPairing" || method === "getPairing") return copyPairingView(value);
  if (method === "listDevices") {
    if (!Array.isArray(value) || value.length > 1000)
      throw new Error("invalid-remote-control-response");
    return Object.freeze(value.map(copyDevice));
  }
  if (
    ["confirmPairing", "rejectPairing", "cancelPairing", "revokeDevice", "resetIdentity"].includes(
      method,
    )
  ) {
    if (value !== undefined) throw new Error("invalid-remote-control-response");
    return undefined;
  }
  throw new Error("invalid-remote-control-method");
}

async function assertDesktopRendererDevelopmentResponse(response) {
  if (
    !response.ok ||
    response.status !== 200 ||
    response.redirected === true ||
    response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "text/html"
  ) {
    throw new Error(
      "The development Desktop renderer did not return its canonical HTML entrypoint.",
    );
  }
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const bytes = Number(contentLength);
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 1 ||
      bytes > DESKTOP_RENDERER_DEVELOPMENT_HTML_MAX_BYTES
    ) {
      throw new Error("The development Desktop renderer HTML size was invalid.");
    }
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The development Desktop renderer HTML body was unavailable.");
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > DESKTOP_RENDERER_DEVELOPMENT_HTML_MAX_BYTES) {
        throw new Error("The development Desktop renderer HTML exceeded its size limit.");
      }
      chunks.push(Buffer.from(chunk.value));
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  if (
    bytes === 0 ||
    !Buffer.concat(chunks).toString("utf8").includes(DESKTOP_RENDERER_DEVELOPMENT_MARKER)
  ) {
    throw new Error("The development Desktop renderer identity marker was missing.");
  }
}

function rendererResourcePath(rawUrl, rendererArtifact) {
  if (typeof rawUrl !== "string" || !rawUrl.startsWith(`${DESKTOP_RENDERER_ORIGIN}/`)) {
    return undefined;
  }
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== `${DESKTOP_RENDERER_SCHEME}:` ||
    url.hostname !== "app" ||
    url.host !== "app" ||
    url.username ||
    url.password ||
    url.port ||
    /%2f|%5c/iu.test(rawUrl)
  ) {
    return undefined;
  }
  let pathname;
  try {
    const suffix = rawUrl.slice(DESKTOP_RENDERER_ORIGIN.length);
    const pathEnd = suffix.search(/[?#]/u);
    pathname = decodeURIComponent(pathEnd === -1 ? suffix : suffix.slice(0, pathEnd));
  } catch {
    return undefined;
  }
  const segments = pathname.split("/");
  const relativePath = pathname === "/" ? rendererArtifact.manifest.entrypoint : pathname.slice(1);
  if (
    !pathname.startsWith("/") ||
    !relativePath ||
    relativePath.includes("\\") ||
    (pathname !== "/" &&
      segments.slice(1).some((segment) => !segment || segment === "." || segment === "..")) ||
    !rendererArtifact.manifest.files.some((file) => file.path === relativePath)
  ) {
    return undefined;
  }
  return path.join(rendererArtifact.artifactRoot, ...relativePath.split("/"));
}

function createDesktopRendererProtocolHandler(
  rendererArtifact,
  { fetchFile, runtimeOrigin, HeadersImpl = Headers, ResponseImpl = Response },
) {
  if (
    !rendererArtifact?.artifactRoot ||
    !rendererArtifact?.manifest ||
    typeof fetchFile !== "function" ||
    !/^http:\/\/127\.0\.0\.1:\d+$/u.test(runtimeOrigin)
  ) {
    throw new Error("An admitted Desktop renderer artifact and file fetcher are required.");
  }
  return async (request) => {
    if (request?.method !== "GET") return new ResponseImpl(null, { status: 405 });
    const resourcePath = rendererResourcePath(request.url, rendererArtifact);
    if (!resourcePath) return new ResponseImpl(null, { status: 404 });
    const response = await fetchFile(pathToFileURL(resourcePath).toString());
    const headers = new HeadersImpl(response.headers);
    const runtimeWebSocketOrigin = runtimeOrigin.replace(/^http:/u, "ws:");
    headers.set(
      "Content-Security-Policy",
      [
        "default-src 'none'",
        "base-uri 'none'",
        `connect-src ${runtimeOrigin} ${runtimeWebSocketOrigin}`,
        "font-src 'self' data:",
        "form-action 'none'",
        "frame-ancestors 'none'",
        "frame-src 'none'",
        "img-src 'self' blob: data:",
        "manifest-src 'self'",
        "media-src 'self' blob: data:",
        "object-src 'none'",
        "script-src 'self'",
        "style-src 'self'",
        // xterm's DOM renderer generates styles for fonts, ANSI colors and the cursor.
        "style-src-elem 'self' 'unsafe-inline'",
        "worker-src 'self' blob:",
      ].join("; "),
    );
    return new ResponseImpl(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  };
}

module.exports = {
  DESKTOP_RENDERER_DEVELOPMENT_HTML_MAX_BYTES,
  DESKTOP_RENDERER_DEVELOPMENT_MARKER,
  DESKTOP_RENDERER_ORIGIN,
  DESKTOP_RENDERER_SCHEME,
  REMOTE_CONTROL_CHANNELS,
  assertDesktopRendererDevelopmentResponse,
  createDesktopRendererProtocolHandler,
  copyRemoteControlRequest,
  copyRemoteControlResult,
  rendererResourcePath,
};
