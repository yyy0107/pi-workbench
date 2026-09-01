import type { ChildProcess } from "node:child_process";

export interface WindowsProcessIdentity {
  readonly pid: number;
  readonly parentPid: number;
  readonly creationDate: string;
  readonly executable: string;
  readonly commandLine: string;
  readonly argv: readonly string[];
}

export interface WindowsProcessRegistry {
  readonly failure: Error | undefined;
  readonly leaderPid: number | undefined;
  readonly records: ReadonlyMap<
    number,
    { readonly depth: number; readonly identity: WindowsProcessIdentity }
  >;
  register(pid: number, child?: Pick<ChildProcess, "once">): this;
  refresh(): ReadonlyMap<number, WindowsProcessIdentity>;
  dispose(): void;
}

export function readWindowsProcessCensus(): readonly WindowsProcessIdentity[];
export function createWindowsProcessRegistry(options?: {
  readonly censusIntervalMs?: number;
  readonly readCensus?: () => readonly WindowsProcessIdentity[];
}): WindowsProcessRegistry;
export function killWindowsProcessTree(pid: number): Promise<void>;
export function terminateVerifiedWindowsProcessTree(
  registry: WindowsProcessRegistry,
  killTree?: (pid: number) => Promise<void>,
): Promise<boolean>;
