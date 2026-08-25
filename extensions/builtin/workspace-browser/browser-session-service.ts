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
  status: "loading" | "ready" | "disconnected" | "permission-required";
  canGoBack: boolean;
  canGoForward: boolean;
  revision: number;
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
}

function createSessionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `browser-${Date.now()}-${Math.random()}`;
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "about:blank";
  if (/^(?:https?:\/\/|about:)/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export class MemoryBrowserSessionService implements BrowserSessionService {
  readonly #sessions = new Map<string, BrowserSession>();
  readonly #history = new Map<string, { entries: string[]; index: number }>();
  readonly #annotations = new Map<string, BrowserAnnotation[]>();
  readonly #listeners = new Set<() => void>();
  #revision = 0;

  async create(context: { projectId: string; url?: string }): Promise<BrowserSession> {
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
    const attached = { ...session, revision: session.revision ?? 0 };
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
    return this.#sessions.get(sessionId);
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  getRevision(): number {
    return this.#revision;
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
    const session = this.#sessions.get(sessionId);
    if (!session) throw new Error(`Unknown browser session: ${sessionId}`);
    return session;
  }

  private replace(sessionId: string, session: BrowserSession): void {
    this.#sessions.set(sessionId, { ...session, revision: session.revision + 1 });
    this.publish();
  }

  private publish(): void {
    this.#revision += 1;
    for (const listener of this.#listeners) listener();
  }
}

export const browserSessionService = new MemoryBrowserSessionService();
