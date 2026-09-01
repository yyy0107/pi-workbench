import {
  RUNTIME_CONNECTION_PROTOCOL_VERSION,
  defineRuntimeConnection,
  type RuntimeConnection,
} from "@workbench/host-contracts";

/** Creates a same-origin descriptor from an origin selected by the application adapter. */
export function createSameOriginRuntimeConnection(httpOrigin: string): RuntimeConnection {
  return defineRuntimeConnection({
    kind: "same-origin",
    protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
    httpOrigin,
  });
}

/** Clone and freeze an assembly-provided descriptor before any transport closes over it. */
export function snapshotRuntimeConnection(connection: RuntimeConnection): RuntimeConnection {
  return defineRuntimeConnection(connection);
}
