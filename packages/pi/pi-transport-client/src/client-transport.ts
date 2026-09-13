import type { PiHttpTransport } from "./api";
import type { PiWebSocketFactory } from "./connections";

/**
 * Installation-scoped Pi carriers. The application composition root resolves a Host connection
 * into these transport functions so Pi's domain/runtime layer never depends on RuntimeConnection.
 */
export interface PiClientTransport {
  readonly http?: PiHttpTransport;
  readonly webSocketFactory?: PiWebSocketFactory;
}

const DEFAULT_PI_CLIENT_TRANSPORT: Readonly<PiClientTransport> = Object.freeze({});

/** Capture caller-owned configuration once so later object mutation cannot retarget an install. */
export function snapshotPiClientTransport(
  transport?: PiClientTransport,
): Readonly<PiClientTransport> {
  if (!transport) return DEFAULT_PI_CLIENT_TRANSPORT;
  return Object.freeze({
    ...(transport.http === undefined ? {} : { http: transport.http }),
    ...(transport.webSocketFactory === undefined
      ? {}
      : { webSocketFactory: transport.webSocketFactory }),
  });
}
