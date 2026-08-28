import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { SessionInfo } from "@earendil-works/pi-coding-agent";

import type { PiSessionSummary } from "@/runtime/pi/contracts/pi";
import {
  parseExecutionSessionOrigin,
  type ExecutionSessionOrigin,
} from "@/runtime/shared/execution";
import { atomicReplaceFile, withCrossProcessFileLock } from "../core/file-persistence";

const SESSION_CATALOG_INDEX_VERSION = 1 as const;
const MAX_SESSION_CATALOG_INDEX_BYTES = 64 * 1024 * 1024;

type IndexedSessionSummary = Omit<PiSessionSummary, "workspace" | "runTiming">;

interface SessionCatalogIndexEntryV1 {
  relativePath: string;
  fingerprint: string;
  id: string;
  cwd: string;
  name?: string;
  parentSessionPath?: string;
  created: string;
  modified: string;
  summaryModified: string;
  messageCount: number;
  firstMessage: string;
  summaryFirstMessage: string;
  allMessagesText: string;
  executionOrigin?: ExecutionSessionOrigin;
}

interface SessionCatalogIndexDocumentV1 {
  version: typeof SESSION_CATALOG_INDEX_VERSION;
  sessionRoot: string;
  updatedAt: string;
  entries: SessionCatalogIndexEntryV1[];
}

export interface SessionCatalogIndexSnapshot {
  sessions: Map<string, SessionInfo>;
  summaries: Map<string, IndexedSessionSummary>;
  fingerprints: Map<string, string>;
}

export type SessionCatalogIndexReadResult =
  | { status: "missing" }
  | { status: "invalid"; bytes?: number; reason: string }
  | { status: "hit"; bytes: number; snapshot: SessionCatalogIndexSnapshot };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^\d+:\d+(?:\.\d+)?$/u.test(value);
}

function relativeSessionPath(sessionRoot: string, file: string): string | undefined {
  const relative = path.relative(sessionRoot, path.resolve(file));
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    !relative.endsWith(".jsonl")
  ) {
    return undefined;
  }
  return relative;
}

function resolveSessionPath(sessionRoot: string, relative: string): string | undefined {
  if (!relative || path.isAbsolute(relative) || !relative.endsWith(".jsonl")) return undefined;
  const resolved = path.resolve(sessionRoot, relative);
  return relativeSessionPath(sessionRoot, resolved) === relative ? resolved : undefined;
}

function parseDocument(
  value: unknown,
  sessionRoot: string,
): SessionCatalogIndexSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  if (value.version !== SESSION_CATALOG_INDEX_VERSION) return undefined;
  if (value.sessionRoot !== sessionRoot || !Array.isArray(value.entries)) return undefined;

  const sessions = new Map<string, SessionInfo>();
  const summaries = new Map<string, IndexedSessionSummary>();
  const fingerprints = new Map<string, string>();
  for (const candidate of value.entries) {
    if (!isRecord(candidate)) return undefined;
    const file = resolveSessionPath(sessionRoot, candidate.relativePath as string);
    if (
      !file ||
      !validFingerprint(candidate.fingerprint) ||
      typeof candidate.id !== "string" ||
      !candidate.id ||
      typeof candidate.cwd !== "string" ||
      !validDate(candidate.created) ||
      !validDate(candidate.modified) ||
      !validDate(candidate.summaryModified) ||
      !Number.isSafeInteger(candidate.messageCount) ||
      (candidate.messageCount as number) < 0 ||
      typeof candidate.firstMessage !== "string" ||
      typeof candidate.summaryFirstMessage !== "string" ||
      typeof candidate.allMessagesText !== "string" ||
      sessions.has(candidate.id) ||
      fingerprints.has(file)
    ) {
      return undefined;
    }
    const name = optionalString(candidate.name);
    const parentSessionPath = optionalString(candidate.parentSessionPath);
    const executionOrigin =
      candidate.executionOrigin === undefined
        ? undefined
        : parseExecutionSessionOrigin(candidate.executionOrigin);
    if (candidate.executionOrigin !== undefined && executionOrigin === undefined) return undefined;
    const info: SessionInfo = {
      path: file,
      id: candidate.id,
      cwd: candidate.cwd,
      ...(name === undefined ? {} : { name }),
      ...(parentSessionPath === undefined ? {} : { parentSessionPath }),
      created: new Date(candidate.created),
      modified: new Date(candidate.modified),
      messageCount: candidate.messageCount as number,
      firstMessage: candidate.firstMessage,
      allMessagesText: candidate.allMessagesText,
    };
    sessions.set(info.id, info);
    summaries.set(info.id, {
      id: info.id,
      cwd: info.cwd,
      name: info.name,
      created: info.created.toISOString(),
      modified: new Date(candidate.summaryModified).toISOString(),
      messageCount: info.messageCount,
      firstMessage: candidate.summaryFirstMessage,
      transient: false,
      running: false,
      ...(executionOrigin === undefined ? {} : { executionOrigin }),
    });
    fingerprints.set(file, candidate.fingerprint);
  }
  return { sessions, summaries, fingerprints };
}

export function configuredSessionCatalogIndexFile(sessionRoot: string): string {
  const explicit = process.env.PI_WORKBENCH_SESSION_INDEX_FILE?.trim();
  return explicit
    ? path.resolve(explicit)
    : path.join(path.dirname(path.resolve(sessionRoot)), "workbench-session-index.v1.json");
}

export async function readSessionCatalogIndex(
  sessionRootValue: string,
): Promise<SessionCatalogIndexReadResult> {
  const sessionRoot = path.resolve(sessionRootValue);
  const indexFile = configuredSessionCatalogIndexFile(sessionRoot);
  let bytes: number;
  try {
    bytes = (await stat(indexFile)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "missing" };
    return { status: "invalid", reason: "stat-failed" };
  }
  if (bytes > MAX_SESSION_CATALOG_INDEX_BYTES) {
    return { status: "invalid", bytes, reason: "too-large" };
  }
  try {
    const snapshot = parseDocument(JSON.parse(await readFile(indexFile, "utf8")), sessionRoot);
    return snapshot
      ? { status: "hit", bytes, snapshot }
      : { status: "invalid", bytes, reason: "schema-invalid" };
  } catch {
    return { status: "invalid", bytes, reason: "read-failed" };
  }
}

export async function writeSessionCatalogIndex(
  sessionRootValue: string,
  sessions: ReadonlyMap<string, SessionInfo>,
  summaries: ReadonlyMap<string, PiSessionSummary>,
  fingerprints: ReadonlyMap<string, string>,
): Promise<{ bytes: number; entries: number }> {
  const sessionRoot = path.resolve(sessionRootValue);
  const entries: SessionCatalogIndexEntryV1[] = [];
  for (const info of sessions.values()) {
    const summary = summaries.get(info.id);
    const relativePath = relativeSessionPath(sessionRoot, info.path);
    const fingerprint = fingerprints.get(info.path);
    if (!summary || !relativePath || !fingerprint) continue;
    entries.push({
      relativePath,
      fingerprint,
      id: info.id,
      cwd: info.cwd,
      ...(info.name === undefined ? {} : { name: info.name }),
      ...(info.parentSessionPath === undefined
        ? {}
        : { parentSessionPath: info.parentSessionPath }),
      created: info.created.toISOString(),
      modified: info.modified.toISOString(),
      summaryModified: summary.modified,
      messageCount: info.messageCount,
      firstMessage: info.firstMessage,
      summaryFirstMessage: summary.firstMessage,
      allMessagesText: info.allMessagesText,
      ...(summary.executionOrigin === undefined
        ? {}
        : { executionOrigin: summary.executionOrigin }),
    });
  }
  entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const document: SessionCatalogIndexDocumentV1 = {
    version: SESSION_CATALOG_INDEX_VERSION,
    sessionRoot,
    updatedAt: new Date().toISOString(),
    entries,
  };
  const content = `${JSON.stringify(document)}\n`;
  const indexFile = configuredSessionCatalogIndexFile(sessionRoot);
  await withCrossProcessFileLock(
    {
      lockDirectory: `${indexFile}.lock`,
      parentDirectoryMode: 0o700,
    },
    () =>
      atomicReplaceFile(indexFile, content, {
        directoryMode: 0o700,
        fileMode: 0o600,
        enforceFileModeAfterReplace: true,
      }),
  );
  return { bytes: Buffer.byteLength(content), entries: entries.length };
}
