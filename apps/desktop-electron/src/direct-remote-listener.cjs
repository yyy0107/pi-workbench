const { createHash } = require("node:crypto");
const http = require("node:http");
const os = require("node:os");
const { WebSocket, WebSocketServer } = require("ws");

const PAIRING_PROTOCOL = "workbench.remote.pairing.v1";
const AUTHENTICATED_PROTOCOL = "workbench.remote.direct.v1";
const SUPPORTED_PROTOCOLS = new Set([PAIRING_PROTOCOL, AUTHENTICATED_PROTOCOL]);
const MAXIMUM_SOCKET_BUFFER_BYTES = 1024 * 1024;
const MAXIMUM_FRAME_BYTES = 256 * 1024;
const SOCKET_BACKPRESSURE_TIMEOUT_MS = 10_000;

function createOriginBoundWebSocketFactory(rendererOrigin, WebSocketImpl = WebSocket) {
  if (typeof rendererOrigin !== "string" || typeof WebSocketImpl !== "function") {
    throw new Error("Desktop Runtime WebSocket configuration is invalid.");
  }
  return (url) => new WebSocketImpl(url, { origin: rendererOrigin });
}

function interfaceId(name, family, address) {
  return `interface-${createHash("sha256")
    .update(`${name}\0${family}\0${address}`, "utf8")
    .digest("hex")
    .slice(0, 24)}`;
}

async function listDirectNetworkInterfaces(networkInterfaces = os.networkInterfaces) {
  const { classifyDirectHost } =
    await import("@workbench/remote-control-direct-server/address-policy");
  const result = [];
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const value of addresses ?? []) {
      const family = value.family === 4 || value.family === "IPv4" ? "ipv4" : "ipv6";
      const address = String(value.address).split("%", 1)[0].toLowerCase();
      const kind = !value.internal && classifyDirectHost(address);
      if (!kind) continue;
      result.push({
        interfaceId: interfaceId(name, family, address),
        interfaceName: name,
        address,
        family,
        kind,
      });
    }
  }
  return result.sort((left, right) =>
    `${left.kind}:${left.interfaceName}:${left.family}:${left.address}`.localeCompare(
      `${right.kind}:${right.interfaceName}:${right.family}:${right.address}`,
    ),
  );
}

function createDirectSocketAdapter(socket, remoteAddress, options = {}) {
  const messageListeners = new Set();
  const closeListeners = new Set();
  socket.on("message", (data, isBinary) => {
    if (isBinary || data.byteLength > MAXIMUM_FRAME_BYTES) {
      socket.close(1008, "invalid_frame");
      return;
    }
    const frame = typeof data === "string" ? data : data.toString("utf8");
    for (const listener of messageListeners) listener(frame);
  });
  socket.on("close", () => {
    for (const listener of closeListeners) listener();
    messageListeners.clear();
    closeListeners.clear();
  });
  socket.on("error", () => socket.close());
  return {
    remoteAddress,
    send(frame) {
      return new Promise((resolve, reject) => {
        const frameBytes = Buffer.byteLength(frame, "utf8");
        if (
          socket.readyState !== 1 ||
          frameBytes > MAXIMUM_FRAME_BYTES ||
          socket.bufferedAmount + frameBytes > MAXIMUM_SOCKET_BUFFER_BYTES
        ) {
          socket.close(1008, "slow_consumer");
          reject(new Error("direct_socket_backpressured"));
          return;
        }
        let settled = false;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (error) reject(error);
          else resolve();
        };
        const timer = setTimeout(() => {
          socket.close(1008, "slow_consumer");
          finish(new Error("direct_socket_backpressured"));
        }, options.sendBackpressureTimeoutMs ?? SOCKET_BACKPRESSURE_TIMEOUT_MS);
        timer.unref?.();
        try {
          socket.send(frame, finish);
        } catch (error) {
          finish(error);
        }
      });
    },
    close: (code, reason) => socket.close(code, reason),
    onMessage(listener) {
      messageListeners.add(listener);
      return { dispose: () => void messageListeners.delete(listener) };
    },
    onClose(listener) {
      closeListeners.add(listener);
      return { dispose: () => void closeListeners.delete(listener) };
    },
  };
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}

function listen(server, address, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host: address, port, exclusive: true });
  });
}

function sameInterface(left, right) {
  return (
    Boolean(right) &&
    left.interfaceId === right.interfaceId &&
    left.interfaceName === right.interfaceName &&
    left.address === right.address &&
    left.family === right.family &&
    left.kind === right.kind
  );
}

function createDirectRemoteListener(options = {}) {
  const httpModule = options.http ?? http;
  const WebSocketServerClass = options.WebSocketServer ?? WebSocketServer;
  const networkInterfaces = options.networkInterfaces ?? os.networkInterfaces;
  let currentGeneration;

  const createSlot = async (address, port, path, onSocket) => {
    const sockets = new Set();
    const server = httpModule.createServer((_request, response) => {
      response.writeHead(404, {
        "cache-control": "no-store",
        "content-length": "0",
      });
      response.end();
    });
    const webSockets = new WebSocketServerClass({
      noServer: true,
      perMessageDeflate: false,
      maxPayload: MAXIMUM_FRAME_BYTES,
      handleProtocols(protocols) {
        if (protocols.has(AUTHENTICATED_PROTOCOL)) return AUTHENTICATED_PROTOCOL;
        if (protocols.has(PAIRING_PROTOCOL)) return PAIRING_PROTOCOL;
        return false;
      },
    });
    const endpoint = { kind: address.kind, host: address.address, port };
    const slot = {
      key: `${address.family}:${address.address}:${port}`,
      server,
      webSockets,
      sockets,
      endpoint,
      onSocket,
      references: 1,
      closed: false,
    };
    webSockets.on("connection", (socket, request) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      const mode = socket.protocol === PAIRING_PROTOCOL ? "pairing" : "authenticated";
      try {
        slot.onSocket(
          createDirectSocketAdapter(socket, request.socket.remoteAddress),
          endpoint,
          mode,
        );
      } catch {
        socket.close(1008, "connection_rejected");
      }
    });
    server.on("upgrade", (request, socket, head) => {
      const protocols = String(request.headers["sec-websocket-protocol"] ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      if (
        request.method !== "GET" ||
        request.url !== path ||
        !protocols.some((protocol) => SUPPORTED_PROTOCOLS.has(protocol))
      ) {
        socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      webSockets.handleUpgrade(request, socket, head, (webSocket) => {
        webSockets.emit("connection", webSocket, request);
      });
    });
    try {
      await listen(server, address.address, port);
      return slot;
    } catch (error) {
      webSockets.close();
      await closeServer(server);
      throw error;
    }
  };

  const releaseSlot = async (slot) => {
    if (slot.closed || --slot.references > 0) return;
    slot.closed = true;
    for (const socket of slot.sockets) socket.close(1001, "listener_disabled");
    await closeServer(slot.server);
    slot.webSockets.close();
  };

  const prepare = async ({ addresses, port, path, onSocket }) => {
    if (
      !Array.isArray(addresses) ||
      addresses.length < 1 ||
      addresses.length > 8 ||
      !Number.isSafeInteger(port) ||
      port < 1 ||
      port > 65_535 ||
      path !== "/remote/v1/direct" ||
      typeof onSocket !== "function"
    ) {
      throw new Error("direct_listener_configuration_invalid");
    }
    const unique = new Set(addresses.map((value) => value.interfaceId));
    if (unique.size !== addresses.length) throw new Error("direct_listener_configuration_invalid");

    const available = await listDirectNetworkInterfaces(networkInterfaces);
    const availableById = new Map(available.map((item) => [item.interfaceId, item]));
    if (addresses.some((item) => !sameInterface(item, availableById.get(item.interfaceId)))) {
      throw new Error("direct_listener_interface_disappeared");
    }

    const currentByKey = new Map((currentGeneration?.slots ?? []).map((slot) => [slot.key, slot]));
    const slots = [];
    const newSlots = [];
    try {
      for (const address of addresses) {
        const key = `${address.family}:${address.address}:${port}`;
        const shared = currentByKey.get(key);
        if (shared) {
          slots.push(shared);
          continue;
        }
        const created = await createSlot(address, port, path, onSocket);
        slots.push(created);
        newSlots.push(created);
      }
    } catch (error) {
      await Promise.allSettled(newSlots.map(releaseSlot));
      throw Object.assign(new Error("direct_listener_bind_failed"), { cause: error });
    }

    let disposed = false;
    let committed = false;
    const generation = {
      slots,
      endpoints: slots.map((slot) => slot.endpoint),
      async commit() {
        if (disposed || committed) throw new Error("direct_listener_candidate_invalid");
        committed = true;
        const previous = currentGeneration;
        for (const slot of slots) {
          if (!newSlots.includes(slot)) slot.references += 1;
          slot.onSocket = onSocket;
        }
        currentGeneration = generation;
        await previous?.dispose();
        return { dispose: () => generation.dispose() };
      },
      async dispose() {
        if (disposed) return;
        disposed = true;
        if (currentGeneration === generation) currentGeneration = undefined;
        const owned = committed ? slots : newSlots;
        await Promise.allSettled(owned.map(releaseSlot));
      },
    };
    return generation;
  };

  return {
    listInterfaces: () => listDirectNetworkInterfaces(networkInterfaces),
    prepare,
    async dispose() {
      const current = currentGeneration;
      currentGeneration = undefined;
      await current?.dispose();
    },
  };
}

module.exports = {
  AUTHENTICATED_PROTOCOL,
  MAXIMUM_FRAME_BYTES,
  MAXIMUM_SOCKET_BUFFER_BYTES,
  PAIRING_PROTOCOL,
  SOCKET_BACKPRESSURE_TIMEOUT_MS,
  createOriginBoundWebSocketFactory,
  createDirectSocketAdapter,
  createDirectRemoteListener,
  listDirectNetworkInterfaces,
};
