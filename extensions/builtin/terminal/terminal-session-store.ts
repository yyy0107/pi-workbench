export interface TerminalLine {
  id: string;
  kind: "command" | "output" | "muted";
  text: string;
}

const EMPTY_LINES: readonly TerminalLine[] = Object.freeze([]);

class TerminalSessionStore {
  readonly #lines = new Map<string, readonly TerminalLine[]>();
  readonly #listeners = new Set<() => void>();
  #nextLineId = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getLines = (sessionId: string): readonly TerminalLine[] => {
    return this.#lines.get(sessionId) ?? EMPTY_LINES;
  };

  ensure(sessionId: string, initial: readonly Omit<TerminalLine, "id">[]): void {
    if (this.#lines.has(sessionId)) return;
    this.#lines.set(
      sessionId,
      initial.map((line) => ({ ...line, id: this.createId() })),
    );
    this.publish();
  }

  append(sessionId: string, lines: readonly Omit<TerminalLine, "id">[]): void {
    this.#lines.set(sessionId, [
      ...this.getLines(sessionId),
      ...lines.map((line) => ({ ...line, id: this.createId() })),
    ]);
    this.publish();
  }

  clear(sessionId: string): void {
    if (this.getLines(sessionId).length === 0) return;
    this.#lines.set(sessionId, EMPTY_LINES);
    this.publish();
  }

  private createId(): string {
    return `terminal-line-${this.#nextLineId++}`;
  }

  private publish(): void {
    for (const listener of this.#listeners) listener();
  }
}

export const terminalSessionStore = new TerminalSessionStore();
