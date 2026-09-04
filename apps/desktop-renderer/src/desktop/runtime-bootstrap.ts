import {
  readDesktopRuntimeBootstrapPort,
  readDesktopRuntimeLifecyclePort,
} from "@workbench/desktop-contracts/runtime-bootstrap";
import { defineRuntimeConnection, type RuntimeConnection } from "@workbench/host-contracts";

export interface WorkbenchDesktopBridge {
  readonly lifecycle?: unknown;
  readonly runtime?: unknown;
  readonly titleBar?: unknown;
}

declare global {
  interface Window {
    workbenchDesktop?: WorkbenchDesktopBridge;
  }
}

let bootstrapRequest: Promise<RuntimeConnection> | undefined;

async function requestDesktopRuntimeConnection(): Promise<RuntimeConnection> {
  const port = readDesktopRuntimeBootstrapPort(window.workbenchDesktop?.runtime);
  if (!port) throw new Error("Desktop Runtime bootstrap capability is unavailable.");
  return defineRuntimeConnection(await port.bootstrap());
}

/** Resolve the Electron runtime capability exactly once per attempt. */
export function bootstrapDesktopRuntimeConnection(): Promise<RuntimeConnection> {
  bootstrapRequest ??= requestDesktopRuntimeConnection().catch((error: unknown) => {
    bootstrapRequest = undefined;
    throw error;
  });
  return bootstrapRequest;
}

export async function restartDesktopRuntime(): Promise<void> {
  const port = readDesktopRuntimeLifecyclePort(window.workbenchDesktop?.lifecycle);
  if (!port) throw new Error("Desktop Runtime lifecycle capability is unavailable.");
  try {
    await port.restartRuntime();
  } finally {
    // A failed replacement returns through the existing bootstrap/retry path.
    window.location.reload();
  }
}
