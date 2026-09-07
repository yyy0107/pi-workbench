import { readDesktopSystemFontsPort } from "@workbench/desktop-contracts";
import {
  readDesktopRuntimeBootstrapPort,
  readDesktopRuntimeLifecyclePort,
} from "@workbench/desktop-contracts/runtime-bootstrap";
import { defineRuntimeConnection, type RuntimeConnection } from "@workbench/host-contracts";

export interface WorkbenchDesktopBridge {
  readonly settings?: unknown;
  readonly systemFonts?: unknown;
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
  await port.restartRuntime();
  // Keep the current shell and its restart command available if replacement fails.
  window.location.reload();
}

export async function getDesktopFontFamilies(): Promise<readonly string[]> {
  const port = readDesktopSystemFontsPort(window.workbenchDesktop?.systemFonts);
  if (!port) throw new Error("Desktop system fonts capability is unavailable.");
  return port.getFontFamilies();
}
