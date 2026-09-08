"use client";

import {
  DEFAULT_BROWSER_SETTINGS,
  type BrowserCommand,
  type BrowserCursor,
  type BrowserDevice,
  type BrowserEvent,
  type BrowserSettings,
} from "@workbench/browser-contracts";

export interface BrowserAnnotation {
  selector?: string;
  screenshotRegion?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  text: string;
}

export interface BrowserSession {
  id: string;
  projectId: string;
  url: string;
  title: string;
  status: "loading" | "ready" | "error" | "disconnected" | "permission-required";
  canGoBack: boolean;
  canGoForward: boolean;
  revision: number;
  zoom?: number;
  width?: number;
  height?: number;
  device?: BrowserDevice;
  error?: string;
  agentControlled?: boolean;
  agentCursor?: BrowserCursor;
  userControlled?: boolean;
  userCursor?: BrowserCursor;
}

export interface BrowserScreenshot {
  sessionId: string;
  capturedAt: number;
  dataUrl?: string;
}

export interface BrowserSessionService {
  create(context: { projectId: string; url?: string }): Promise<BrowserSession>;
  attach(session: Omit<BrowserSession, "revision"> & { revision?: number }): BrowserSession;
  navigate(sessionId: string, url: string): Promise<void>;
  goBack(sessionId: string): Promise<void>;
  goForward(sessionId: string): Promise<void>;
  reload(sessionId: string): Promise<void>;
  captureScreenshot(sessionId: string): Promise<BrowserScreenshot>;
  annotate(sessionId: string, annotation: BrowserAnnotation): Promise<void>;
  getSession(sessionId: string): BrowserSession | undefined;
  subscribe(listener: () => void): () => void;
  getRevision(): number;
  dispose(): void;
  getSettings(): BrowserSettings;
  loadSettings(): Promise<void>;
  updateSettings(patch: Partial<BrowserSettings>): Promise<void>;
  command<T = unknown>(command: BrowserCommand, source?: "agent"): Promise<T>;
  subscribeEvents(listener: (event: BrowserEvent) => void): () => void;
}

function createSessionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `browser-${Date.now()}-${Math.random()}`;
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "about:blank") return "about:blank";
  const hostWithPort = /^(?:localhost|[^/:?#]+\.[^/:?#]+|\[[\da-f:]+\]):\d+(?:[/?#]|$)/i.test(
    trimmed,
  );
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed) && !hostWithPort;
  const url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
  if (url.protocol === "file:" && !url.hostname) return url.href;
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Browser addresses must use HTTP or HTTPS without credentials.");
  }
  if (
    !hasScheme &&
    (url.hostname === "localhost" ||
      url.hostname.endsWith(".localhost") ||
      /^127(?:\.\d{1,3}){3}$/.test(url.hostname) ||
      url.hostname === "[::1]")
  ) {
    return new URL(`http://${trimmed}`).href;
  }
  return url.href;
}

export class MemoryBrowserSessionService implements BrowserSessionService {
  readonly #sessions = new Map<string, BrowserSession>();
  // ponytail: address-bar history only; tracking cross-origin page navigation needs a browser host.
  readonly #history = new Map<string, { entries: string[]; index: number }>();
  readonly #annotations = new Map<string, BrowserAnnotation[]>();
  readonly #listeners = new Set<() => void>();
  #revision = 0;
  #disposed = false;
  protected settings: BrowserSettings = structuredClone(DEFAULT_BROWSER_SETTINGS);

  getSettings(): BrowserSettings {
    return this.settings;
  }
  async loadSettings(): Promise<void> {}
  async updateSettings(patch: Partial<BrowserSettings>): Promise<void> {
    this.settings = { ...this.settings, ...patch };
    this.publish();
  }
  async command<T = unknown>(_command: BrowserCommand): Promise<T> {
    throw new Error("A live browser connection is required.");
  }
  subscribeEvents(_listener: (event: BrowserEvent) => void): () => void {
    return () => {};
  }

  protected updateSession(session: BrowserSession, notify = true): void {
    this.#sessions.set(session.id, session);
    if (notify) this.publish();
  }

  protected removeSession(sessionId: string): void {
    this.#sessions.delete(sessionId);
    this.#history.delete(sessionId);
    this.#annotations.delete(sessionId);
    this.publish();
  }

  async create(context: { projectId: string; url?: string }): Promise<BrowserSession> {
    this.assertActive();
    const id = createSessionId();
    const url = normalizeUrl(context.url ?? "about:blank");
    const session: BrowserSession = {
      id,
      projectId: context.projectId,
      url,
      title: url,
      status: "ready",
      canGoBack: false,
      canGoForward: false,
      revision: 0,
    };
    this.#sessions.set(id, session);
    this.#history.set(id, { entries: [url], index: 0 });
    this.publish();
    return { ...session };
  }

  attach(session: Omit<BrowserSession, "revision"> & { revision?: number }): BrowserSession {
    this.assertActive();
    const attached = {
      ...session,
      url: normalizeUrl(session.url),
      revision: session.revision ?? 0,
    };
    this.#sessions.set(attached.id, attached);
    this.#history.set(attached.id, { entries: [attached.url], index: 0 });
    this.publish();
    return { ...attached };
  }

  async navigate(sessionId: string, url: string): Promise<void> {
    const session = this.requireSession(sessionId);
    const history = this.#history.get(sessionId) ?? { entries: [], index: -1 };
    const normalized = normalizeUrl(url);
    history.entries = [...history.entries.slice(0, history.index + 1), normalized];
    history.index = history.entries.length - 1;
    this.#history.set(sessionId, history);
    this.replace(sessionId, {
      ...session,
      url: normalized,
      title: normalized,
      canGoBack: history.index > 0,
      canGoForward: false,
    });
  }

  async goBack(sessionId: string): Promise<void> {
    this.moveHistory(sessionId, -1);
  }

  async goForward(sessionId: string): Promise<void> {
    this.moveHistory(sessionId, 1);
  }

  async reload(sessionId: string): Promise<void> {
    const session = this.requireSession(sessionId);
    this.replace(sessionId, { ...session, status: "ready" });
  }

  async captureScreenshot(sessionId: string): Promise<BrowserScreenshot> {
    this.requireSession(sessionId);
    return { sessionId, capturedAt: Date.now() };
  }

  async annotate(sessionId: string, annotation: BrowserAnnotation): Promise<void> {
    this.requireSession(sessionId);
    const current = this.#annotations.get(sessionId) ?? [];
    this.#annotations.set(sessionId, [...current, annotation]);
    this.publish();
  }

  getSession(sessionId: string): BrowserSession | undefined {
    if (this.#disposed) return undefined;
    return this.#sessions.get(sessionId);
  }

  subscribe(listener: () => void): () => void {
    if (this.#disposed) return () => {};
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  getRevision(): number {
    return this.#revision;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#sessions.clear();
    this.#history.clear();
    this.#annotations.clear();
    this.#listeners.clear();
  }

  private assertActive(): void {
    if (this.#disposed) throw new Error("The browser session service has been disposed.");
  }

  private moveHistory(sessionId: string, delta: number): void {
    const session = this.requireSession(sessionId);
    const history = this.#history.get(sessionId);
    if (!history) return;
    const index = Math.max(0, Math.min(history.entries.length - 1, history.index + delta));
    if (index === history.index) return;
    history.index = index;
    const url = history.entries[index] ?? session.url;
    this.replace(sessionId, {
      ...session,
      url,
      title: url,
      canGoBack: index > 0,
      canGoForward: index < history.entries.length - 1,
    });
  }

  private requireSession(sessionId: string): BrowserSession {
    this.assertActive();
    const session = this.#sessions.get(sessionId);
    if (!session) throw new Error(`Unknown browser session: ${sessionId}`);
    return session;
  }

  private replace(sessionId: string, session: BrowserSession): void {
    this.#sessions.set(sessionId, { ...session, revision: session.revision + 1 });
    this.publish();
  }

  protected publish(): void {
    if (this.#disposed) return;
    this.#revision += 1;
    for (const listener of this.#listeners) listener();
  }
}
