import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseSessionEntries } from "@earendil-works/pi-coding-agent";
import {
  atomicReplaceFile,
  withCrossProcessFileLock,
} from "@workbench/server-core/file-persistence";
import type {
  UsageStatisticsPayload,
  UsageStatisticsValue,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import {
  aggregateUsageStatistics,
  usageMessages,
  type UsageMessage,
} from "./usage-statistics-aggregation";

type SessionFile = { path: string; fingerprint?: string };
type IndexedSession = { fingerprint?: string; messages: readonly UsageMessage[] };
type Snapshot = { revision: string; validUntil: number; value: UsageStatisticsValue };
const MAX_INDEX_BYTES = 64 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const MAX_TIME_ZONES = 4;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function dateKey(timeZone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"]
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join("-");
}
function validMessage(value: unknown): value is UsageMessage {
  return (
    record(value) &&
    typeof value.identity === "string" &&
    nonNegative(value.timestamp) &&
    value.timestamp <= 8.64e15 &&
    nonNegative(value.tokens) &&
    typeof value.provider === "string" &&
    typeof value.model === "string"
  );
}
function validSnapshot(value: unknown): value is Snapshot {
  if (
    !record(value) ||
    typeof value.revision !== "string" ||
    !nonNegative(value.validUntil) ||
    !record(value.value)
  )
    return false;
  const v = value.value;
  if (
    typeof v.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(v.generatedAt)) ||
    typeof v.timeZone !== "string" ||
    typeof v.today !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v.today) ||
    ![v.totalTokens, v.peakDailyTokens, v.longestChatMs, v.currentStreak, v.longestStreak].every(
      nonNegative,
    ) ||
    !Array.isArray(v.days)
  )
    return false;
  try {
    dateKey(v.timeZone, new Date(v.generatedAt));
  } catch {
    return false;
  }
  return v.days.every(
    (day) =>
      record(day) &&
      typeof day.date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(day.date) &&
      nonNegative(day.tokens) &&
      nonNegative(day.messages) &&
      Array.isArray(day.models) &&
      day.models.every(
        (model) =>
          record(model) &&
          typeof model.provider === "string" &&
          typeof model.model === "string" &&
          nonNegative(model.tokens),
      ),
  );
}

/** Derived data only. Invalid, missing or unwritable caches never replace the source sessions. */
export class UsageStatisticsStore {
  private sessions = new Map<string, IndexedSession>();
  private snapshots = new Map<string, Snapshot>();
  private revision: string = randomUUID();
  private indexLoaded = false;
  private indexDirty = false;
  private snapshotsDirty = false;
  private snapshotLoad?: Promise<void>;
  private task?: {
    timeZone: string;
    controller: AbortController;
    users: number;
    promise: Promise<UsageStatisticsValue>;
  };
  private readonly directory: string;

  private readonly sessionRoot: string;
  private readonly listFiles: () => Promise<SessionFile[]>;
  private readonly now: () => Date;

  constructor(
    sessionRoot: string,
    listFiles: () => Promise<SessionFile[]>,
    now: () => Date = () => new Date(),
  ) {
    this.sessionRoot = path.resolve(sessionRoot);
    this.listFiles = listFiles;
    this.now = now;
    this.directory = path.join(path.dirname(this.sessionRoot), "workbench-usage-v1");
  }

  private async loadDocument(name: string, maxBytes: number) {
    try {
      const file = path.join(this.directory, name);
      if ((await stat(file)).size > maxBytes) return undefined;
      const text = await readFile(file, "utf8");
      if (Buffer.byteLength(text) > maxBytes) return undefined;
      const value: unknown = JSON.parse(text);
      return record(value) && value.version === 1 && value.sessionRoot === this.sessionRoot
        ? value
        : undefined;
    } catch {
      return undefined;
    }
  }

  private loadSnapshots(): Promise<void> {
    return (this.snapshotLoad ??= (async () => {
      const document = await this.loadDocument("snapshots.json", MAX_SNAPSHOT_BYTES);
      if (!Array.isArray(document?.snapshots)) return;
      for (const snapshot of document.snapshots.slice(-MAX_TIME_ZONES)) {
        if (validSnapshot(snapshot)) this.snapshots.set(snapshot.value.timeZone, snapshot);
      }
    })());
  }

  private async loadIndex() {
    if (this.indexLoaded) return;
    const document = await this.loadDocument("index.json", MAX_INDEX_BYTES);
    this.indexDirty = true;
    if (document && typeof document.revision === "string" && Array.isArray(document.sessions)) {
      const sessions = new Map<string, IndexedSession>();
      let valid = true;
      for (const item of document.sessions) {
        if (
          !record(item) ||
          typeof item.path !== "string" ||
          (item.fingerprint !== undefined && typeof item.fingerprint !== "string") ||
          !Array.isArray(item.messages) ||
          !item.messages.every(validMessage)
        ) {
          valid = false;
          break;
        }
        const file = path.resolve(this.sessionRoot, item.path);
        const relative = path.relative(this.sessionRoot, file);
        if (
          !relative ||
          relative.startsWith(`..${path.sep}`) ||
          relative === ".." ||
          path.isAbsolute(relative) ||
          sessions.has(file)
        ) {
          valid = false;
          break;
        }
        sessions.set(file, { fingerprint: item.fingerprint, messages: item.messages });
      }
      if (valid) {
        this.sessions = sessions;
        this.revision = document.revision;
        this.indexDirty = false;
      }
    }
    this.indexLoaded = true;
  }

  private async saveDocument(name: string, fields: object, maxBytes: number): Promise<boolean> {
    const content = JSON.stringify({ version: 1, sessionRoot: this.sessionRoot, ...fields });
    if (Buffer.byteLength(content) > maxBytes) return false;
    const file = path.join(this.directory, name);
    try {
      await withCrossProcessFileLock(
        { lockDirectory: `${file}.lock`, parentDirectoryMode: 0o700 },
        () =>
          atomicReplaceFile(file, content, {
            directoryMode: 0o700,
            fileMode: 0o600,
            enforceFileModeAfterReplace: true,
          }),
      );
      return true;
    } catch {
      // Statistics remain available in memory; a subsequent refresh retries persistence.
      return false;
    }
  }

  private cached(timeZone: string, authoritative: boolean): UsageStatisticsValue | undefined {
    const snapshot = this.snapshots.get(timeZone);
    const now = this.now();
    if (
      !snapshot ||
      (authoritative && snapshot.revision !== this.revision) ||
      snapshot.value.today !== dateKey(timeZone, now) ||
      now.getTime() >= snapshot.validUntil ||
      now.getTime() < Date.parse(snapshot.value.generatedAt)
    )
      return undefined;
    return snapshot.value;
  }

  private async refresh(timeZone: string, signal: AbortSignal): Promise<UsageStatisticsValue> {
    await this.loadIndex();
    signal.throwIfAborted();
    const files = await this.listFiles();
    signal.throwIfAborted();
    const next = new Map<string, IndexedSession>();
    let changed = false;
    for (const file of files) {
      signal.throwIfAborted();
      const cached = this.sessions.get(file.path);
      if (file.fingerprint !== undefined && cached?.fingerprint === file.fingerprint) {
        next.set(file.path, cached);
        continue;
      }
      changed = true;
      try {
        const before = await stat(file.path);
        const messages = usageMessages(
          parseSessionEntries(await readFile(file.path, { encoding: "utf8", signal })),
        );
        const after = await stat(file.path);
        const fingerprint = `${after.size}:${after.mtimeMs}`;
        // Never cache a partial/racing read under the fingerprint of a later write.
        const stable =
          before.size === after.size &&
          before.mtimeMs === after.mtimeMs &&
          before.ctimeMs === after.ctimeMs;
        next.set(file.path, { fingerprint: stable ? fingerprint : undefined, messages });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    changed ||= next.size !== this.sessions.size;
    signal.throwIfAborted();
    if (changed) {
      this.sessions = next;
      this.revision = randomUUID();
      this.snapshots.clear();
      this.indexDirty = true;
    }
    let value = this.cached(timeZone, true);
    if (!value) {
      const now = this.now();
      let validUntil = Number.MAX_SAFE_INTEGER;
      const values = this.sessions.values();
      async function* storedSessions() {
        for (const session of values) {
          for (const message of session.messages) {
            if (message.timestamp > now.getTime())
              validUntil = Math.min(validUntil, message.timestamp);
          }
          yield session.messages;
        }
      }
      value = await aggregateUsageStatistics(storedSessions(), timeZone, now, signal);
      signal.throwIfAborted();
      this.snapshots.delete(timeZone);
      this.snapshots.set(timeZone, { revision: this.revision, validUntil, value });
      this.snapshotsDirty = true;
      while (this.snapshots.size > MAX_TIME_ZONES)
        this.snapshots.delete(this.snapshots.keys().next().value!);
    }
    if (this.indexDirty) {
      const saved = await this.saveDocument(
        "index.json",
        {
          revision: this.revision,
          sessions: [...this.sessions].map(([file, session]) => ({
            path: path.relative(this.sessionRoot, file),
            ...session,
          })),
        },
        MAX_INDEX_BYTES,
      );
      if (saved) this.indexDirty = false;
    }
    if (this.snapshotsDirty) {
      const saved = await this.saveDocument(
        "snapshots.json",
        { snapshots: [...this.snapshots.values()] },
        MAX_SNAPSHOT_BYTES,
      );
      if (saved) this.snapshotsDirty = false;
    }
    signal.throwIfAborted();
    return value;
  }

  async read(
    { timeZone, preferCached }: UsageStatisticsPayload,
    signal: AbortSignal,
  ): Promise<UsageStatisticsValue> {
    signal.throwIfAborted();
    await this.loadSnapshots();
    signal.throwIfAborted();
    if (preferCached) {
      const value = this.cached(timeZone, false);
      if (value) return value;
    }
    let task = this.task;
    // A cancelled generation must finish before another generation mutates the index.
    if (task?.controller.signal.aborted) {
      await task.promise.catch(() => {});
      return this.read({ timeZone, preferCached }, signal);
    }
    if (!task) {
      const controller = new AbortController();
      task = { timeZone, controller, users: 0, promise: this.refresh(timeZone, controller.signal) };
      this.task = task;
      const active = task;
      void task.promise.then(
        () => {
          if (this.task === active) this.task = undefined;
        },
        () => {
          if (this.task === active) this.task = undefined;
        },
      );
    }
    const active = task;
    active.users++;
    const value = await new Promise<UsageStatisticsValue>((resolve, reject) => {
      let finished = false;
      const finish = (callback: () => void) => {
        if (finished) return;
        finished = true;
        signal.removeEventListener("abort", abort);
        if (--active.users === 0 && this.task === active) active.controller.abort();
        callback();
      };
      const abort = () => finish(() => reject(signal.reason));
      signal.addEventListener("abort", abort, { once: true });
      active.promise.then(
        (result) => finish(() => resolve(result)),
        (error: unknown) => finish(() => reject(error)),
      );
      if (signal.aborted) abort();
    });
    // Different time zones share the file reconciliation, then build their own projection.
    if (active.timeZone !== timeZone) return this.read({ timeZone }, signal);
    return value;
  }
}
