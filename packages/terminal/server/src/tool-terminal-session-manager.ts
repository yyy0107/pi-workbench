import { basename, win32 } from "node:path";

import { spawn, type IPty } from "node-pty";

import {
  MAX_AGENT_BASH_INPUT_CHARACTERS,
  type TerminalErrorCode,
  type TerminalProcessExit,
  type TerminalProcessSnapshot,
} from "@workbench/terminal-contracts";
import {
  TerminalSessionError,
  type AttachedTerminalSession,
  type TerminalExitEvent,
  type TerminalPty,
  type TerminalPtySpawner,
  type TerminalSessionClient,
  type TerminalSessionSubscription,
} from "./terminal-session-manager";
import { terminalEnvironment } from "./terminal-environment";
import {
  TerminalInteractionDetector,
  type TerminalInteractionDetectorOptions,
} from "./terminal-interaction-detector";
import { TerminalProcessBuffer } from "./terminal-process-buffer";
import { TerminalTranscriptProjector } from "./terminal-transcript-projector";

const DEFAULT_COLS = 100;
const DEFAULT_ROWS = 30;
const DEFAULT_HISTORY_BYTES = 1024 * 1024;
const DEFAULT_RETENTION_MS = 10 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = 128;
const MAX_TIMEOUT_MS = 2_147_483_647;
const MAX_TIMEOUT_SECONDS = MAX_TIMEOUT_MS / 1000;
const POSIX_SHELL_EXECUTABLES = new Set([
  "ash",
  "bash",
  "dash",
  "fish",
  "ksh",
  "mksh",
  "sh",
  "yash",
  "zsh",
]);

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
  initialInput?: string;
}

export interface SpawnedToolTerminalProcess {
  readonly processHandle: string;
  readonly pid: number;
  readonly completion: Promise<{ exitCode: number | null }>;
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
  interactionDetectorOptions?: Omit<TerminalInteractionDetectorOptions, "onStateChange">;
}

type StopReason = "aborted" | "timeout" | "terminated";

interface ManagedToolTerminalSession {
  readonly key: string;
  readonly sessionId: string;
  readonly toolCallId: string;
  readonly command: string;
  readonly cwd: string;
  readonly shell: string;
  readonly pty: TerminalPty;
  readonly processHandle: string;
  readonly startedAt: number;
  readonly output: TerminalProcessBuffer;
  readonly transcriptProjector: TerminalTranscriptProjector;
  readonly onTranscriptData: ToolTerminalExecutionOptions["onData"];
  readonly interactionDetector: TerminalInteractionDetector;
  readonly clients: Set<TerminalSessionClient>;
  readonly completion: Promise<{ exitCode: number | null }>;
  resolve(result: { exitCode: number | null }): void;
  reject(error: Error): void;
  stopReason?: StopReason;
  timeoutSeconds?: number;
  exitEvent?: TerminalProcessExit;
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
  const candidate =
    shell?.trim() ||
    env.PI_WORKBENCH_TERMINAL_SHELL?.trim() ||
    env.WORKBENCH_TERMINAL_SHELL?.trim() ||
    env.SHELL?.trim();
  if (candidate) return candidate;
  return platform === "win32" ? "powershell.exe" : "/bin/bash";
}

function shellExecutableName(shell: string, platform: NodeJS.Platform): string {
  const name = platform === "win32" ? win32.basename(shell) : basename(shell);
  return name.toLowerCase().replace(/\.exe$/, "");
}

function shellArguments(shell: string, platform: NodeJS.Platform, command: string): string[] {
  const executable = shellExecutableName(shell, platform);
  if (executable === "powershell" || executable === "pwsh") {
    return ["-NoLogo", "-NoProfile", "-Command", command];
  }
  if (executable === "cmd") return ["/d", "/s", "/c", command];
  if (executable === "wsl") return ["--exec", "bash", "-lc", command];
  if (POSIX_SHELL_EXECUTABLES.has(executable)) return ["-lc", command];

  return platform === "win32" ? ["-NoLogo", "-NoProfile", "-Command", command] : ["-lc", command];
}

function resolveTimeoutMs(timeout: number | undefined): number | undefined {
  if (timeout === undefined) return undefined;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error("Invalid timeout: must be a finite number of seconds");
  }
  const timeoutMs = timeout * 1000;
  if (timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`Invalid timeout: maximum is ${MAX_TIMEOUT_SECONDS} seconds`);
  }
  return timeoutMs;
}

function boundedDimension(value: number | undefined, fallback: number, min: number, max: number) {
  return Number.isInteger(value) ? Math.min(max, Math.max(min, Number(value))) : fallback;
}

function sessionKey(sessionId: string, toolCallId: string): string {
  return `${sessionId}\u0000${toolCallId}`;
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
  readonly #interactionDetectorOptions?: Omit<TerminalInteractionDetectorOptions, "onStateChange">;
  readonly #sessions = new Map<string, ManagedToolTerminalSession>();
  #closed = false;

  constructor(options: ToolTerminalSessionManagerOptions = {}) {
    this.#spawnPty = options.spawnPty ?? defaultPtySpawner;
    this.#environment = options.env ?? process.env;
    this.#platform = options.platform ?? process.platform;
    this.#terminatePty = options.terminatePty ?? defaultPtyTerminator(this.#platform);
    this.#shell = configuredShell(options.shell, this.#environment, this.#platform);
    this.#maxHistoryBytes = options.maxHistoryBytes ?? DEFAULT_HISTORY_BYTES;
    this.#retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
    this.#maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.#interactionDetectorOptions = options.interactionDetectorOptions;
  }

  execute(options: ToolTerminalExecutionOptions): Promise<{ exitCode: number | null }> {
    return this.spawn(options).completion;
  }

  spawn(options: ToolTerminalExecutionOptions): SpawnedToolTerminalProcess {
    this.#assertOpen();
    const timeoutMs = resolveTimeoutMs(options.timeout);
    if (options.signal?.aborted) throw new Error("aborted");
    if (
      options.initialInput !== undefined &&
      options.initialInput.length > MAX_AGENT_BASH_INPUT_CHARACTERS
    ) {
      throw terminalError("invalid-message", "Initial tool input exceeds the allowed size.");
    }
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
      ...terminalEnvironment({ ...this.#environment, ...options.env }),
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      TERM_PROGRAM: "Pi Workbench",
    };
    const shell = options.shell?.trim() || this.#shell;
    this.#assertOpen();
    const terminal = this.#spawnPty(shell, shellArguments(shell, this.#platform, options.command), {
      cwd: options.cwd,
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      env: environment,
      name: "xterm-256color",
    });
    if (this.#closed) {
      try {
        this.#terminatePty(terminal);
      } catch {
        // The manager is already closed; rejecting admission remains authoritative.
      }
      this.#assertOpen();
    }
    let resolve!: (result: { exitCode: number | null }) => void;
    let reject!: (error: Error) => void;
    const completion = new Promise<{ exitCode: number | null }>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const processHandle = `tool:${options.sessionId}:${options.toolCallId}`;
    let session!: ManagedToolTerminalSession;
    const interactionDetector = new TerminalInteractionDetector({
      ...this.#interactionDetectorOptions,
      onStateChange: () => this.#publishInteractionState(session),
    });
    session = {
      key,
      sessionId: options.sessionId,
      toolCallId: options.toolCallId,
      command: options.command,
      cwd: options.cwd,
      shell,
      pty: terminal,
      processHandle,
      startedAt: Date.now(),
      output: new TerminalProcessBuffer(processHandle, this.#maxHistoryBytes),
      transcriptProjector: new TerminalTranscriptProjector(),
      onTranscriptData: options.onData,
      interactionDetector,
      clients: new Set(),
      completion,
      resolve,
      reject,
    };
    session.output.append(`$ ${options.command.replace(/\r?\n/g, "\r\n")}\r\n`);
    this.#sessions.set(key, session);

    session.dataSubscription = terminal.onData((data) => {
      if (session.exitEvent || !data) return;
      session.interactionDetector.feed(data);
      const delta = session.output.append(data);
      const transcript = session.transcriptProjector.feed(data);
      if (transcript) session.onTranscriptData(Buffer.from(transcript, "utf8"));
      if (delta) {
        for (const client of session.clients) client.onOutput(delta);
      }
    });
    session.exitSubscription = terminal.onExit((event) => this.#finish(session, event));

    if (options.signal) {
      const onAbort = () => this.#stop(session, "aborted");
      options.signal.addEventListener("abort", onAbort, { once: true });
      session.removeAbortListener = () => options.signal?.removeEventListener("abort", onAbort);
    }
    if (timeoutMs !== undefined) {
      session.timeoutSeconds = options.timeout;
      session.timeoutHandle = setTimeout(() => this.#stop(session, "timeout"), timeoutMs);
      session.timeoutHandle.unref?.();
    }
    if (options.initialInput) terminal.write(options.initialInput);

    return { processHandle, pid: terminal.pid, completion };
  }

  async attach(options: AttachToolTerminalOptions): Promise<AttachedTerminalSession> {
    this.#assertOpen();
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
    if (this.#closed) return;
    this.#closed = true;
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

  #assertOpen(): void {
    if (this.#closed) {
      throw terminalError("invalid-session", "Tool terminal session manager is disposed.");
    }
  }

  #attached(session: ManagedToolTerminalSession): AttachedTerminalSession {
    return {
      processHandle: session.processHandle,
      snapshot: () => this.#snapshot(session),
      subscribe: (client) => this.#subscribe(session, client),
      writeStdin: (data) => {
        if (!session.exitEvent) {
          session.interactionDetector.recordInput();
          session.pty.write(data);
        }
      },
      run: () => {
        throw terminalError("invalid-message", "A tool terminal cannot run another command.");
      },
      resizePty: (cols, rows) => {
        if (!session.exitEvent) {
          session.pty.resize(
            boundedDimension(cols, DEFAULT_COLS, 2, 500),
            boundedDimension(rows, DEFAULT_ROWS, 1, 300),
          );
        }
      },
      interrupt: () => {
        if (!session.exitEvent) session.pty.write("\u0003");
      },
      terminate: () => this.#stop(session, "terminated"),
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
    if (!session.exitEvent) {
      session.clients.add(client);
      this.#publishState(session);
    } else queueMicrotask(() => client.onExit(session.exitEvent!));
    let attached = true;
    return {
      replay: session.output.replay(),
      detach: () => {
        if (!attached) return;
        attached = false;
        session.clients.delete(client);
        this.#publishState(session);
        if (session.exitEvent && session.clients.size === 0) this.#scheduleRetention(session);
      },
    };
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
    const finalTranscript = session.transcriptProjector.flush();
    if (finalTranscript) session.onTranscriptData(Buffer.from(finalTranscript, "utf8"));
    session.exitEvent = {
      processHandle: session.processHandle,
      processState: session.stopReason ? "killed" : "exited",
      reason: session.stopReason ?? "exited",
      exitCode: event.exitCode,
      ...(event.signal === undefined ? {} : { signal: event.signal }),
      outputBytes: session.output.outputBytes,
      outputCapReached: session.output.outputCapReached,
    };
    session.interactionDetector.finish();
    session.dataSubscription?.dispose();
    session.exitSubscription?.dispose();
    session.removeAbortListener?.();
    if (session.timeoutHandle) clearTimeout(session.timeoutHandle);
    for (const client of session.clients) client.onExit(session.exitEvent);
    session.clients.clear();
    if (session.stopReason === "aborted" || session.stopReason === "terminated") {
      session.reject(new Error("aborted"));
    } else if (session.stopReason === "timeout") {
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
    session.interactionDetector.dispose();
    session.transcriptProjector.reset();
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

  #snapshot(session: ManagedToolTerminalSession): TerminalProcessSnapshot {
    return {
      processHandle: session.processHandle,
      sessionId: session.sessionId,
      kind: "tool",
      cwd: session.cwd,
      process: session.pty.process || basename(session.shell),
      pid: session.pty.pid,
      tty: true,
      processState: session.exitEvent?.processState ?? "running",
      interactionState: session.interactionDetector.state,
      attachmentState: session.clients.size > 0 ? "attached" : "detached",
      startedAt: session.startedAt,
      outputBytes: session.output.outputBytes,
      outputBytesCap: session.output.outputBytesCap,
      outputCapReached: session.output.outputCapReached,
    };
  }

  #publishState(session: ManagedToolTerminalSession): void {
    const snapshot = this.#snapshot(session);
    for (const client of session.clients) client.onStateChange?.(snapshot);
  }

  #publishInteractionState(session: ManagedToolTerminalSession): void {
    this.#publishState(session);
  }
}

const terminalGlobal = globalThis as typeof globalThis & {
  __workbenchToolTerminalSessions?: ToolTerminalSessionManager;
};

export function getToolTerminalSessionManager(): ToolTerminalSessionManager {
  terminalGlobal.__workbenchToolTerminalSessions ??= new ToolTerminalSessionManager();
  return terminalGlobal.__workbenchToolTerminalSessions;
}
