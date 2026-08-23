import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

import { rejectUntrustedApiRequest } from "../transport/api-request-guard";
import { getWorkspaceStore } from "./workspace-registry";
import {
  WORKSPACE_FILE_PREVIEW_SIZE_LIMIT,
  WorkspaceFileError,
  WorkspaceFileService,
  type ResolvedWorkspaceFileContent,
} from "./workspace-files";

const INVALID_QUERY_TEXT = "missing or invalid workspace file query parameters";
const FILE_NOT_FOUND_TEXT = "workspace file not found";
const FILE_TOO_LARGE_TEXT = "workspace file is too large to preview";
const FILE_PREPARATION_FAILED_TEXT = "workspace file preview failed to prepare";

interface ByteRange {
  start: number;
  end: number;
}

export interface WorkspaceFileContentDependencies {
  resolveFile(
    input: { workspaceId: string; relativePath: string },
    signal: AbortSignal,
  ): Promise<ResolvedWorkspaceFileContent>;
  createStream(
    canonicalPath: string,
    range: ByteRange,
    signal: AbortSignal,
  ): ReadableStream<Uint8Array>;
}

const workspaceFileService = new WorkspaceFileService({ workspaceStore: getWorkspaceStore });

const defaultDependencies: WorkspaceFileContentDependencies = {
  resolveFile: (input, signal) => workspaceFileService.resolveFileContent(input, signal),
  createStream: (canonicalPath, range, signal) =>
    Readable.toWeb(
      createReadStream(canonicalPath, {
        start: range.start,
        end: range.end,
        signal,
      }),
    ) as ReadableStream<Uint8Array>,
};

function parseQuery(request: Request): { workspaceId: string; relativePath: string } | undefined {
  const searchParams = new URL(request.url).searchParams;
  for (const key of searchParams.keys()) {
    if (key !== "workspaceId" && key !== "relativePath") return undefined;
  }
  const workspaceIds = searchParams.getAll("workspaceId");
  const relativePaths = searchParams.getAll("relativePath");
  if (
    workspaceIds.length !== 1 ||
    relativePaths.length !== 1 ||
    !workspaceIds[0] ||
    !relativePaths[0]
  ) {
    return undefined;
  }
  return { workspaceId: workspaceIds[0], relativePath: relativePaths[0] };
}

function parseRange(value: string | null, size: number): ByteRange | undefined | null {
  if (value === null) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size === 0) return null;

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  ) {
    return null;
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}

function safeAsciiFilename(filename: string): string {
  return filename.replace(/[\r\n"\\]/g, "_").replace(/[^\x20-\x7e]/g, "_") || "file";
}

function encodedFilename(filename: string): string {
  return encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function contentDisposition(filename: string): string {
  return `inline; filename="${safeAsciiFilename(filename)}"; filename*=UTF-8''${encodedFilename(filename)}`;
}

function requestResponse(request: Request, response: Response): Response {
  if (request.method !== "HEAD") return response;
  return new Response(null, { status: response.status, headers: response.headers });
}

function textErrorResponse(request: Request, status: number, message: string): Response {
  return requestResponse(request, new Response(message, { status }));
}

function errorResponse(request: Request, error: unknown): Response {
  if (!(error instanceof WorkspaceFileError)) {
    return textErrorResponse(request, 500, FILE_PREPARATION_FAILED_TEXT);
  }
  if (error.code === "workspace-file-too-large") {
    return textErrorResponse(request, 413, FILE_TOO_LARGE_TEXT);
  }
  if (
    error.code === "workspace-not-found" ||
    error.code === "workspace-path-outside-root" ||
    error.code === "workspace-path-unreadable" ||
    error.code === "workspace-file-not-found" ||
    error.code === "workspace-file-not-regular"
  ) {
    return textErrorResponse(request, 404, FILE_NOT_FOUND_TEXT);
  }
  return textErrorResponse(request, 500, FILE_PREPARATION_FAILED_TEXT);
}

function matchesEtag(ifNoneMatch: string | null, etag: string): boolean {
  return (
    ifNoneMatch?.split(",").some((value) => value.trim() === etag || value.trim() === "*") ?? false
  );
}

export async function handleWorkspaceFileContentRequest(
  request: Request,
  dependencies: WorkspaceFileContentDependencies = defaultDependencies,
): Promise<Response> {
  const rejected = rejectUntrustedApiRequest(request);
  if (rejected) return requestResponse(request, rejected);

  const query = parseQuery(request);
  if (!query) return textErrorResponse(request, 400, INVALID_QUERY_TEXT);

  let file: ResolvedWorkspaceFileContent;
  try {
    file = await dependencies.resolveFile(query, request.signal);
    request.signal.throwIfAborted();
  } catch (error) {
    request.signal.throwIfAborted();
    return errorResponse(request, error);
  }

  if (file.size > WORKSPACE_FILE_PREVIEW_SIZE_LIMIT) {
    return textErrorResponse(request, 413, FILE_TOO_LARGE_TEXT);
  }

  const etag = `"${file.version}"`;
  const range = parseRange(request.headers.get("range"), file.size);
  if (range === null) {
    return requestResponse(
      request,
      new Response("requested range is not satisfiable", {
        status: 416,
        headers: { "content-range": `bytes */${file.size}` },
      }),
    );
  }
  if (range === undefined && matchesEtag(request.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers: { etag } });
  }

  const selectedRange = range ?? { start: 0, end: Math.max(0, file.size - 1) };
  const contentLength = file.size === 0 ? 0 : selectedRange.end - selectedRange.start + 1;
  const headers = new Headers({
    "accept-ranges": "bytes",
    "cache-control": "private, no-cache",
    "content-disposition": contentDisposition(file.name),
    "content-length": String(contentLength),
    "content-type": file.mediaType,
    etag,
    "last-modified": new Date(file.modifiedAt).toUTCString(),
    "x-content-type-options": "nosniff",
  });
  const status = range ? 206 : 200;
  if (range) headers.set("content-range", `bytes ${range.start}-${range.end}/${file.size}`);
  if (request.method === "HEAD" || file.size === 0) {
    return new Response(null, { status, headers });
  }
  return new Response(
    dependencies.createStream(file.canonicalPath, selectedRange, request.signal),
    { status, headers },
  );
}
