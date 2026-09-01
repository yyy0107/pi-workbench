export interface WorkbenchHostProbeOptions {
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

export interface WaitForWorkbenchHostOptions {
  readonly timeoutMs: number;
  readonly intervalMs?: number;
  readonly probeTimeoutMs?: number;
  readonly beforeAttempt?: () => void;
}

export declare const DEFAULT_MAX_RESPONSE_BYTES: number;
export declare const DEFAULT_PROBE_TIMEOUT_MS: number;
export declare const DEFAULT_READINESS_INTERVAL_MS: number;

export declare function isWorkbenchServer(
  url: string | URL,
  options?: WorkbenchHostProbeOptions,
): Promise<boolean>;

export declare function waitForWorkbenchServer(
  url: string | URL,
  options: WaitForWorkbenchHostOptions,
): Promise<boolean>;
