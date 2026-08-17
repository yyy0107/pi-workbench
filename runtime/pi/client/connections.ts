import type { PiEvent } from "../contracts";
import { piRunningEventsUrl, piSessionEventsUrl } from "./api";

const IDLE_CLOSE_DELAY_MS = 30_000;
const CONNECT_WAIT_MS = 10_000;

interface SessionConnection {
  source: EventSource;
  listener: (event: PiEvent) => void;
  ready: Promise<void>;
  resolveReady: () => void;
  closeTimer?: ReturnType<typeof setTimeout>;
}

export class PiConnectionController {
  private readonly sessions = new Map<string, SessionConnection>();
  private runningSource?: EventSource;

  startRunningEvents(listener: (sessionIds: string[]) => void): void {
    if (this.runningSource || typeof EventSource === "undefined") return;

    const source = new EventSource(piRunningEventsUrl());
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as {
          type?: unknown;
          runningSessionIds?: unknown;
        };
        if (payload.type !== "running" || !Array.isArray(payload.runningSessionIds)) return;
        listener(payload.runningSessionIds.filter((id): id is string => typeof id === "string"));
      } catch {
        // Ignore malformed transport frames; EventSource will continue receiving.
      }
    };
    this.runningSource = source;
  }

  async ensureSessionEvents(sessionId: string, listener: (event: PiEvent) => void): Promise<void> {
    const current = this.sessions.get(sessionId);
    if (current) {
      current.listener = listener;
      if (current.closeTimer) {
        clearTimeout(current.closeTimer);
        current.closeTimer = undefined;
      }
      await this.waitUntilConnected(current.ready);
      return;
    }

    let resolveReady = () => {};
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const source = new EventSource(piSessionEventsUrl(sessionId));
    const connection: SessionConnection = { source, listener, ready, resolveReady };
    this.sessions.set(sessionId, connection);

    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as PiEvent;
        connection.listener(payload);
        if (payload.type === "connected") connection.resolveReady();
      } catch {
        // Ignore malformed transport frames; the session snapshot stays authoritative.
      }
    };

    await this.waitUntilConnected(ready);
  }

  scheduleSessionClose(sessionId: string): void {
    const connection = this.sessions.get(sessionId);
    if (!connection || connection.closeTimer) return;
    connection.closeTimer = setTimeout(() => this.closeSession(sessionId), IDLE_CLOSE_DELAY_MS);
  }

  closeSession(sessionId: string): void {
    const connection = this.sessions.get(sessionId);
    if (!connection) return;
    if (connection.closeTimer) clearTimeout(connection.closeTimer);
    connection.source.close();
    connection.resolveReady();
    this.sessions.delete(sessionId);
  }

  dispose(): void {
    this.runningSource?.close();
    this.runningSource = undefined;
    for (const sessionId of this.sessions.keys()) this.closeSession(sessionId);
  }

  private async waitUntilConnected(ready: Promise<void>): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      ready,
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, CONNECT_WAIT_MS);
      }),
    ]);
    if (timeout) clearTimeout(timeout);
  }
}
