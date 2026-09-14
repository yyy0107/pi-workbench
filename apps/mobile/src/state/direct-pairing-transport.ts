import type {
  DirectPairingHelloV1,
  DirectSealedEnvelopeV1,
} from "@workbench/remote-control-contracts/protocol";
import { validateDirectClientEndpoint } from "@workbench/remote-control-client/endpoint-policy";

import type {
  MobileDirectPairingSession,
  MobileDirectPairingTransportPort,
} from "../features/direct-pairing.ts";

const MAXIMUM_PAIRING_FRAME_BYTES = 16 * 1024;

interface PairingWebSocketMessageEvent {
  readonly data: unknown;
}

interface PairingWebSocket {
  readonly readyState: number;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: PairingWebSocketMessageEvent) => void): void;
  addEventListener(type: "close" | "error", listener: () => void): void;
  send(frame: string): void;
  close(code?: number, reason?: string): void;
}

interface PairingWebSocketConstructor {
  new (url: string, protocols?: string | readonly string[]): PairingWebSocket;
}

function endpointUrl(value: unknown): string {
  const endpoint = validateDirectClientEndpoint(value);
  const host = endpoint.host.includes(":") ? `[${endpoint.host}]` : endpoint.host;
  return `ws://${host}:${endpoint.port}/remote/v1/direct`;
}

function parseFrame(value: unknown): unknown {
  if (
    typeof value !== "string" ||
    new TextEncoder().encode(value).byteLength > MAXIMUM_PAIRING_FRAME_BYTES
  ) {
    throw new Error("pairing_response_invalid");
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error("pairing_response_invalid");
  }
}

export function createMobileDirectPairingWebSocketTransport(
  options: {
    readonly WebSocket?: PairingWebSocketConstructor;
  } = {},
): MobileDirectPairingTransportPort {
  const WebSocketImpl =
    options.WebSocket ?? (globalThis.WebSocket as unknown as PairingWebSocketConstructor);
  return {
    async connect(endpoint, signal): Promise<MobileDirectPairingSession> {
      const socket = new WebSocketImpl(endpointUrl(endpoint), "workbench.remote.pairing.v1");
      const queued: unknown[] = [];
      const readers: Array<{
        readonly resolve: (value: unknown) => void;
        readonly reject: (error: Error) => void;
      }> = [];
      let closed = false;
      let failure: Error | undefined;
      let openedResolve!: () => void;
      let openedReject!: (error: Error) => void;
      const opened = new Promise<void>((resolve, reject) => {
        openedResolve = resolve;
        openedReject = reject;
      });
      const fail = (error: Error) => {
        if (closed) return;
        failure = error;
        closed = true;
        openedReject(error);
        while (readers.length > 0) readers.shift()?.reject(error);
      };
      const onAbort = () => {
        socket.close(1000, "pairing_cancelled");
        fail(new Error("pairing_cancelled"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      socket.addEventListener("open", openedResolve);
      socket.addEventListener("error", () => fail(new Error("network_error")));
      socket.addEventListener("close", () => fail(new Error("pairing_connection_closed")));
      socket.addEventListener("message", (event) => {
        let value: unknown;
        try {
          value = parseFrame(event.data);
        } catch (error) {
          socket.close(1008, "invalid_frame");
          fail(error instanceof Error ? error : new Error("pairing_response_invalid"));
          return;
        }
        const reader = readers.shift();
        if (reader) reader.resolve(value);
        else if (queued.length < 2) queued.push(value);
        else {
          socket.close(1008, "invalid_frame");
          fail(new Error("pairing_response_invalid"));
        }
      });

      const next = async (nextSignal?: AbortSignal): Promise<unknown> => {
        if (failure) throw failure;
        if (nextSignal?.aborted) throw new Error("pairing_cancelled");
        if (queued.length > 0) return queued.shift();
        return new Promise((resolve, reject) => {
          const reader = { resolve, reject };
          readers.push(reader);
          nextSignal?.addEventListener(
            "abort",
            () => {
              const index = readers.indexOf(reader);
              if (index >= 0) readers.splice(index, 1);
              reject(new Error("pairing_cancelled"));
            },
            { once: true },
          );
        });
      };

      await opened;
      return {
        hello: (nextSignal) => next(nextSignal) as Promise<DirectPairingHelloV1>,
        async sendClaim(envelope, nextSignal): Promise<void> {
          if (nextSignal?.aborted || closed || socket.readyState !== 1) {
            throw new Error("pairing_cancelled");
          }
          socket.send(JSON.stringify(envelope));
        },
        receiveResult: (nextSignal) => next(nextSignal) as Promise<DirectSealedEnvelopeV1>,
        close(reason): void {
          signal?.removeEventListener("abort", onAbort);
          if (!closed) {
            closed = true;
            socket.close(1000, reason);
          }
        },
      };
    },
  };
}
