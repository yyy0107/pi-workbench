import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";

import { type SessionInfo, SessionManager } from "@earendil-works/pi-coding-agent";

import { rejectUntrustedApiRequest } from "../transport/api-request-guard";
import { listSessions } from "./session-registry";

const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_DATA_DESCRIPTOR_FLAG = 0x0008;
const ZIP_VERSION_20 = 20;
const ZIP32_SENTINEL = 0xffffffff;
const ZIP_MAX_ENTRIES = 0xffff;
const RAW_READ_CHUNK_BYTES = 64 * 1024;
const RESPONSE_HIGH_WATER_MARK_BYTES = 64 * 1024;

const INVALID_QUERY_TEXT = "missing or invalid sessionId query parameter";
const SESSION_NOT_FOUND_TEXT = "session not found";
const RAW_ARTIFACT_UNAVAILABLE_TEXT = "session raw artifact is unavailable";
const EXPORT_PREPARATION_FAILED_TEXT = "session log export failed to prepare the stored artifact";

export interface SessionExportSessionInfo {
  id: string;
  path: string;
  parentSessionPath?: string;
}

export interface SessionExportRawArtifactMetadata {
  byteLength: number;
  regularFile: boolean;
}

export interface SessionExportDependencies {
  listRawSessions(signal: AbortSignal): Promise<readonly SessionExportSessionInfo[]>;
  listKnownSessionIds(signal: AbortSignal): Promise<readonly string[]>;
  inspectRawArtifact(path: string, signal: AbortSignal): Promise<SessionExportRawArtifactMetadata>;
  readRawArtifact(path: string, signal: AbortSignal): AsyncIterable<Uint8Array>;
}

interface ParsedSessionExportQuery {
  sessionId: string;
  includeDescendants: boolean;
}

interface PreparedZipEntry {
  archivePath: string;
  archivePathBytes: Uint8Array;
  sourcePath: string;
  byteLength: number;
}

interface PreparedSessionExport {
  filename: string;
  entries: PreparedZipEntry[];
}

interface WrittenZipEntry {
  archivePathBytes: Uint8Array;
  crc32: number;
  byteLength: number;
  localHeaderOffset: number;
}

class SessionExportHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "SessionExportHttpError";
    this.status = status;
  }
}

const textEncoder = new TextEncoder();

const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function updateCrc32(crc: number, bytes: Uint8Array): number {
  let next = crc;
  for (const byte of bytes) {
    next = (crc32Table[(next ^ byte) & 0xff] ?? 0) ^ (next >>> 8);
  }
  return next >>> 0;
}

function safeSessionIdSegment(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9_-]/g, "_") || "_";
}

export function sessionExportZipFilename(sessionId: string): string {
  return `dsh-session-${safeSessionIdSegment(sessionId)}.zip`;
}

function parseSessionExportQuery(request: Request): ParsedSessionExportQuery | undefined {
  const searchParams = new URL(request.url).searchParams;
  for (const key of searchParams.keys()) {
    if (key !== "sessionId" && key !== "includeDescendants") return undefined;
  }

  const sessionIds = searchParams.getAll("sessionId");
  if (sessionIds.length !== 1 || sessionIds[0] === undefined || sessionIds[0].length === 0) {
    return undefined;
  }

  const includeDescendantsValues = searchParams.getAll("includeDescendants");
  if (includeDescendantsValues.length > 1) return undefined;
  const includeDescendantsValue = includeDescendantsValues[0];
  if (
    includeDescendantsValue !== undefined &&
    includeDescendantsValue !== "true" &&
    includeDescendantsValue !== "false"
  ) {
    return undefined;
  }

  return {
    sessionId: sessionIds[0],
    includeDescendants: includeDescendantsValue === "true",
  };
}

function normalizedSessionPath(path: string): string {
  return resolve(path);
}

function collectExportSessions(
  root: SessionExportSessionInfo,
  sessions: readonly SessionExportSessionInfo[],
  includeDescendants: boolean,
): SessionExportSessionInfo[] {
  if (!includeDescendants) return [root];

  const childrenByParentPath = new Map<string, SessionExportSessionInfo[]>();
  for (const session of sessions) {
    if (!session.parentSessionPath) continue;
    const parentPath = normalizedSessionPath(session.parentSessionPath);
    const children = childrenByParentPath.get(parentPath);
    if (children) children.push(session);
    else childrenByParentPath.set(parentPath, [session]);
  }

  const selected: SessionExportSessionInfo[] = [];
  const seenIds = new Set<string>();
  const visit = (session: SessionExportSessionInfo): void => {
    if (seenIds.has(session.id)) return;
    seenIds.add(session.id);
    selected.push(session);
    const children = childrenByParentPath.get(normalizedSessionPath(session.path)) ?? [];
    for (const child of children) visit(child);
  };
  visit(root);
  return selected;
}

function allocateDescendantSegment(sessionId: string, used: Set<string>): string {
  const base = safeSessionIdSegment(sessionId);
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function assertSafeArchivePath(path: string): void {
  const segments = path.split("/");
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new SessionExportHttpError(501, RAW_ARTIFACT_UNAVAILABLE_TEXT);
  }
}

function assertClassicZipCapacity(entries: readonly PreparedZipEntry[]): void {
  if (entries.length >= ZIP_MAX_ENTRIES) {
    throw new SessionExportHttpError(501, RAW_ARTIFACT_UNAVAILABLE_TEXT);
  }

  let centralDirectoryOffset = 0;
  let centralDirectorySize = 0;
  for (const entry of entries) {
    const nameLength = entry.archivePathBytes.byteLength;
    if (
      nameLength === 0 ||
      nameLength > 0xffff ||
      !Number.isSafeInteger(entry.byteLength) ||
      entry.byteLength < 0 ||
      entry.byteLength >= ZIP32_SENTINEL
    ) {
      throw new SessionExportHttpError(501, RAW_ARTIFACT_UNAVAILABLE_TEXT);
    }

    centralDirectoryOffset += 30 + nameLength + entry.byteLength + 16;
    centralDirectorySize += 46 + nameLength;
    if (centralDirectoryOffset >= ZIP32_SENTINEL || centralDirectorySize >= ZIP32_SENTINEL) {
      throw new SessionExportHttpError(501, RAW_ARTIFACT_UNAVAILABLE_TEXT);
    }
  }

  const archiveByteLength = centralDirectoryOffset + centralDirectorySize + 22;
  if (archiveByteLength >= ZIP32_SENTINEL) {
    throw new SessionExportHttpError(501, RAW_ARTIFACT_UNAVAILABLE_TEXT);
  }
}

async function prepareSessionExport(
  query: ParsedSessionExportQuery,
  signal: AbortSignal,
  dependencies: SessionExportDependencies,
): Promise<PreparedSessionExport> {
  signal.throwIfAborted();
  const rawSessions = await dependencies.listRawSessions(signal);
  signal.throwIfAborted();
  const root = rawSessions.find((session) => session.id === query.sessionId);
  if (!root) {
    const knownSessionIds = await dependencies.listKnownSessionIds(signal);
    signal.throwIfAborted();
    if (knownSessionIds.includes(query.sessionId)) {
      throw new SessionExportHttpError(501, RAW_ARTIFACT_UNAVAILABLE_TEXT);
    }
    throw new SessionExportHttpError(404, SESSION_NOT_FOUND_TEXT);
  }

  const selected = collectExportSessions(root, rawSessions, query.includeDescendants);
  const usedDescendantSegments = new Set<string>();
  const entries: PreparedZipEntry[] = [];
  for (let index = 0; index < selected.length; index += 1) {
    signal.throwIfAborted();
    const session = selected[index];
    if (!session || session.path.length === 0) {
      throw new SessionExportHttpError(501, RAW_ARTIFACT_UNAVAILABLE_TEXT);
    }
    const archivePath =
      index === 0
        ? "session.jsonl"
        : `subagents/${allocateDescendantSegment(session.id, usedDescendantSegments)}/session.jsonl`;
    assertSafeArchivePath(archivePath);

    const sourcePath = normalizedSessionPath(session.path);
    const metadata = await dependencies.inspectRawArtifact(sourcePath, signal);
    signal.throwIfAborted();
    if (!metadata.regularFile) {
      throw new SessionExportHttpError(501, RAW_ARTIFACT_UNAVAILABLE_TEXT);
    }
    entries.push({
      archivePath,
      archivePathBytes: textEncoder.encode(archivePath),
      sourcePath,
      byteLength: metadata.byteLength,
    });
  }
  assertClassicZipCapacity(entries);

  return {
    filename: sessionExportZipFilename(query.sessionId),
    entries,
  };
}

function localFileHeader(pathBytes: Uint8Array): Uint8Array {
  const header = Buffer.allocUnsafe(30 + pathBytes.byteLength);
  header.writeUInt32LE(ZIP_LOCAL_FILE_HEADER_SIGNATURE, 0);
  header.writeUInt16LE(ZIP_VERSION_20, 4);
  header.writeUInt16LE(ZIP_DATA_DESCRIPTOR_FLAG, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(0, 18);
  header.writeUInt32LE(0, 22);
  header.writeUInt16LE(pathBytes.byteLength, 26);
  header.writeUInt16LE(0, 28);
  header.set(pathBytes, 30);
  return header;
}

function dataDescriptor(crc32: number, byteLength: number): Uint8Array {
  const descriptor = Buffer.allocUnsafe(16);
  descriptor.writeUInt32LE(ZIP_DATA_DESCRIPTOR_SIGNATURE, 0);
  descriptor.writeUInt32LE(crc32, 4);
  descriptor.writeUInt32LE(byteLength, 8);
  descriptor.writeUInt32LE(byteLength, 12);
  return descriptor;
}

function centralDirectoryEntry(entry: WrittenZipEntry): Uint8Array {
  const record = Buffer.allocUnsafe(46 + entry.archivePathBytes.byteLength);
  record.writeUInt32LE(ZIP_CENTRAL_DIRECTORY_SIGNATURE, 0);
  record.writeUInt16LE(ZIP_VERSION_20, 4);
  record.writeUInt16LE(ZIP_VERSION_20, 6);
  record.writeUInt16LE(ZIP_DATA_DESCRIPTOR_FLAG, 8);
  record.writeUInt16LE(0, 10);
  record.writeUInt16LE(0, 12);
  record.writeUInt16LE(0, 14);
  record.writeUInt32LE(entry.crc32, 16);
  record.writeUInt32LE(entry.byteLength, 20);
  record.writeUInt32LE(entry.byteLength, 24);
  record.writeUInt16LE(entry.archivePathBytes.byteLength, 28);
  record.writeUInt16LE(0, 30);
  record.writeUInt16LE(0, 32);
  record.writeUInt16LE(0, 34);
  record.writeUInt16LE(0, 36);
  record.writeUInt32LE(0, 38);
  record.writeUInt32LE(entry.localHeaderOffset, 42);
  record.set(entry.archivePathBytes, 46);
  return record;
}

function endOfCentralDirectory(
  entryCount: number,
  centralDirectorySize: number,
  centralDirectoryOffset: number,
): Uint8Array {
  const record = Buffer.allocUnsafe(22);
  record.writeUInt32LE(ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(entryCount, 8);
  record.writeUInt16LE(entryCount, 10);
  record.writeUInt32LE(centralDirectorySize, 12);
  record.writeUInt32LE(centralDirectoryOffset, 16);
  record.writeUInt16LE(0, 20);
  return record;
}

async function* sessionExportZipChunks(
  prepared: PreparedSessionExport,
  signal: AbortSignal,
  dependencies: SessionExportDependencies,
): AsyncGenerator<Uint8Array> {
  const written: WrittenZipEntry[] = [];
  let offset = 0;

  for (const entry of prepared.entries) {
    signal.throwIfAborted();
    const header = localFileHeader(entry.archivePathBytes);
    const localHeaderOffset = offset;
    offset += header.byteLength;
    yield header;

    let crc = 0xffffffff;
    let byteLength = 0;
    for await (const chunk of dependencies.readRawArtifact(entry.sourcePath, signal)) {
      signal.throwIfAborted();
      if (!(chunk instanceof Uint8Array)) {
        throw new Error("raw artifact reader produced a non-binary chunk");
      }
      byteLength += chunk.byteLength;
      if (byteLength > entry.byteLength || byteLength >= ZIP32_SENTINEL) {
        throw new Error("raw artifact changed while it was exported");
      }
      crc = updateCrc32(crc, chunk);
      offset += chunk.byteLength;
      yield chunk;
    }
    signal.throwIfAborted();
    if (byteLength !== entry.byteLength) {
      throw new Error("raw artifact changed while it was exported");
    }

    const finalizedCrc = (crc ^ 0xffffffff) >>> 0;
    const descriptor = dataDescriptor(finalizedCrc, byteLength);
    offset += descriptor.byteLength;
    yield descriptor;
    written.push({
      archivePathBytes: entry.archivePathBytes,
      crc32: finalizedCrc,
      byteLength,
      localHeaderOffset,
    });
  }

  const centralDirectoryOffset = offset;
  for (const entry of written) {
    signal.throwIfAborted();
    const record = centralDirectoryEntry(entry);
    offset += record.byteLength;
    yield record;
  }
  const centralDirectorySize = offset - centralDirectoryOffset;
  yield endOfCentralDirectory(written.length, centralDirectorySize, centralDirectoryOffset);
}

function normalizeStreamError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function streamSessionExportZip(
  prepared: PreparedSessionExport,
  requestSignal: AbortSignal,
  dependencies: SessionExportDependencies,
): ReadableStream<Uint8Array> {
  const consumerAbort = new AbortController();
  const producerSignal = AbortSignal.any([requestSignal, consumerAbort.signal]);
  const iterator = sessionExportZipChunks(prepared, producerSignal, dependencies);

  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const next = await iterator.next();
          if (next.done) controller.close();
          else controller.enqueue(next.value);
        } catch (error) {
          controller.error(normalizeStreamError(error));
        }
      },
      async cancel(reason) {
        consumerAbort.abort(
          reason instanceof Error ? reason : new Error("session log export stream cancelled"),
        );
        try {
          await iterator.return(undefined);
        } catch {
          // Cancellation already owns the externally-observable stream result.
        }
      },
    },
    {
      highWaterMark: RESPONSE_HIGH_WATER_MARK_BYTES,
      size: (chunk) => chunk.byteLength,
    },
  );
}

async function defaultInspectRawArtifact(
  path: string,
  signal: AbortSignal,
): Promise<SessionExportRawArtifactMetadata> {
  signal.throwIfAborted();
  const handle = await open(path, "r");
  try {
    signal.throwIfAborted();
    const stats = await handle.stat();
    signal.throwIfAborted();
    return { byteLength: stats.size, regularFile: stats.isFile() };
  } finally {
    await handle.close();
  }
}

async function* defaultReadRawArtifact(
  path: string,
  signal: AbortSignal,
): AsyncGenerator<Uint8Array> {
  signal.throwIfAborted();
  const stream = createReadStream(path, {
    highWaterMark: RAW_READ_CHUNK_BYTES,
    signal,
  });
  try {
    for await (const chunk of stream) {
      yield chunk as Buffer;
    }
  } finally {
    stream.destroy();
  }
}

const defaultSessionExportDependencies: SessionExportDependencies = {
  async listRawSessions(signal) {
    signal.throwIfAborted();
    const sessions: SessionInfo[] = await SessionManager.listAll();
    signal.throwIfAborted();
    return sessions;
  },
  async listKnownSessionIds(signal) {
    signal.throwIfAborted();
    const result = await listSessions();
    signal.throwIfAborted();
    return result.sessions.map((session) => session.id);
  },
  inspectRawArtifact: defaultInspectRawArtifact,
  readRawArtifact: defaultReadRawArtifact,
};

function bodylessResponse(response: Response): Response {
  void response.body?.cancel();
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function requestResponse(request: Request, response: Response): Response {
  return request.method === "HEAD" ? bodylessResponse(response) : response;
}

function textErrorResponse(request: Request, status: number, message: string): Response {
  return requestResponse(request, new Response(message, { status }));
}

export async function handleSessionExportRequest(
  request: Request,
  dependencies: SessionExportDependencies = defaultSessionExportDependencies,
): Promise<Response> {
  const rejected = rejectUntrustedApiRequest(request);
  if (rejected) return requestResponse(request, rejected);

  const query = parseSessionExportQuery(request);
  if (!query) return textErrorResponse(request, 400, INVALID_QUERY_TEXT);

  let prepared: PreparedSessionExport;
  try {
    prepared = await prepareSessionExport(query, request.signal, dependencies);
  } catch (error) {
    request.signal.throwIfAborted();
    if (error instanceof SessionExportHttpError) {
      return textErrorResponse(request, error.status, error.message);
    }
    return textErrorResponse(request, 500, EXPORT_PREPARATION_FAILED_TEXT);
  }

  const headers = new Headers({
    "content-type": "application/zip",
    "content-disposition": `attachment; filename="${prepared.filename}"`,
  });
  if (request.method === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(streamSessionExportZip(prepared, request.signal, dependencies), {
    status: 200,
    headers,
  });
}
