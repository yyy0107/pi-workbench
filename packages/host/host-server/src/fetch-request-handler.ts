import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

export type RuntimeFetchHandler = (request: Request) => Response | Promise<Response>;

export type RuntimeRequestOrigin = string | ((request: IncomingMessage) => string);

export interface FetchRequestHandlerOptions {
  readonly fetchHandler: RuntimeFetchHandler;
  /** Resolves the already-trusted public origin used to absolutize Node request-targets. */
  readonly origin: RuntimeRequestOrigin;
}

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value.join(",") : value;
}

function connectionHeaderNames(value: string | null | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isHopByHopHeader(name: string, connectionNames: ReadonlySet<string>): boolean {
  const normalized = name.toLowerCase();
  return HOP_BY_HOP_HEADERS.has(normalized) || connectionNames.has(normalized);
}

function isHostOwnedCorsResponseHeader(name: string): boolean {
  return name.toLowerCase().startsWith("access-control-");
}

function fetchRequestHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  const connectionNames = connectionHeaderNames(headerValue(request.headers, "connection"));
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || isHopByHopHeader(name, connectionNames)) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.append(name, value);
    }
  }
  return headers;
}

function trustedRequestUrl(request: IncomingMessage, origin: string): URL {
  const trustedOrigin = new URL(origin);
  if (
    (trustedOrigin.protocol !== "http:" && trustedOrigin.protocol !== "https:") ||
    trustedOrigin.username ||
    trustedOrigin.password ||
    trustedOrigin.pathname !== "/" ||
    trustedOrigin.search ||
    trustedOrigin.hash ||
    trustedOrigin.origin !== origin
  ) {
    throw new TypeError("Invalid trusted Runtime request origin.");
  }

  const url = new URL(request.url ?? "/", trustedOrigin);
  if (url.origin !== trustedOrigin.origin || url.username || url.password || url.hash) {
    throw new TypeError("Runtime request target escaped the trusted origin.");
  }
  return url;
}

function fetchRequest(request: IncomingMessage, origin: string, signal: AbortSignal): Request {
  const method = request.method ?? "GET";
  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers: fetchRequestHeaders(request),
    signal,
  };
  if (method !== "GET" && method !== "HEAD") {
    init.body = Readable.toWeb(request) as ReadableStream<Uint8Array>;
    init.duplex = "half";
  }
  return new Request(trustedRequestUrl(request, origin), init);
}

function responseHasNoBody(method: string | undefined, status: number): boolean {
  return method === "HEAD" || (status >= 100 && status < 200) || status === 204 || status === 304;
}

function headerValues(value: number | string | readonly string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? [...value] : [String(value)];
}

function mergeVaryHeader(response: ServerResponse, value: string): void {
  const values = [...headerValues(response.getHeader("Vary")), value]
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
  const merged: string[] = [];
  for (const candidate of values) {
    if (!merged.some((current) => current.toLowerCase() === candidate.toLowerCase())) {
      merged.push(candidate);
    }
  }
  if (merged.length > 0) response.setHeader("Vary", merged.join(", "));
}

function applyFetchResponseHeaders(fetchResponse: Response, response: ServerResponse): void {
  const connectionNames = connectionHeaderNames(fetchResponse.headers.get("connection"));
  const setCookies = fetchResponse.headers.getSetCookie();
  for (const [name, value] of fetchResponse.headers) {
    if (
      name === "set-cookie" ||
      isHostOwnedCorsResponseHeader(name) ||
      isHopByHopHeader(name, connectionNames)
    ) {
      continue;
    }
    if (name === "vary") {
      mergeVaryHeader(response, value);
      continue;
    }
    if (response.hasHeader(name)) continue;
    response.setHeader(name, value);
  }
  if (setCookies.length > 0) {
    response.setHeader("Set-Cookie", [
      ...headerValues(response.getHeader("Set-Cookie")),
      ...setCookies,
    ]);
  }
}

async function cancelUnusedBody(fetchResponse: Response): Promise<void> {
  if (!fetchResponse.body) return;
  await fetchResponse.body.cancel().catch(() => undefined);
}

export async function writeFetchResponseToNode(
  request: Pick<IncomingMessage, "method">,
  fetchResponse: Response,
  response: ServerResponse,
): Promise<void> {
  if (response.destroyed || response.writableEnded) {
    await cancelUnusedBody(fetchResponse);
    return;
  }

  response.statusCode = fetchResponse.status;
  if (fetchResponse.statusText) response.statusMessage = fetchResponse.statusText;
  applyFetchResponseHeaders(fetchResponse, response);

  if (responseHasNoBody(request.method, fetchResponse.status) || !fetchResponse.body) {
    await cancelUnusedBody(fetchResponse);
    response.end();
    return;
  }

  // Flush before the first chunk so event streams and other delayed bodies expose headers promptly.
  response.flushHeaders();
  const body = Readable.fromWeb(fetchResponse.body as unknown as NodeReadableStream);
  await pipeline(body, response);
}

function safeAbort(controller: AbortController, reason: unknown): void {
  if (!controller.signal.aborted) controller.abort(reason);
}

function sendBadRequest(request: IncomingMessage, response: ServerResponse): void {
  request.resume();
  response.statusCode = 400;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength("Bad Request"));
  response.end("Bad Request");
}

/**
 * Adapts Node HTTP streams to the Fetch API without buffering either direction.
 * The owning ingress must supply a trusted origin after applying its authority/authentication fence.
 */
export function createFetchRequestHandler({
  fetchHandler,
  origin,
}: FetchRequestHandlerOptions): (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void> {
  return async (request, response) => {
    const abortController = new AbortController();
    const onAborted = () => safeAbort(abortController, new Error("Runtime request was aborted."));
    const onRequestError = (error: Error) => safeAbort(abortController, error);
    const onResponseClose = () => {
      if (!response.writableFinished) {
        safeAbort(abortController, new Error("Runtime response connection closed."));
      }
    };
    request.once("aborted", onAborted);
    request.once("error", onRequestError);
    response.once("close", onResponseClose);

    let webRequest: Request;
    try {
      webRequest = fetchRequest(
        request,
        typeof origin === "function" ? origin(request) : origin,
        abortController.signal,
      );
    } catch {
      sendBadRequest(request, response);
      request.off("aborted", onAborted);
      request.off("error", onRequestError);
      response.off("close", onResponseClose);
      return;
    }

    try {
      const fetchResponse = await fetchHandler(webRequest);
      if (!(fetchResponse instanceof Response)) {
        throw new TypeError("Runtime Fetch handler must return a Response.");
      }
      await writeFetchResponseToNode(request, fetchResponse, response);
    } catch (error) {
      if (!abortController.signal.aborted || (!response.destroyed && response.writable))
        throw error;
    } finally {
      if (!request.complete && !request.destroyed) request.resume();
      request.off("aborted", onAborted);
      request.off("error", onRequestError);
      response.off("close", onResponseClose);
    }
  };
}
