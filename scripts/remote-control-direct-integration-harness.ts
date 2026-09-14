import type { DirectEndpointV1 } from "../packages/contracts/remote-control-contracts/src/protocol.ts";
import type { DirectRemoteGateway } from "../packages/server/remote-control-direct-server/src/gateway.ts";
import type { DirectSocketPort } from "../packages/server/remote-control-direct-server/src/ports.ts";

type ClientEvent = "open" | "message" | "close" | "error";
type ClientListener = (event?: { readonly data: unknown }) => void;

export async function waitForDirectCondition(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("direct_integration_condition_not_reached");
}

function endpointUrl(endpoint: DirectEndpointV1): string {
  const host = endpoint.host.includes(":") ? `[${endpoint.host}]` : endpoint.host;
  return `ws://${host}:${endpoint.port}/remote/v1/direct`;
}

/**
 * Replaces only the operating system's WebSocket hop. Both sides of the protocol remain the
 * production mobile WebSocket adapters and embedded direct gateway.
 */
export function createInMemoryDirectWebSocket(options: {
  readonly gateway: DirectRemoteGateway;
  readonly endpoints: readonly DirectEndpointV1[];
  readonly unreachableUrls?: ReadonlySet<string>;
}) {
  const endpointsByUrl = new Map(
    options.endpoints.map((endpoint) => [endpointUrl(endpoint), endpoint]),
  );

  return class InMemoryDirectWebSocket {
    bufferedAmount = 0;
    readyState = 0;
    private closed = false;
    private readonly clientListeners = new Map<ClientEvent, Set<ClientListener>>();
    private readonly serverMessageListeners = new Set<(frame: string) => void>();
    private readonly serverCloseListeners = new Set<() => void>();

    constructor(url: string, protocols?: string | readonly string[]) {
      queueMicrotask(() => {
        const endpoint = endpointsByUrl.get(url);
        if (!endpoint || options.unreachableUrls?.has(url)) {
          this.emit("error");
          this.finish();
          return;
        }
        this.readyState = 1;
        this.emit("open");
        const requested = Array.isArray(protocols) ? protocols : protocols ? [protocols] : [];
        const mode = requested.includes("workbench.remote.pairing.v1")
          ? "pairing"
          : "authenticated";
        options.gateway.accept(this.serverSocket, endpoint, mode);
      });
    }

    addEventListener(type: ClientEvent, listener: ClientListener): void {
      const values = this.clientListeners.get(type) ?? new Set();
      values.add(listener);
      this.clientListeners.set(type, values);
    }

    send(frame: string): void {
      if (this.closed || this.readyState !== 1) throw new Error("network_error");
      for (const listener of this.serverMessageListeners) listener(frame);
    }

    close(): void {
      this.finish();
    }

    private readonly serverSocket: DirectSocketPort = {
      remoteAddress: "192.168.1.44",
      send: async (frame) => {
        if (this.closed) throw new Error("network_error");
        this.emit("message", { data: frame });
      },
      close: () => this.finish(),
      onMessage: (listener) => {
        this.serverMessageListeners.add(listener);
        return { dispose: () => void this.serverMessageListeners.delete(listener) };
      },
      onClose: (listener) => {
        this.serverCloseListeners.add(listener);
        return { dispose: () => void this.serverCloseListeners.delete(listener) };
      },
    };

    private emit(type: ClientEvent, event?: { readonly data: unknown }): void {
      for (const listener of this.clientListeners.get(type) ?? []) listener(event);
    }

    private finish(): void {
      if (this.closed) return;
      this.closed = true;
      this.readyState = 3;
      for (const listener of [...this.serverCloseListeners]) listener();
      this.emit("close");
    }
  };
}

export function directEndpointUrl(endpoint: DirectEndpointV1): string {
  return endpointUrl(endpoint);
}
