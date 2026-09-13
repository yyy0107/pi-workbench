import type { RuntimeConnection } from "@workbench/host-contracts";

/** Trusted renderer capability for obtaining an in-memory desktop Runtime connection. */
export interface DesktopRuntimeBootstrapPort {
  bootstrap(): RuntimeConnection | Promise<RuntimeConnection>;
}

/** Trusted renderer capability for asking the desktop container to replace its Runtime. */
export interface DesktopRuntimeLifecyclePort {
  restartRuntime(): void | Promise<void>;
}

export function readDesktopRuntimeBootstrapPort(
  value: unknown,
): DesktopRuntimeBootstrapPort | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(["bootstrap"])) return undefined;
  const bootstrap = (value as { bootstrap?: unknown }).bootstrap;
  if (typeof bootstrap !== "function") return undefined;
  return value as DesktopRuntimeBootstrapPort;
}

export function readDesktopRuntimeLifecyclePort(
  value: unknown,
): DesktopRuntimeLifecyclePort | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(["restartRuntime"])) {
    return undefined;
  }
  const restartRuntime = (value as { restartRuntime?: unknown }).restartRuntime;
  if (typeof restartRuntime !== "function") return undefined;
  return value as DesktopRuntimeLifecyclePort;
}
