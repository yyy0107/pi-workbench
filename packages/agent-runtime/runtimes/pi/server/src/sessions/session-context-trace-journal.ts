import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, open, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import type {
  SessionContextTraceActivationSummary,
  SessionContextTraceEvent,
  SessionContextTraceEventSummary,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import { atomicReplaceFile } from "@workbench/server-core/file-persistence";
import { summarizeSessionContextTraceEvent } from "./session-context-trace-summary";

export const SESSION_CONTEXT_TRACE_MAX_PERSISTED_ACTIVATIONS = 100;
export const SESSION_CONTEXT_TRACE_MAX_PERSISTED_BYTES = 1024 * 1024 * 1024;

const JOURNAL_SCHEMA_VERSION = 1 as const;
const SAFE_ACTIVATION_ID = /^[a-zA-Z0-9-]{1,128}$/u;

interface ActivationMetadata {
  schemaVersion: typeof JOURNAL_SCHEMA_VERSION;
  sessionId: string;
  activationId: string;
  startedAt: number;
  updatedAt: number;
  eventCount: number;
  persistedBytes: number;
  complete: boolean;
  lastHash: string;
}

type UnsignedJournalRecord =
  | {
      schemaVersion: typeof JOURNAL_SCHEMA_VERSION;
      recordType: "activation-start";
      previousHash: null;
      sessionId: string;
      activationId: string;
      startedAt: number;
    }
  | {
      schemaVersion: typeof JOURNAL_SCHEMA_VERSION;
      recordType: "event";
      previousHash: string;
      event: SessionContextTraceEvent;
    }
  | {
      schemaVersion: typeof JOURNAL_SCHEMA_VERSION;
      recordType: "activation-end";
      previousHash: string;
      sessionId: string;
      activationId: string;
      completedAt: number;
    };

type JournalRecord = UnsignedJournalRecord & { hash: string };

export interface PersistedContextTracePage {
  activationId: string;
  events: SessionContextTraceEventSummary[];
  hasMore: boolean;
  nextSeq: number;
  retainedFromSeq: number;
}

export class SessionContextTraceJournalError extends Error {
  readonly code:
    | "context-trace-not-found"
    | "context-trace-journal-corrupt"
    | "context-trace-journal-io";

  constructor(
    code: "context-trace-not-found" | "context-trace-journal-corrupt" | "context-trace-journal-io",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SessionContextTraceJournalError";
    this.code = code;
  }
}

function configuredRoot(): string {
  const explicit = process.env.PI_WORKBENCH_CONTEXT_TRACE_DIR?.trim();
  return explicit
    ? path.resolve(explicit)
    : path.join(getAgentDir(), "workbench-context-traces", "v1");
}

function sessionDirectory(sessionId: string): string {
  const digest = createHash("sha256").update(sessionId).digest("hex");
  return path.join(configuredRoot(), digest);
}

function assertActivationId(activationId: string): void {
  if (!SAFE_ACTIVATION_ID.test(activationId)) {
    throw new SessionContextTraceJournalError(
      "context-trace-journal-corrupt",
      "Invalid context trace activation identifier",
    );
  }
}

function activationFile(sessionId: string, activationId: string): string {
  assertActivationId(activationId);
  return path.join(sessionDirectory(sessionId), `${activationId}.jsonl`);
}

function metadataFile(sessionId: string, activationId: string): string {
  assertActivationId(activationId);
  return path.join(sessionDirectory(sessionId), `${activationId}.json`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function parseMetadata(value: unknown): ActivationMetadata {
  if (
    !isRecord(value) ||
    value.schemaVersion !== JOURNAL_SCHEMA_VERSION ||
    typeof value.sessionId !== "string" ||
    typeof value.activationId !== "string" ||
    !SAFE_ACTIVATION_ID.test(value.activationId) ||
    !finiteInteger(value.startedAt) ||
    !finiteInteger(value.updatedAt) ||
    !finiteInteger(value.eventCount) ||
    !finiteInteger(value.persistedBytes) ||
    typeof value.complete !== "boolean" ||
    typeof value.lastHash !== "string"
  ) {
    throw new SessionContextTraceJournalError(
      "context-trace-journal-corrupt",
      "Invalid context trace activation metadata",
    );
  }
  return value as unknown as ActivationMetadata;
}

function isTraceEvent(value: unknown): value is SessionContextTraceEvent {
  return Boolean(
    isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.traceId === "string" &&
    typeof value.sessionId === "string" &&
    typeof value.activationId === "string" &&
    finiteInteger(value.seq) &&
    finiteInteger(value.time) &&
    typeof value.kind === "string" &&
    isRecord(value.detail) &&
    value.detail.type === value.kind,
  );
}

function unsignedRecord(value: unknown): UnsignedJournalRecord {
  if (!isRecord(value) || value.schemaVersion !== JOURNAL_SCHEMA_VERSION) {
    throw new SessionContextTraceJournalError(
      "context-trace-journal-corrupt",
      "Invalid context trace journal record",
    );
  }
  if (value.recordType === "activation-start") {
    if (
      value.previousHash !== null ||
      typeof value.sessionId !== "string" ||
      typeof value.activationId !== "string" ||
      !finiteInteger(value.startedAt)
    ) {
      throw new SessionContextTraceJournalError(
        "context-trace-journal-corrupt",
        "Invalid context trace activation header",
      );
    }
    return {
      schemaVersion: JOURNAL_SCHEMA_VERSION,
      recordType: "activation-start",
      previousHash: null,
      sessionId: value.sessionId,
      activationId: value.activationId,
      startedAt: value.startedAt,
    };
  }
  if (value.recordType === "event") {
    if (typeof value.previousHash !== "string" || !isTraceEvent(value.event)) {
      throw new SessionContextTraceJournalError(
        "context-trace-journal-corrupt",
        "Invalid context trace event record",
      );
    }
    return {
      schemaVersion: JOURNAL_SCHEMA_VERSION,
      recordType: "event",
      previousHash: value.previousHash,
      event: value.event,
    };
  }
  if (value.recordType === "activation-end") {
    if (
      typeof value.previousHash !== "string" ||
      typeof value.sessionId !== "string" ||
      typeof value.activationId !== "string" ||
      !finiteInteger(value.completedAt)
    ) {
      throw new SessionContextTraceJournalError(
        "context-trace-journal-corrupt",
        "Invalid context trace activation footer",
      );
    }
    return {
      schemaVersion: JOURNAL_SCHEMA_VERSION,
      recordType: "activation-end",
      previousHash: value.previousHash,
      sessionId: value.sessionId,
      activationId: value.activationId,
      completedAt: value.completedAt,
    };
  }
  throw new SessionContextTraceJournalError(
    "context-trace-journal-corrupt",
    "Unknown context trace journal record",
  );
}

function hashRecord(record: UnsignedJournalRecord): string {
  return createHash("sha256").update(JSON.stringify(record)).digest("hex");
}

function serializeRecord(record: UnsignedJournalRecord): { hash: string; line: string } {
  const hash = hashRecord(record);
  return { hash, line: `${JSON.stringify({ ...record, hash })}\n` };
}

function parseRecord(line: string, expectedPreviousHash: string | null): JournalRecord {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    throw new SessionContextTraceJournalError(
      "context-trace-journal-corrupt",
      "Context trace journal contains invalid JSON",
      { cause: error },
    );
  }
  if (!isRecord(value) || typeof value.hash !== "string") {
    throw new SessionContextTraceJournalError(
      "context-trace-journal-corrupt",
      "Context trace journal record has no integrity hash",
    );
  }
  const record = unsignedRecord(value);
  if (record.previousHash !== expectedPreviousHash || hashRecord(record) !== value.hash) {
    throw new SessionContextTraceJournalError(
      "context-trace-journal-corrupt",
      "Context trace journal hash chain verification failed",
    );
  }
  return { ...record, hash: value.hash } as JournalRecord;
}

function eventSummary(event: SessionContextTraceEvent): SessionContextTraceEventSummary {
  return summarizeSessionContextTraceEvent(event);
}

async function writeMetadata(metadata: ActivationMetadata): Promise<void> {
  await atomicReplaceFile(
    metadataFile(metadata.sessionId, metadata.activationId),
    `${JSON.stringify(metadata, null, 2)}\n`,
    {
      directoryMode: 0o700,
      fileMode: 0o600,
      enforceFileModeAfterReplace: true,
    },
  );
}

async function readActivationMetadata(
  sessionId: string,
  activationId: string,
): Promise<ActivationMetadata> {
  try {
    const metadata = parseMetadata(
      JSON.parse(await readFile(metadataFile(sessionId, activationId), "utf8")),
    );
    if (metadata.sessionId !== sessionId || metadata.activationId !== activationId) {
      throw new SessionContextTraceJournalError(
        "context-trace-journal-corrupt",
        "Context trace activation metadata identity mismatch",
      );
    }
    return metadata;
  } catch (error) {
    if (error instanceof SessionContextTraceJournalError) throw error;
    throw new SessionContextTraceJournalError(
      "context-trace-journal-io",
      "Unable to read context trace activation metadata",
      { cause: error },
    );
  }
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
}

async function appendDurable(file: string, content: string): Promise<void> {
  const handle = await open(file, "a", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function activationMetadataList(sessionId: string): Promise<ActivationMetadata[]> {
  const directory = sessionDirectory(sessionId);
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new SessionContextTraceJournalError(
      "context-trace-journal-io",
      "Unable to list context trace activations",
      { cause: error },
    );
  }
  const metadata: ActivationMetadata[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json") || entry === "session.json") continue;
    const activationId = entry.slice(0, -".json".length);
    try {
      metadata.push(await readActivationMetadata(sessionId, activationId));
    } catch (error) {
      if (error instanceof SessionContextTraceJournalError) throw error;
    }
  }
  return metadata;
}

async function pruneCompletedActivations(sessionId: string): Promise<void> {
  const metadata = (await activationMetadataList(sessionId))
    .filter((item) => item.complete)
    .sort((left, right) => left.startedAt - right.startedAt);
  let totalBytes = metadata.reduce((sum, item) => sum + item.persistedBytes, 0);
  while (
    metadata.length >= SESSION_CONTEXT_TRACE_MAX_PERSISTED_ACTIVATIONS ||
    totalBytes >= SESSION_CONTEXT_TRACE_MAX_PERSISTED_BYTES
  ) {
    const oldest = metadata.shift();
    if (!oldest) break;
    await Promise.all([
      rm(activationFile(sessionId, oldest.activationId), { force: true }),
      rm(metadataFile(sessionId, oldest.activationId), { force: true }),
    ]);
    totalBytes -= oldest.persistedBytes;
  }
}

export class SessionContextTraceJournal {
  readonly sessionId: string;
  readonly activationId: string;
  readonly startedAt: number;
  private readonly journalFile: string;
  private metadata: ActivationMetadata;
  private tail: Promise<void> = Promise.resolve();
  private failure: unknown;
  private closing = false;
  private closePromise?: Promise<void>;

  private constructor(metadata: ActivationMetadata) {
    this.sessionId = metadata.sessionId;
    this.activationId = metadata.activationId;
    this.startedAt = metadata.startedAt;
    this.metadata = metadata;
    this.journalFile = activationFile(metadata.sessionId, metadata.activationId);
  }

  static async create(
    sessionId: string,
    activationId: string = randomUUID(),
  ): Promise<SessionContextTraceJournal> {
    assertActivationId(activationId);
    const root = configuredRoot();
    const directory = sessionDirectory(sessionId);
    await ensurePrivateDirectory(root);
    await ensurePrivateDirectory(directory);
    await pruneCompletedActivations(sessionId);

    const startedAt = Date.now();
    const header = serializeRecord({
      schemaVersion: JOURNAL_SCHEMA_VERSION,
      recordType: "activation-start",
      previousHash: null,
      sessionId,
      activationId,
      startedAt,
    });
    const handle = await open(activationFile(sessionId, activationId), "wx", 0o600);
    try {
      await handle.writeFile(header.line, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(activationFile(sessionId, activationId), 0o600);
    const metadata: ActivationMetadata = {
      schemaVersion: JOURNAL_SCHEMA_VERSION,
      sessionId,
      activationId,
      startedAt,
      updatedAt: startedAt,
      eventCount: 0,
      persistedBytes: Buffer.byteLength(header.line, "utf8"),
      complete: false,
      lastHash: header.hash,
    };
    await writeMetadata(metadata);
    return new SessionContextTraceJournal(metadata);
  }

  private enqueue(task: () => Promise<void>): void {
    this.tail = this.tail.then(task).catch((error: unknown) => {
      this.failure ??= error;
    });
  }

  append(event: SessionContextTraceEvent): void {
    if (this.closing) return;
    this.enqueue(async () => {
      const record = serializeRecord({
        schemaVersion: JOURNAL_SCHEMA_VERSION,
        recordType: "event",
        previousHash: this.metadata.lastHash,
        event,
      });
      await appendDurable(this.journalFile, record.line);
      const updatedAt = Date.now();
      this.metadata = {
        ...this.metadata,
        updatedAt,
        eventCount: this.metadata.eventCount + 1,
        persistedBytes: this.metadata.persistedBytes + Buffer.byteLength(record.line, "utf8"),
        lastHash: record.hash,
      };
      await writeMetadata(this.metadata);
    });
  }

  async flush(): Promise<void> {
    await this.tail;
    if (this.failure) {
      throw new SessionContextTraceJournalError(
        "context-trace-journal-io",
        "Unable to persist context trace journal",
        { cause: this.failure },
      );
    }
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.enqueue(async () => {
      const completedAt = Date.now();
      const record = serializeRecord({
        schemaVersion: JOURNAL_SCHEMA_VERSION,
        recordType: "activation-end",
        previousHash: this.metadata.lastHash,
        sessionId: this.sessionId,
        activationId: this.activationId,
        completedAt,
      });
      await appendDurable(this.journalFile, record.line);
      this.metadata = {
        ...this.metadata,
        updatedAt: completedAt,
        persistedBytes: this.metadata.persistedBytes + Buffer.byteLength(record.line, "utf8"),
        complete: true,
        lastHash: record.hash,
      };
      await writeMetadata(this.metadata);
    });
    this.closePromise = this.flush();
    return this.closePromise;
  }

  summary(active: boolean): SessionContextTraceActivationSummary {
    return {
      schemaVersion: JOURNAL_SCHEMA_VERSION,
      sessionId: this.sessionId,
      activationId: this.activationId,
      startedAt: this.startedAt,
      updatedAt: this.metadata.updatedAt,
      eventCount: this.metadata.eventCount,
      persistedBytes: this.metadata.persistedBytes,
      active,
      complete: this.metadata.complete,
    };
  }

  static async listActivations(
    sessionId: string,
    activeActivationId?: string,
  ): Promise<SessionContextTraceActivationSummary[]> {
    return (await activationMetadataList(sessionId))
      .map((metadata) => ({
        schemaVersion: JOURNAL_SCHEMA_VERSION,
        sessionId,
        activationId: metadata.activationId,
        startedAt: metadata.startedAt,
        updatedAt: metadata.updatedAt,
        eventCount: metadata.eventCount,
        persistedBytes: metadata.persistedBytes,
        active: metadata.activationId === activeActivationId,
        complete: metadata.complete,
      }))
      .sort((left, right) => right.startedAt - left.startedAt);
  }

  static async readActivation(
    sessionId: string,
    activationId: string,
    afterSeq = -1,
    limit = 100,
  ): Promise<PersistedContextTracePage> {
    assertActivationId(activationId);
    const stream = createReadStream(activationFile(sessionId, activationId), {
      encoding: "utf8",
    });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    let previousHash: string | null = null;
    let headerSeen = false;
    let footerSeen = false;
    let expectedSequence = 0;
    let nextSeq = 0;
    let retainedFromSeq: number | undefined;
    let matchingCount = 0;
    const events: SessionContextTraceEventSummary[] = [];
    try {
      for await (const line of lines) {
        if (!line.trim()) continue;
        const record = parseRecord(line, previousHash);
        previousHash = record.hash;
        if (footerSeen) {
          throw new SessionContextTraceJournalError(
            "context-trace-journal-corrupt",
            "Context trace journal contains records after its activation footer",
          );
        }
        if (record.recordType === "activation-start") {
          if (
            headerSeen ||
            record.sessionId !== sessionId ||
            record.activationId !== activationId
          ) {
            throw new SessionContextTraceJournalError(
              "context-trace-journal-corrupt",
              "Context trace activation header identity mismatch",
            );
          }
          headerSeen = true;
          continue;
        }
        if (record.recordType === "activation-end") {
          if (record.sessionId !== sessionId || record.activationId !== activationId) {
            throw new SessionContextTraceJournalError(
              "context-trace-journal-corrupt",
              "Context trace activation footer identity mismatch",
            );
          }
          footerSeen = true;
          continue;
        }
        if (
          record.event.sessionId !== sessionId ||
          record.event.activationId !== activationId ||
          record.event.seq !== expectedSequence ||
          record.event.traceId !== `${activationId}:${expectedSequence}`
        ) {
          throw new SessionContextTraceJournalError(
            "context-trace-journal-corrupt",
            "Context trace event identity or sequence mismatch",
          );
        }
        expectedSequence += 1;
        retainedFromSeq ??= record.event.seq;
        nextSeq = Math.max(nextSeq, record.event.seq + 1);
        if (record.event.seq <= afterSeq) continue;
        matchingCount += 1;
        if (events.length < limit) events.push(eventSummary(record.event));
      }
    } catch (error) {
      if (error instanceof SessionContextTraceJournalError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new SessionContextTraceJournalError(
          "context-trace-not-found",
          "The requested context trace activation was not found.",
          { cause: error },
        );
      }
      throw new SessionContextTraceJournalError(
        "context-trace-journal-io",
        "Unable to read context trace journal",
        { cause: error },
      );
    } finally {
      lines.close();
      stream.destroy();
    }
    if (!headerSeen) {
      throw new SessionContextTraceJournalError(
        "context-trace-journal-corrupt",
        "Context trace journal has no activation header",
      );
    }
    return {
      activationId,
      events,
      hasMore: matchingCount > events.length,
      nextSeq,
      retainedFromSeq: retainedFromSeq ?? nextSeq,
    };
  }

  static async readEvent(
    sessionId: string,
    traceId: string,
  ): Promise<SessionContextTraceEvent | undefined> {
    const separator = traceId.lastIndexOf(":");
    if (separator <= 0) return undefined;
    const activationId = traceId.slice(0, separator);
    const sequence = Number(traceId.slice(separator + 1));
    if (!Number.isSafeInteger(sequence) || sequence < 0) return undefined;
    assertActivationId(activationId);

    const stream = createReadStream(activationFile(sessionId, activationId), {
      encoding: "utf8",
    });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    let previousHash: string | null = null;
    try {
      for await (const line of lines) {
        if (!line.trim()) continue;
        const record = parseRecord(line, previousHash);
        previousHash = record.hash;
        if (record.recordType === "event" && record.event.seq === sequence) {
          if (record.event.traceId !== traceId || record.event.sessionId !== sessionId) {
            throw new SessionContextTraceJournalError(
              "context-trace-journal-corrupt",
              "Context trace event identity mismatch",
            );
          }
          return record.event;
        }
      }
      return undefined;
    } catch (error) {
      if (error instanceof SessionContextTraceJournalError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new SessionContextTraceJournalError(
        "context-trace-journal-io",
        "Unable to read context trace journal event",
        { cause: error },
      );
    } finally {
      lines.close();
      stream.destroy();
    }
  }
}
