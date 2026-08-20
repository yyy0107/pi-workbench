import { basename } from "node:path";
import { stripVTControlCharacters } from "node:util";

import { spawn, type IPty } from "node-pty";

import type { TerminalErrorCode } from "../contracts";
import {
  TerminalSessionError,
  type AttachedTerminalSession,
  type TerminalExitEvent,
  type TerminalPty,
  type TerminalPtySpawner,
  type TerminalSessionClient,
  type TerminalSessionSubscription,
} from "./terminal-session-manager";

const DEFAULT_COLS = 100;
const DEFAULT_ROWS = 30;
const DEFAULT_HISTORY_BYTES = 1024 * 1024;
const DEFAULT_RETENTION_MS = 10 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = 128;

export interface ToolTerminalExecutionOptions {
  sessionId: string;
  toolCallId: string;
  command: string;
  cwd: string;
  onData(data: Buffer): void;
  signal?: AbortSignal;
  timeout?: number;
  env?: NodeJS.ProcessEnv;
  shell?: string;
}

export interface AttachToolTerminalOptions {
  sessionId: string;
  toolCallId: string;
  cols?: number;
  rows?: number;
}

export interface ToolTerminalSessionManagerOptions {
  spawnPty?: TerminalPtySpawner;
  terminatePty?: (terminal: TerminalPty) => void;
  shell?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  maxHistoryBytes?: number;
  retentionMs?: number;
  maxSessions?: number;
}

type StopReason = "aborted" | "timeout";

interface ManagedToolTerminalSession {
  readonly key: string;
  readonly sessionId: string;
  readonly toolCallId: string;
  readonly command: string;
  readonly cwd: string;
  readonly shell: string;
  readonly pty: TerminalPty;
  readonly clients: Set<TerminalSessionClient>;
  readonly completion: Promise<{ exitCode: number | null }>;
  resolve(result: { exitCode: number | null }): void;
  reject(error: Error): void;
  history: string[];
  historyBytes: number;
  stopReason?: StopReason;
  timeoutSeconds?: number;
  exitEvent?: TerminalExitEvent;
  timeoutHandle?: NodeJS.Timeout;
  retentionTimer?: NodeJS.Timeout;
  dataSubscription?: { dispose(): void };
  exitSubscription?: { dispose(): void };
  removeAbortListener?: () => void;
}

function defaultPtySpawner(
  file: string,
  args: readonly string[],
  options: Parameters<TerminalPtySpawner>[2],
): IPty {
  return spawn(file, [...args], options);
}

function defaultPtyTerminator(platform: NodeJS.Platform): (terminal: TerminalPty) => void {
  if (platform === "win32") return (terminal) => terminal.kill();
  return (terminal) => {
    try {
      process.kill(-terminal.pid, "SIGKILL");
    } catch {
      terminal.kill();
    }
  };
}

function configuredShell(
  shell: string | undefined,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string {
  const candidate = shell?.trim() || env.WORKBENCH_TERMINAL_SHELL?.trim() || env.SHELL?.trim();
  if (candidate) return candidate;
  return platform === "win32" ? "powershell.exe" : "/bin/bash";
}

function shellArguments(platform: NodeJS.Platform, command: string): string[] {
  return platform === "win32" ? ["-NoLogo", "-NoProfile", "-Command", command] : ["-lc", command];
}

function boundedDimension(value: number | undefined, fallback: number, min: number, max: number) {
  return Number.isInteger(value) ? Math.min(max, Math.max(min, Number(value))) : fallback;
}

function sessionKey(sessionId: string, toolCallId: string): string {
  return `${sessionId}\u0000${toolCallId}`;
}

function historyBytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function terminalError(code: TerminalErrorCode, message: string): TerminalSessionError {
  return new TerminalSessionError(code, message);
}

export class ToolTerminalSessionManager {
  readonly #spawnPty: TerminalPtySpawner;
  readonly #terminatePty: (terminal: TerminalPty) => void;
  readonly #shell: string;
  readonly #environment: NodeJS.ProcessEnv;
  readonly #platform: NodeJS.Platform;
  readonly #maxHistoryBytes: number;
  readonly #retentionMs: number;
  readonly #maxSessions: number;
  readonly #sessions = new Map<string, ManagedToolTerminalSession>();

  constructor(options: ToolTerminalSessionManagerOptions = {}) {
    this.#spawnPty = options.spawnPty ?? defaultPtySpawner;
    this.#environment = options.env ?? process.env;
    this.#platform = options.platform ?? process.platform;
    this.#terminatePty = options.terminatePty ?? defaultPtyTerminator(this.#platform);
    this.#shell = configuredShell(options.shell, this.#environment, this.#platform);
    this.#maxHistoryBytes = options.maxHistoryBytes ?? DEFAULT_HISTORY_BYTES;
    this.#retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
    this.#maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
  }

  async execute(options: ToolTerminalExecutionOptions): Promise<{ exitCode: number | null }> {
    if (options.signal?.aborted) throw new Error("aborted");
    const key = sessionKey(options.sessionId, options.toolCallId);
    const existing = this.#sessions.get(key);
    if (existing && !existing.exitEvent) {
      throw terminalError("session-conflict", "Tool terminal is already running.");
    }
    if (existing) this.#delete(existing);
    this.#evictCompletedSessions();
    if (this.#sessions.size >= this.#maxSessions) {
      throw terminalError("session-limit", "Tool terminal session limit reached.");
    }

    const environment = {
      ...this.#environment,
      ...options.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      TERM_PROGRAM: "Pi Workbench",
    };
    const shell = options.shell?.trim() || this.#shell;
    const terminal = this.#spawnPty(shell, shellArguments(this.#platform, options.command), {
      cwd: options.cwd,
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      env: environment,
      name: "xterm-256color",
    });
    let resolve!: (result: { exitCode: number | null }) => void;
    let reject!: (error: Error) => void;
    const completion = new Promise<{ exitCode: number | null }>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const session: ManagedToolTerminalSession = {
      key,
      sessionId: options.sessionId,
      toolCallId: options.toolCallId,
      command: options.command,
      cwd: options.cwd,
      shell,
      pty: terminal,
      clients: new Set(),
      completion,
      resolve,
      reject,
      history: [],
      historyBytes: 0,
    };
    this.#appendHistory(session, `$ ${options.command.replace(/\r?\n/g, "\r\n")}\r\n`);
    this.#sessions.set(key, session);

    session.dataSubscription = terminal.onData((data) => {
      if (session.exitEvent || !data) return;
      this.#appendHistory(session, data);
      const plainText = stripVTControlCharacters(data);
      if (plainText) options.onData(Buffer.from(plainText, "utf8"));
      for (const client of session.clients) client.onData(data);
    });
    session.exitSubscription = terminal.onExit((event) => this.#finish(session, event));

    if (options.signal) {
      const onAbort = () => this.#stop(session, "aborted");
      options.signal.addEventListener("abort", onAbort, { once: true });
      session.removeAbortListener = () => options.signal?.removeEventListener("abort", onAbort);
    }
    if (options.timeout !== undefined) {
      session.timeoutSeconds = options.timeout;
      session.timeoutHandle = setTimeout(
        () => this.#stop(session, "timeout"),
        Math.max(1, options.timeout * 1000),
      );
      session.timeoutHandle.unref?.();
    }

    return completion;
  }

  async attach(options: AttachToolTerminalOptions): Promise<AttachedTerminalSession> {
    const session = this.#sessions.get(sessionKey(options.sessionId, options.toolCallId));
    if (!session) throw terminalError("invalid-session", "Tool terminal is unavailable.");
    if (!session.exitEvent) {
      session.pty.resize(
        boundedDimension(options.cols, DEFAULT_COLS, 2, 500),
        boundedDimension(options.rows, DEFAULT_ROWS, 1, 300),
      );
    }
    return this.#attached(session);
  }

  dispose(): void {
    for (const session of this.#sessions.values()) {
      if (!session.exitEvent) {
        session.stopReason = "aborted";
        try {
          this.#terminatePty(session.pty);
        } catch {
          // Finish below remains authoritative.
        }
        this.#finish(session, { exitCode: 130 });
      }
      this.#delete(session);
    }
  }

  #attached(session: ManagedToolTerminalSession): AttachedTerminalSession {
    return {
      sessionId: `tool:${session.sessionId}:${session.toolCallId}`,
      cwd: session.cwd,
      process: session.pty.process || basename(session.shell),
      pid: session.pty.pid,
      subscribe: (client) => this.#subscribe(session, client),
      write: (data) => {
        if (!session.exitEvent) session.pty.write(data);
      },
      run: () => {
        throw terminalError("invalid-message", "A tool terminal cannot run another command.");
      },
      resize: (cols, rows) => {
        if (!session.exitEvent) {
          session.pty.resize(
            boundedDimension(cols, DEFAULT_COLS, 2, 500),
            boundedDimension(rows, DEFAULT_ROWS, 1, 300),
          );
        }
      },
      interrupt: () => this.#stop(session, "aborted"),
    };
  }

  #subscribe(
    session: ManagedToolTerminalSession,
    client: TerminalSessionClient,
  ): TerminalSessionSubscription {
    if (session.retentionTimer) {
      clearTimeout(session.retentionTimer);
      session.retentionTimer = undefined;
    }
    if (!session.exitEvent) session.clients.add(client);
    else queueMicrotask(() => client.onExit(session.exitEvent!));
    let attached = true;
    return {
      history: session.history.join(""),
      detach: () => {
        if (!attached) return;
        attached = false;
        session.clients.delete(client);
        if (session.exitEvent && session.clients.size === 0) this.#scheduleRetention(session);
      },
    };
  }

  #appendHistory(session: ManagedToolTerminalSession, data: string): void {
    session.history.push(data);
    session.historyBytes += historyBytes(data);
    while (session.historyBytes > this.#maxHistoryBytes && session.history.length > 0) {
      const removed = session.history.shift();
      if (removed) session.historyBytes -= historyBytes(removed);
    }
  }

  #stop(session: ManagedToolTerminalSession, reason: StopReason): void {
    if (session.exitEvent) return;
    session.stopReason ??= reason;
    try {
      this.#terminatePty(session.pty);
    } catch {
      this.#finish(session, { exitCode: 130 });
    }
  }

  #finish(session: ManagedToolTerminalSession, event: TerminalExitEvent): void {
    if (session.exitEvent) return;
    session.exitEvent = event;
    session.dataSubscription?.dispose();
    session.exitSubscription?.dispose();
    session.removeAbortListener?.();
    if (session.timeoutHandle) clearTimeout(session.timeoutHandle);
    for (const client of session.clients) client.onExit(event);
    session.clients.clear();
    if (session.stopReason === "aborted") session.reject(new Error("aborted"));
    else if (session.stopReason === "timeout") {
      session.reject(new Error(`timeout:${session.timeoutSeconds ?? 0}`));
    } else session.resolve({ exitCode: event.exitCode });
    this.#scheduleRetention(session);
  }

  #scheduleRetention(session: ManagedToolTerminalSession): void {
    if (!session.exitEvent || session.clients.size > 0 || session.retentionTimer) return;
    if (this.#retentionMs <= 0) {
      this.#delete(session);
      return;
    }
    session.retentionTimer = setTimeout(() => this.#delete(session), this.#retentionMs);
    session.retentionTimer.unref?.();
  }

  #delete(session: ManagedToolTerminalSession): void {
    if (this.#sessions.get(session.key) !== session) return;
    this.#sessions.delete(session.key);
    if (session.retentionTimer) clearTimeout(session.retentionTimer);
    session.dataSubscription?.dispose();
    session.exitSubscription?.dispose();
    session.removeAbortListener?.();
    if (session.timeoutHandle) clearTimeout(session.timeoutHandle);
  }

  #evictCompletedSessions(): void {
    if (this.#sessions.size < this.#maxSessions) return;
    for (const session of this.#sessions.values()) {
      if (!session.exitEvent) continue;
      this.#delete(session);
      if (this.#sessions.size < this.#maxSessions) return;
    }
  }
}

const terminalGlobal = globalThis as typeof globalThis & {
  __workbenchToolTerminalSessions?: ToolTerminalSessionManager;
};

export function getToolTerminalSessionManager(): ToolTerminalSessionManager {
  terminalGlobal.__workbenchToolTerminalSessions ??= new ToolTerminalSessionManager();
  return terminalGlobal.__workbenchToolTerminalSessions;
}
