"use client";

import { createRuntimeWebSocketFactory, type RuntimeWebSocket } from "@workbench/host-client";
import type { RuntimeConnection } from "@workbench/host-contracts";
import {
  BROWSER_WEBSOCKET_PATH,
  DEFAULT_BROWSER_SETTINGS,
  parseBrowserSettingsPatch,
  type BrowserCommand,
  type BrowserCursor,
  type BrowserEvent,
  type BrowserFile,
  type BrowserServerFrame,
  type BrowserSessionState,
  type BrowserSettings,
} from "@workbench/browser-contracts";
import {
  MemoryBrowserSessionService,
  type BrowserSession,
  type BrowserScreenshot,
} from "./memory-browser-session-service";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === "string";
}
function number(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function validCursor(value: unknown): value is BrowserCursor {
  return (
    record(value) &&
    number(value.x) &&
    number(value.y) &&
    (value.pressed === undefined || typeof value.pressed === "boolean")
  );
}
function validSettings(value: unknown): value is BrowserSettings {
  const permissions = record(value) ? value.permissions : undefined;
  return (
    record(value) &&
    Object.keys(DEFAULT_BROWSER_SETTINGS).every((key) => key in value) &&
    record(permissions) &&
    Object.keys(DEFAULT_BROWSER_SETTINGS.permissions).every((key) => key in permissions) &&
    parseBrowserSettingsPatch(value) !== undefined
  );
}
function validSession(value: unknown): value is BrowserSessionState {
  return (
    record(value) &&
    ["id", "projectId", "url", "title"].every((key) => text(value[key])) &&
    ["revision", "zoom", "width", "height"].every((key) => number(value[key])) &&
    ["canGoBack", "canGoForward"].every((key) => typeof value[key] === "boolean") &&
    ["loading", "ready", "error", "disconnected", "permission-required"].includes(
      String(value.status),
    ) &&
    (value.error === undefined || text(value.error)) &&
    (value.agentControlled === undefined || typeof value.agentControlled === "boolean") &&
    (value.agentCursor === undefined || validCursor(value.agentCursor)) &&
    (value.userControlled === undefined || typeof value.userControlled === "boolean") &&
    (value.userCursor === undefined || validCursor(value.userCursor)) &&
    (value.device === undefined ||
      (record(value.device) &&
        number(value.device.width) &&
        number(value.device.height) &&
        typeof value.device.mobile === "boolean"))
  );
}
function validFile(value: unknown): value is BrowserFile {
  return record(value) && text(value.name) && text(value.mimeType) && text(value.data);
}
function serverFrame(value: unknown): BrowserServerFrame | undefined {
  if (!record(value)) return undefined;
  let valid = false;
  switch (value.type) {
    case "result":
      valid = text(value.id) && !!value.id;
      break;
    case "error":
      valid =
        text(value.code) &&
        (value.id === undefined || text(value.id)) &&
        (value.sessionId === undefined || text(value.sessionId));
      break;
    case "state":
      valid = validSession(value.session);
      break;
    case "popup":
      valid = validSession(value.session) && text(value.openerSessionId) && !!value.openerSessionId;
      break;
    case "settings":
      valid = validSettings(value.settings);
      break;
    case "frame":
      valid =
        text(value.sessionId) &&
        text(value.data) &&
        number(value.width) &&
        number(value.height) &&
        (value.mimeType === undefined ||
          value.mimeType === "image/jpeg" ||
          value.mimeType === "image/png");
      break;
    case "cursor":
      valid = text(value.sessionId) && (value.cursor === null || validCursor(value.cursor));
      break;
    case "permission":
      valid =
        text(value.requestId) &&
        text(value.sessionId) &&
        text(value.origin) &&
        ["history", "download", "upload"].includes(String(value.action));
      break;
    case "file-chooser":
      valid = text(value.sessionId) && text(value.requestId) && typeof value.multiple === "boolean";
      break;
    case "dialog":
      valid =
        text(value.sessionId) &&
        text(value.kind) &&
        text(value.message) &&
        (value.defaultPrompt === undefined || text(value.defaultPrompt)) &&
        (value.url === undefined || text(value.url));
      break;
    case "download":
      valid =
        record(value.download) &&
        text(value.download.id) &&
        text(value.download.name) &&
        text(value.download.url) &&
        ["inProgress", "completed", "canceled"].includes(String(value.download.state)) &&
        number(value.download.receivedBytes) &&
        number(value.download.totalBytes);
      break;
    case "file":
      valid = validFile(value.file);
      break;
  }
  return valid ? (value as unknown as BrowserServerFrame) : undefined;
}

export class BrowserConnectionError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

/** One authenticated stream per Workbench installation, shared by all browser tabs and settings. */
export class RemoteBrowserSessionService extends MemoryBrowserSessionService {
  readonly #createSocket: (path: string) => RuntimeWebSocket;
  readonly #events = new Set<(event: BrowserEvent) => void>();
  readonly #pending = new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
      commandType: BrowserCommand["type"];
    }
  >();
  readonly #sessionIds = new Set<string>();
  readonly #attaching = new Map<
    string,
    { projectId: string; promise: Promise<BrowserSessionState> }
  >();
  #socket?: RuntimeWebSocket;
  #connecting?: Promise<void>;
  #disconnect?: (code: string) => void;
  #disposed = false;

  constructor(
    connection: RuntimeConnection,
    createSocket = createRuntimeWebSocketFactory(connection),
  ) {
    super();
    this.#createSocket = createSocket;
  }

  async #connect(): Promise<void> {
    if (this.#disposed) throw new BrowserConnectionError("disconnected");
    if (this.#socket?.readyState === 1) return;
    if (this.#connecting) return this.#connecting;
    const socket = this.#createSocket(BROWSER_WEBSOCKET_PATH);
    this.#socket = socket;
    this.#connecting = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => disconnect("connection_timeout"), 15000);
      const disconnect = (code: string) => {
        if (this.#socket !== socket) return;
        clearTimeout(timeout);
        this.#socket = undefined;
        this.#connecting = undefined;
        this.#disconnect = undefined;
        socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
        try {
          socket.close();
        } catch {
          /* The transport may already be closed. */
        }
        const error = new BrowserConnectionError(code);
        reject(error);
        for (const pending of this.#pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(error);
        }
        this.#pending.clear();
        for (const id of this.#sessionIds) {
          const session = this.getSession(id);
          if (session)
            this.updateSession({
              ...session,
              status: "disconnected",
              agentControlled: false,
              agentCursor: undefined,
            });
        }
      };
      this.#disconnect = disconnect;
      socket.onopen = () => {
        if (this.#socket !== socket) return;
        clearTimeout(timeout);
        this.#connecting = undefined;
        resolve();
      };
      socket.onmessage = (event) => {
        if (this.#socket !== socket || this.#disposed) return;
        if (typeof event.data !== "string") return;
        let frame: BrowserServerFrame | undefined;
        try {
          frame = serverFrame(JSON.parse(event.data));
        } catch {
          return;
        }
        if (!frame) return;
        if ("id" in frame && (frame.type === "result" || frame.type === "error")) {
          const pending = this.#pending.get(frame.id);
          if (!pending) return;
          this.#pending.delete(frame.id);
          clearTimeout(pending.timer);
          if (frame.type === "error") pending.reject(new BrowserConnectionError(frame.code));
          else if (
            (pending.commandType === "attach" && !validSession(frame.result)) ||
            (["settings.get", "settings.update"].includes(pending.commandType) &&
              !validSettings(frame.result)) ||
            (["screenshot", "print", "download.read"].includes(pending.commandType) &&
              !validFile(frame.result))
          )
            pending.reject(new BrowserConnectionError("browser-invalid"));
          else pending.resolve(frame.result);
          return;
        }
        if (frame.type === "state" || frame.type === "popup") {
          this.#sessionIds.add(frame.session.id);
          this.updateSession(frame.session);
        }
        if (frame.type === "settings") {
          this.settings = frame.settings;
          this.publish();
        }
        if (frame.type === "cursor") {
          const session = this.getSession(frame.sessionId);
          if (session?.agentControlled) {
            // Cursor frames repaint the viewport without invalidating the whole browser UI.
            this.updateSession({ ...session, agentCursor: frame.cursor ?? undefined }, false);
          }
        }
        for (const listener of this.#events) listener(frame as BrowserEvent);
      };
      socket.onerror = () => disconnect("connection_failed");
      socket.onclose = () => disconnect("disconnected");
    });
    return this.#connecting;
  }

  override async command<T = unknown>(command: BrowserCommand, source?: "agent"): Promise<T> {
    if (command.type === "attach") {
      const pending = this.#attaching.get(command.sessionId);
      if (pending && pending.projectId !== command.projectId)
        throw new BrowserConnectionError("browser-invalid");
      if (pending) return pending.promise as Promise<T>;
      const promise = this.#request<BrowserSessionState>(command, source).then((state) => {
        if (state.id !== command.sessionId || state.projectId !== command.projectId)
          throw new BrowserConnectionError("browser-invalid");
        if (!this.#disposed) {
          this.#sessionIds.add(state.id);
          const current = this.getSession(state.id);
          // Stream updates can release control before an earlier attach reply arrives.
          if (!current || current.status === "disconnected" || current.revision <= state.revision)
            this.updateSession(state);
        }
        return state;
      });
      this.#attaching.set(command.sessionId, { projectId: command.projectId, promise });
      void promise
        .finally(() => {
          if (this.#attaching.get(command.sessionId)?.promise === promise)
            this.#attaching.delete(command.sessionId);
        })
        .catch(() => {});
      return promise as Promise<T>;
    }
    if ("sessionId" in command) await this.#attaching.get(command.sessionId)?.promise;
    const result = await this.#request<T>(command, source);
    if (command.type === "close") {
      this.#sessionIds.delete(command.sessionId);
      this.removeSession(command.sessionId);
    }
    return result;
  }

  async #request<T>(command: BrowserCommand, source?: "agent"): Promise<T> {
    await this.#connect();
    const socket = this.#socket;
    if (this.#disposed || socket?.readyState !== 1)
      throw new BrowserConnectionError("disconnected");
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new BrowserConnectionError("request_timeout"));
      }, 120000);
      this.#pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
        commandType: command.type,
      });
      try {
        socket.send(JSON.stringify({ id, command, ...(source ? { source } : {}) }));
      } catch {
        this.#disconnect?.("disconnected");
      }
    });
  }

  override async create(context: { projectId: string; url?: string }): Promise<BrowserSession> {
    const sessionId = crypto.randomUUID();
    const session = await this.command<BrowserSessionState>({
      type: "attach",
      sessionId,
      ...context,
    });
    return session;
  }

  override attach(
    session: Omit<BrowserSession, "revision"> & { revision?: number },
  ): BrowserSession {
    const current = super.attach(session);
    this.#sessionIds.add(session.id);
    void this.command<BrowserSessionState>(
      { type: "attach", sessionId: session.id, projectId: session.projectId, url: session.url },
      "agent",
    ).catch(
      (error: unknown) =>
        !this.#disposed &&
        this.updateSession({
          ...(this.getSession(session.id) ?? current),
          status: "error",
          error: error instanceof BrowserConnectionError ? error.code : "browser_failed",
        }),
    );
    return current;
  }

  override async navigate(sessionId: string, url: string): Promise<void> {
    await this.command({ type: "navigate", sessionId, url });
  }
  override async goBack(sessionId: string): Promise<void> {
    await this.command({ type: "back", sessionId });
  }
  override async goForward(sessionId: string): Promise<void> {
    await this.command({ type: "forward", sessionId });
  }
  override async reload(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId);
    if (session?.status === "disconnected" || session?.status === "error") {
      await this.command({
        type: "attach",
        sessionId,
        projectId: session.projectId,
        url: session.url,
      });
    }
    await this.command({ type: "reload", sessionId });
  }
  override async captureScreenshot(sessionId: string): Promise<BrowserScreenshot> {
    const file = await this.command<BrowserFile>({ type: "screenshot", sessionId });
    return {
      sessionId,
      capturedAt: Date.now(),
      dataUrl: `data:${file.mimeType};base64,${file.data}`,
    };
  }
  override async loadSettings(): Promise<void> {
    this.settings = await this.command<BrowserSettings>({ type: "settings.get" });
    this.publish();
    if (!this.#disposed)
      for (const listener of this.#events) listener({ type: "settings", settings: this.settings });
  }
  override async updateSettings(patch: Partial<BrowserSettings>): Promise<void> {
    this.settings = await this.command<BrowserSettings>({ type: "settings.update", patch });
    this.publish();
  }
  override subscribeEvents(listener: (event: BrowserEvent) => void): () => void {
    this.#events.add(listener);
    return () => this.#events.delete(listener);
  }
  override dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#disconnect?.("disconnected");
    this.#attaching.clear();
    this.#events.clear();
    super.dispose();
  }
}
