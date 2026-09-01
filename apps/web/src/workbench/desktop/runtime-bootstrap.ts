import { readDesktopRuntimeBootstrapPort } from "@workbench/desktop-contracts/runtime-bootstrap";
import { defineRuntimeConnection, type RuntimeConnection } from "@workbench/host-contracts";

import type { WorkbenchDesktopBridge } from "./title-bar-overlay";

export function readWorkbenchDesktopRuntimeConnection(
  value: unknown,
): RuntimeConnection | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const bridge = value as WorkbenchDesktopBridge;
  if (!("runtime" in bridge)) return undefined;
  const port = readDesktopRuntimeBootstrapPort(bridge.runtime);
  if (!port) throw new Error("Invalid desktop Runtime bootstrap port.");
  return defineRuntimeConnection(port.bootstrap());
}

export function getWorkbenchDesktopRuntimeConnection(): RuntimeConnection | undefined {
  if (typeof window === "undefined") return undefined;
  return readWorkbenchDesktopRuntimeConnection(window.workbenchDesktop);
}
