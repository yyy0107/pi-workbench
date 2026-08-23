import { realpath, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { spawn, type IPty } from "node-pty";

import type { TerminalErrorCode } from "../contracts";
import { terminalEnvironment } from "./terminal-environment";

const DEFAULT_COLS = 100;
const DEFAULT_ROWS = 30;
const DEFAULT_HISTORY_BYTES = 1024 * 1024;
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = 32;

export interface TerminalExitEvent {
  exitCode: number;
  signal?: number;
}

export interface TerminalSessionClient {
  onData(data: string): void;
  onExit(event: TerminalExitEvent): void;
}

export interface TerminalPty {
  readonly pid: number;
  readonly process: string;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: TerminalExitEvent) => void): { dispose(): void };
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export type TerminalPtySpawner = (
  file: string,
  args: readonly string[],
  options: {
    cwd: string;
    cols: number;
    rows: number;
    env: Readonly<Record<string, string | undefined>>;
    name: string;
  },
) => TerminalPty;

export interface TerminalSessionManagerOptions {
  spawnPty?: TerminalPtySpawner;
  shell?: string;
  env?: Readonly<Record<string, string | undefined>>;
  platform?: NodeJS.Platform;
  defaultCwd?: string;
  maxHistoryBytes?: number;
  idleTimeoutMs?: number;
  maxSessions?: number;
}

export interface AttachTerminalSessionOptions {
  sessionId: string;
  cwd?: string;
  cols?: number;
  rows?: number;
}

export interface TerminalSessionSubscription {
  readonly history: string;
  detach(): void;
}

export interface AttachedTerminalSession {
  readonly sessionId: string;
  readonly cwd: string;
  readonly process: string;
  readonly pid: number;
  subscribe(client: TerminalSessionClient): TerminalSessionSubscription;
  write(data: string): void;
  run(command: string): void;
  resize(cols: number, rows: number): void;
  interrupt(): void;
}

export class TerminalSessionError extends Error {
  readonly code: TerminalErrorCode;

  constructor(code: TerminalErrorCode, message: string) {
    super(message);
    this.name = "TerminalSessionError";
    this.code = code;
  }
}

interface ManagedTerminalSession {
  readonly id: string;
  readonly cwd: string;
  readonly pty: TerminalPty;
  readonly clients: Set<TerminalSessionClient>;
  history: string[];
  historyBytes: number;
  idleTimer?: NodeJS.Timeout;
  exited: boolean;
  dataSubscription?: { dispose(): void };
  exitSubscription?: { dispose(): void };
}

function defaultPtySpawner(
  file: string,
  args: readonly string[],
  options: Parameters<TerminalPtySpawner>[2],
): IPty {
  return spawn(file, [...args], options);
}

function configuredShell(
  shell: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
): string {
  const candidate = shell?.trim() || env.WORKBENCH_TERMINAL_SHELL?.trim() || env.SHELL?.trim();
  if (candidate) return candidate;
  return platform === "win32" ? "powershell.exe" : "/bin/bash";
}

function validSessionId(sessionId: string): boolean {
  return /^[A-Za-z0-9._:-]{1,200}$/.test(sessionId);
}

function boundedDimension(value: number | undefined, fallback: number, min: number, max: number) {
  return Number.isInteger(value) ? Math.min(max, Math.max(min, Number(value))) : fallback;
}

function outputBytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

async function canonicalDirectory(candidate: string): Promise<string> {
  const path = await realpath(resolve(candidate));
  const info = await stat(path);
  if (!info.isDirectory()) throw new Error("Terminal working directory is not a directory.");
  return path;
}

export class TerminalSessionManager {
  readonly #spawnPty: TerminalPtySpawner;
  readonly #shell: string;
  readonly #environment: Readonly<Record<string, string | undefined>>;
  readonly #defaultCwd: string;
  readonly #maxHistoryBytes: number;
  readonly #idleTimeoutMs: number;
  readonly #maxSessions: number;
  readonly #sessions = new Map<string, ManagedTerminalSession>();
  readonly #pendingSessions = new Map<string, Promise<ManagedTerminalSession>>();

  constructor(options: TerminalSessionManagerOptions = {}) {
    this.#spawnPty = options.spawnPty ?? defaultPtySpawner;
    this.#environment = options.env ?? process.env;
    this.#shell = configuredShell(
      options.shell,
      this.#environment,
      options.platform ?? process.platform,
    );
    this.#defaultCwd = options.defaultCwd ?? process.cwd();
    this.#maxHistoryBytes = options.maxHistoryBytes ?? DEFAULT_HISTORY_BYTES;
    this.#idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.#maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
  }

  async attach(options: AttachTerminalSessionOptions): Promise<AttachedTerminalSession> {
    if (!validSessionId(options.sessionId)) {
      throw new TerminalSessionError("invalid-session", "Invalid terminal session id.");
    }

    let cwd: string;
    try {
      cwd = await canonicalDirectory(options.cwd?.trim() || this.#defaultCwd);
    } catch (error) {
      throw new TerminalSessionError(
        "cwd-unavailable",
        error instanceof Error ? error.message : "Terminal working directory is unavailable.",
      );
    }

    const existing = this.#sessions.get(options.sessionId);
    if (existing) return this.attachExisting(existing, cwd);

    let pending = this.#pendingSessions.get(options.sessionId);
    if (!pending) {
      pending = this.createSession({ ...options, cwd });
      this.#pendingSessions.set(options.sessionId, pending);
      void pending.finally(() => this.#pendingSessions.delete(options.sessionId)).catch(() => {});
    }

    return this.attachExisting(await pending, cwd);
  }

  dispose(): void {
    for (const session of this.#sessions.values()) this.destroySession(session, true);
    this.#sessions.clear();
  }

  private async createSession(
    options: AttachTerminalSessionOptions & { cwd: string },
  ): Promise<ManagedTerminalSession> {
    if (this.#sessions.size + this.#pendingSessions.size >= this.#maxSessions) {
      throw new TerminalSessionError("session-limit", "Terminal session limit reached.");
    }

    const cols = boundedDimension(options.cols, DEFAULT_COLS, 2, 500);
    const rows = boundedDimension(options.rows, DEFAULT_ROWS, 1, 300);
    const environment = {
      ...terminalEnvironment(this.#environment),
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      TERM_PROGRAM: "Pi Workbench",
    };
    const terminal = this.#spawnPty(this.#shell, [], {
      cwd: options.cwd,
      cols,
      rows,
      env: environment,
      name: "xterm-256color",
    });
    const session: ManagedTerminalSession = {
      id: options.sessionId,
      cwd: options.cwd,
      pty: terminal,
      clients: new Set<TerminalSessionClient>(),
      history: [],
      historyBytes: 0,
      exited: false,
    };

    session.dataSubscription = terminal.onData((data) => this.publishData(session, data));
    session.exitSubscription = terminal.onExit((event) => this.publishExit(session, event));
    this.#sessions.set(session.id, session);
    return session;
  }

  private attachExisting(session: ManagedTerminalSession, cwd: string): AttachedTerminalSession {
    if (session.cwd !== cwd) {
      throw new TerminalSessionError(
        "session-conflict",
        "Terminal session already belongs to another working directory.",
      );
    }
    if (session.exited) {
      throw new TerminalSessionError("invalid-session", "Terminal session has exited.");
    }

    return {
      sessionId: session.id,
      cwd: session.cwd,
      process: session.pty.process || basename(this.#shell),
      pid: session.pty.pid,
      subscribe: (client) => this.subscribe(session, client),
      write: (data) => {
        if (!session.exited) session.pty.write(data);
      },
      run: (command) => {
        if (session.exited) return;
        const lines = command
          .replaceAll("\r\n", "\n")
          .replaceAll("\n", "\r")
          .replaceAll(/[\r]+$/g, "");
        session.pty.write(`${lines}\r`);
      },
      resize: (cols, rows) => {
        if (!session.exited) {
          session.pty.resize(
            boundedDimension(cols, DEFAULT_COLS, 2, 500),
            boundedDimension(rows, DEFAULT_ROWS, 1, 300),
          );
        }
      },
      interrupt: () => {
        if (!session.exited) session.pty.write("\u0003");
      },
    };
  }

  private subscribe(
    session: ManagedTerminalSession,
    client: TerminalSessionClient,
  ): TerminalSessionSubscription {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = undefined;
    }
    session.clients.add(client);
    const history = session.history.join("");
    let attached = true;

    return {
      history,
      detach: () => {
        if (!attached) return;
        attached = false;
        session.clients.delete(client);
        if (session.clients.size === 0 && !session.exited) this.scheduleIdleDisposal(session);
      },
    };
  }

  private publishData(session: ManagedTerminalSession, data: string): void {
    if (session.exited || !data) return;
    session.history.push(data);
    session.historyBytes += outputBytes(data);
    while (session.historyBytes > this.#maxHistoryBytes && session.history.length > 0) {
      const removed = session.history.shift();
      if (removed) session.historyBytes -= outputBytes(removed);
    }
    for (const client of session.clients) client.onData(data);
  }

  private publishExit(session: ManagedTerminalSession, event: TerminalExitEvent): void {
    if (session.exited) return;
    session.exited = true;
    this.#sessions.delete(session.id);
    if (session.idleTimer) clearTimeout(session.idleTimer);
    for (const client of session.clients) client.onExit(event);
    session.clients.clear();
    session.dataSubscription?.dispose();
    session.exitSubscription?.dispose();
  }

  private scheduleIdleDisposal(session: ManagedTerminalSession): void {
    if (this.#idleTimeoutMs <= 0) {
      this.destroySession(session, true);
      return;
    }
    session.idleTimer = setTimeout(() => {
      if (session.clients.size === 0) this.destroySession(session, true);
    }, this.#idleTimeoutMs);
    session.idleTimer.unref?.();
  }

  private destroySession(session: ManagedTerminalSession, kill: boolean): void {
    if (session.exited) return;
    session.exited = true;
    this.#sessions.delete(session.id);
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.dataSubscription?.dispose();
    session.exitSubscription?.dispose();
    session.clients.clear();
    if (kill) {
      try {
        session.pty.kill();
      } catch {
        // The process may already have exited between the state check and the signal.
      }
    }
  }
}
