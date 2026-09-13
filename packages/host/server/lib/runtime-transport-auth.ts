import { timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";

import {
  RUNTIME_CONNECTION_PROTOCOL_VERSION,
  RuntimeWebSocketAuthenticationErrorCode,
  RuntimeWebSocketCloseCode,
  createRuntimeWebSocketAuthenticatedFrame,
  createRuntimeWebSocketAuthenticationErrorFrame,
  parseRuntimeWebSocketAuthenticateFrame,
  type RuntimeWebSocketCloseCode as RuntimeWebSocketCloseCodeValue,
} from "@workbench/host-contracts";

const DEFAULT_AUTHENTICATION_TIMEOUT_MS = 5_000;
const MAX_AUTHENTICATION_FRAME_BYTES = 16 * 1024;
const CORS_ALLOWED_METHODS = "GET, HEAD, POST, PATCH, DELETE, OPTIONS";
const CORS_ALLOWED_HEADERS = "Authorization, Content-Type";
const CORS_ALLOWED_REQUEST_HEADERS = new Set(["authorization", "content-type"]);
const CORS_ALLOWED_REQUEST_METHODS = new Set(["GET", "HEAD", "POST", "PATCH", "DELETE"]);

export interface DesktopSidecarRuntimeAuthPolicy {
  readonly kind: "desktop-sidecar";
  readonly protocolVersion: typeof RUNTIME_CONNECTION_PROTOCOL_VERSION;
  readonly instanceId: string;
  readonly accessToken: string;
  readonly allowedOrigins: readonly string[];
  readonly webSocketAuthenticationTimeoutMs: number;
}

export interface DesktopSidecarRuntimeAuthPolicyInput {
  readonly instanceId: string;
  readonly accessToken: string;
  readonly allowedOrigins: readonly string[];
  readonly webSocketAuthenticationTimeoutMs?: number;
}

function isCredentialSafeString(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 32 || codePoint === 127);
    })
  );
}

function canonicalRendererOrigin(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) return undefined;
  if (value === "*" || value === "null" || /[\r\n]/u.test(value)) return undefined;

  try {
    const parsed = new URL(value);
    if (
      !parsed.protocol ||
      !parsed.host ||
      parsed.username ||
      parsed.password ||
      (parsed.pathname !== "" && parsed.pathname !== "/") ||
      parsed.search ||
      parsed.hash
    ) {
      return undefined;
    }
    return parsed.origin === "null" ? `${parsed.protocol}//${parsed.host}` : parsed.origin;
  } catch {
    return undefined;
  }
}

/** Defines one immutable in-memory sidecar security policy without echoing bad input. */
export function defineDesktopSidecarRuntimeAuthPolicy(
  input: DesktopSidecarRuntimeAuthPolicyInput,
): DesktopSidecarRuntimeAuthPolicy {
  const timeout = input.webSocketAuthenticationTimeoutMs ?? DEFAULT_AUTHENTICATION_TIMEOUT_MS;
  const allowedOrigins = input.allowedOrigins.map(canonicalRendererOrigin);
  if (
    !isCredentialSafeString(input.instanceId, 512) ||
    !isCredentialSafeString(input.accessToken, 8_192) ||
    input.allowedOrigins.length === 0 ||
    allowedOrigins.some((origin) => origin === undefined) ||
    new Set(allowedOrigins).size !== allowedOrigins.length ||
    !Number.isSafeInteger(timeout) ||
    timeout <= 0 ||
    timeout > 30_000
  ) {
    throw new Error("Invalid desktop-sidecar Runtime authentication policy.");
  }

  return Object.freeze({
    kind: "desktop-sidecar",
    protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
    instanceId: input.instanceId,
    accessToken: input.accessToken,
    allowedOrigins: Object.freeze(allowedOrigins as string[]),
    webSocketAuthenticationTimeoutMs: timeout,
  });
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? undefined : value;
}

function isAllowedOrigin(origin: string | undefined, policy: DesktopSidecarRuntimeAuthPolicy) {
  return origin !== undefined && policy.allowedOrigins.includes(origin);
}

function secretsEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

/**
 * Two independently canonicalized policy values may guard the listener and
 * the injected business gateway. Compare the complete authority boundary so
 * cloning a policy cannot accidentally fall back to browser-visible
 * first-frame authentication, while any configuration drift still fails
 * closed.
 */
function equivalentDesktopRuntimeWebSocketPolicies(
  authorized: DesktopSidecarRuntimeAuthPolicy,
  consuming: DesktopSidecarRuntimeAuthPolicy,
): boolean {
  return (
    authorized.kind === consuming.kind &&
    authorized.protocolVersion === consuming.protocolVersion &&
    authorized.instanceId === consuming.instanceId &&
    secretsEqual(authorized.accessToken, consuming.accessToken) &&
    authorized.webSocketAuthenticationTimeoutMs === consuming.webSocketAuthenticationTimeoutMs &&
    authorized.allowedOrigins.length === consuming.allowedOrigins.length &&
    authorized.allowedOrigins.every((origin, index) => origin === consuming.allowedOrigins[index])
  );
}

function bearerToken(headers: IncomingHttpHeaders): string | undefined {
  const authorization = headerValue(headers, "authorization");
  const match = authorization?.match(/^Bearer ([^\s,]+)$/iu);
  return match?.[1];
}

export type DesktopRuntimeHttpAuthorization =
  | { readonly kind: "authorized"; readonly origin?: string }
  | { readonly kind: "preflight"; readonly origin: string }
  | { readonly kind: "rejected"; readonly status: 400 | 401 | 403; readonly origin?: string };

/** Authorizes an API request before it reaches an injected application handler. */
export function authorizeDesktopRuntimeHttpRequest(
  request: Pick<IncomingMessage, "headers" | "method">,
  policy: DesktopSidecarRuntimeAuthPolicy,
): DesktopRuntimeHttpAuthorization {
  const origin = headerValue(request.headers, "origin");
  const preflightMethod = headerValue(request.headers, "access-control-request-method");
  if (request.method === "OPTIONS" && preflightMethod !== undefined) {
    if (!isAllowedOrigin(origin, policy)) return { kind: "rejected", status: 403 };
    const requestedMethod = preflightMethod.toUpperCase();
    const requestedHeaders = (headerValue(request.headers, "access-control-request-headers") ?? "")
      .split(",")
      .map((header) => header.trim().toLowerCase())
      .filter(Boolean);
    if (
      !CORS_ALLOWED_REQUEST_METHODS.has(requestedMethod) ||
      requestedHeaders.some((header) => !CORS_ALLOWED_REQUEST_HEADERS.has(header))
    ) {
      return { kind: "rejected", status: 400, origin: origin! };
    }
    return { kind: "preflight", origin: origin! };
  }

  if (origin !== undefined && !isAllowedOrigin(origin, policy)) {
    return { kind: "rejected", status: 403 };
  }
  const token = bearerToken(request.headers);
  if (!token || !secretsEqual(token, policy.accessToken)) {
    return origin === undefined
      ? { kind: "rejected", status: 401 }
      : { kind: "rejected", status: 401, origin };
  }
  return origin === undefined ? { kind: "authorized" } : { kind: "authorized", origin };
}

function appendVary(response: ServerResponse, value: string): void {
  const current = response.getHeader("Vary");
  const values = (Array.isArray(current) ? current : current === undefined ? [] : [String(current)])
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!values.some((entry) => entry.toLowerCase() === value.toLowerCase())) values.push(value);
  response.setHeader("Vary", values.join(", "));
}

export function applyDesktopRuntimeCorsHeaders(response: ServerResponse, origin: string): void {
  response.setHeader("Access-Control-Allow-Origin", origin);
  appendVary(response, "Origin");
}

export function sendDesktopRuntimePreflight(response: ServerResponse, origin: string): void {
  response.statusCode = 204;
  applyDesktopRuntimeCorsHeaders(response, origin);
  response.setHeader("Access-Control-Allow-Methods", CORS_ALLOWED_METHODS);
  response.setHeader("Access-Control-Allow-Headers", CORS_ALLOWED_HEADERS);
  response.setHeader("Access-Control-Max-Age", "600");
  appendVary(response, "Access-Control-Request-Method");
  appendVary(response, "Access-Control-Request-Headers");
  response.setHeader("Content-Length", "0");
  response.end();
}

export function sendDesktopRuntimeAuthorizationFailure(
  response: ServerResponse,
  status: 400 | 401 | 403,
): void {
  const body = status === 400 ? "Bad Request" : status === 401 ? "Unauthorized" : "Forbidden";
  response.statusCode = status;
  if (status === 401) response.setHeader("WWW-Authenticate", "Bearer");
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}

function rewriteRawHeaders(request: IncomingMessage, host: string | undefined): void {
  const rawHeaders = request.rawHeaders as string[];
  if (!Array.isArray(rawHeaders)) return;
  const retained: string[] = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const value = rawHeaders[index + 1];
    if (!name || value === undefined) continue;
    const normalized = name.toLowerCase();
    if (
      normalized === "authorization" ||
      normalized === "origin" ||
      normalized === "sec-fetch-site"
    ) {
      continue;
    }
    retained.push(name, value);
  }
  if (host) retained.push("Origin", `http://${host}`, "Sec-Fetch-Site", "same-origin");
  rawHeaders.splice(0, rawHeaders.length, ...retained);
}

/**
 * Removes the bearer before an injected handler can construct a Request or log it, then marks
 * this already-authorized loopback request as same-origin for the existing API
 * DNS-rebinding fence. The original renderer origin is retained only in CORS
 * response headers set before this function is called.
 */
export function canonicalizeAuthorizedDesktopRuntimeRequest(request: IncomingMessage): void {
  const host = headerValue(request.headers, "host");
  delete request.headers.authorization;
  delete request.headers.origin;
  delete request.headers["sec-fetch-site"];
  if (host) {
    request.headers.origin = `http://${host}`;
    request.headers["sec-fetch-site"] = "same-origin";
  }
  rewriteRawHeaders(request, host);
}

export function isAllowedDesktopRuntimeWebSocketUpgrade(
  request: Pick<IncomingMessage, "headers">,
  policy: DesktopSidecarRuntimeAuthPolicy,
): boolean {
  return isAllowedOrigin(headerValue(request.headers, "origin"), policy);
}

declare const desktopRuntimeWebSocketUpgradeAuthorizationBrand: unique symbol;

/**
 * An opaque, one-use capability issued only after a sidecar Bearer has been
 * verified on one particular HTTP Upgrade request. It is deliberately not a
 * wire value: a browser cannot construct, serialize, or replay it.
 */
export interface DesktopRuntimeWebSocketUpgradeAuthorization {
  readonly [desktopRuntimeWebSocketUpgradeAuthorizationBrand]: true;
}

export type DesktopRuntimeWebSocketUpgradeAdmission =
  | { readonly kind: "legacy" }
  | {
      readonly kind: "preauthorized";
      readonly authorization: DesktopRuntimeWebSocketUpgradeAuthorization;
    }
  | { readonly kind: "rejected" };

interface DesktopRuntimeWebSocketUpgradeAuthorizationBinding {
  readonly request: IncomingMessage;
  readonly policy: DesktopSidecarRuntimeAuthPolicy;
}

const desktopRuntimeWebSocketUpgradeAuthorizationBindings = new WeakMap<
  object,
  DesktopRuntimeWebSocketUpgradeAuthorizationBinding
>();
const preauthorizedDesktopRuntimeWebSocketUpgradeRequests = new WeakMap<
  object,
  DesktopSidecarRuntimeAuthPolicy
>();

function hasAuthorizationHeader(request: Pick<IncomingMessage, "headers">): boolean {
  return Object.prototype.hasOwnProperty.call(request.headers, "authorization");
}

/**
 * Preserves direct-desktop first-frame authentication while admitting a
 * trusted in-process proxy's validated HTTP Bearer upgrade. An Authorization
 * header, when present, is fail-closed; its absence is the legacy path.
 */
export function authorizeDesktopRuntimeWebSocketUpgrade(
  request: Pick<IncomingMessage, "headers" | "method">,
  policy: DesktopSidecarRuntimeAuthPolicy,
): DesktopRuntimeWebSocketUpgradeAdmission {
  if (
    (request.method !== undefined && request.method !== "GET") ||
    !isAllowedDesktopRuntimeWebSocketUpgrade(request, policy)
  ) {
    return Object.freeze({ kind: "rejected" });
  }
  if (!hasAuthorizationHeader(request)) return Object.freeze({ kind: "legacy" });

  const authorization = authorizeDesktopRuntimeHttpRequest(request, policy);
  if (authorization.kind !== "authorized") return Object.freeze({ kind: "rejected" });

  const capability = Object.freeze({}) as DesktopRuntimeWebSocketUpgradeAuthorization;
  desktopRuntimeWebSocketUpgradeAuthorizationBindings.set(capability, {
    request: request as IncomingMessage,
    policy,
  });
  return Object.freeze({ kind: "preauthorized", authorization: capability });
}

/**
 * Binds an already-issued Upgrade capability to its original request. The
 * binding is consumed here, so capabilities cannot authorize another request
 * or be replayed after an Upgrade dispatch attempt.
 */
export function applyDesktopRuntimeWebSocketUpgradeAuthorization(
  request: IncomingMessage,
  authorization: DesktopRuntimeWebSocketUpgradeAuthorization,
): boolean {
  const binding = desktopRuntimeWebSocketUpgradeAuthorizationBindings.get(authorization);
  desktopRuntimeWebSocketUpgradeAuthorizationBindings.delete(authorization);
  if (!binding || binding.request !== request) return false;
  // Revalidate the issued policy's origin on the still-bound request so a
  // caller cannot mutate headers between authorization and application.
  if (!binding.policy.allowedOrigins.includes(headerValue(request.headers, "origin") ?? "")) {
    return false;
  }
  preauthorizedDesktopRuntimeWebSocketUpgradeRequests.set(request, binding.policy);
  return true;
}

function consumeDesktopRuntimeWebSocketUpgradeAuthorization(
  request: unknown,
  policy: DesktopSidecarRuntimeAuthPolicy,
): boolean {
  if (typeof request !== "object" || request === null) return false;
  const authorizedPolicy = preauthorizedDesktopRuntimeWebSocketUpgradeRequests.get(request);
  preauthorizedDesktopRuntimeWebSocketUpgradeRequests.delete(request);
  if (!authorizedPolicy || !equivalentDesktopRuntimeWebSocketPolicies(authorizedPolicy, policy)) {
    return false;
  }
  return true;
}

type AuthenticationListener = (...arguments_: unknown[]) => void;

interface RuntimeAuthenticationWebSocket {
  once(event: "message" | "close" | "error", listener: AuthenticationListener): unknown;
  off(event: "message" | "close" | "error", listener: AuthenticationListener): unknown;
  send(data: string, callback?: (error?: Error) => void): void;
  close(code?: number, reason?: string): void;
}

export interface RuntimeAuthenticationTimers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(timer: unknown): void;
}

export interface RuntimeWebSocketAuthenticationAdmission {
  /** Returns an idempotent release callback, or undefined when capacity is exhausted. */
  acquire(): (() => void) | undefined;
}

export function createRuntimeWebSocketAuthenticationAdmission(
  maximumPendingAuthentications = 64,
): RuntimeWebSocketAuthenticationAdmission {
  if (!Number.isSafeInteger(maximumPendingAuthentications) || maximumPendingAuthentications < 1) {
    throw new Error("Runtime WebSocket authentication capacity must be a positive integer.");
  }
  let pendingAuthentications = 0;
  return Object.freeze({
    acquire() {
      if (pendingAuthentications >= maximumPendingAuthentications) return undefined;
      pendingAuthentications += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        pendingAuthentications -= 1;
      };
    },
  });
}

const runtimeAuthenticationTimers: RuntimeAuthenticationTimers = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (timer) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export interface NoServerWebSocketServerLike<Request, Socket, Head, WebSocket> {
  handleUpgrade(
    request: Request,
    socket: Socket,
    head: Head,
    callback: (webSocket: WebSocket, request: Request) => void,
  ): void;
}

export interface AuthenticatedNoServerWebSocketServerOptions<Request, Socket, Head, WebSocket> {
  readonly webSocketServer: NoServerWebSocketServerLike<Request, Socket, Head, WebSocket>;
  readonly authPolicy?: DesktopSidecarRuntimeAuthPolicy;
  readonly authenticationAdmission?: RuntimeWebSocketAuthenticationAdmission;
  readonly timers?: RuntimeAuthenticationTimers;
  readonly onUnexpectedError?: (error: unknown) => void;
}

function authenticationFrameText(raw: unknown, isBinary: unknown): string | undefined {
  if (isBinary === true) return undefined;
  let bytes: Buffer;
  if (typeof raw === "string") bytes = Buffer.from(raw);
  else if (Buffer.isBuffer(raw)) bytes = raw;
  else if (raw instanceof ArrayBuffer) bytes = Buffer.from(raw);
  else if (Array.isArray(raw) && raw.every((part) => Buffer.isBuffer(part))) {
    bytes = Buffer.concat(raw);
  } else return undefined;
  return bytes.byteLength <= MAX_AUTHENTICATION_FRAME_BYTES ? bytes.toString("utf8") : undefined;
}

function closeReason(code: RuntimeWebSocketCloseCodeValue): string {
  switch (code) {
    case RuntimeWebSocketCloseCode.invalidAuthenticationFrame:
      return "Runtime WebSocket authentication frame is invalid.";
    case RuntimeWebSocketCloseCode.authenticationFailed:
      return "Runtime WebSocket authentication failed.";
    case RuntimeWebSocketCloseCode.authenticationTimeout:
      return "Runtime WebSocket authentication timed out.";
    case RuntimeWebSocketCloseCode.protocolVersionMismatch:
      return "Runtime WebSocket protocol version is incompatible.";
  }
}

function closeCodeForError(
  code: RuntimeWebSocketAuthenticationErrorCode,
): RuntimeWebSocketCloseCodeValue {
  switch (code) {
    case RuntimeWebSocketAuthenticationErrorCode.invalidFrame:
      return RuntimeWebSocketCloseCode.invalidAuthenticationFrame;
    case RuntimeWebSocketAuthenticationErrorCode.authenticationFailed:
      return RuntimeWebSocketCloseCode.authenticationFailed;
    case RuntimeWebSocketAuthenticationErrorCode.authenticationTimedOut:
      return RuntimeWebSocketCloseCode.authenticationTimeout;
    case RuntimeWebSocketAuthenticationErrorCode.protocolVersionMismatch:
      return RuntimeWebSocketCloseCode.protocolVersionMismatch;
  }
}

/**
 * Decorates a no-server WebSocket upgrade so business callbacks cannot run
 * until a desktop sidecar has authenticated. Same-origin mode returns the
 * original server unchanged.
 */
export function createAuthenticatedNoServerWebSocketServer<Request, Socket, Head, WebSocket>(
  options: AuthenticatedNoServerWebSocketServerOptions<Request, Socket, Head, WebSocket>,
): NoServerWebSocketServerLike<Request, Socket, Head, WebSocket> {
  if (!options.authPolicy) return options.webSocketServer;
  const policy = options.authPolicy;
  const timers = options.timers ?? runtimeAuthenticationTimers;
  const authenticationAdmission =
    options.authenticationAdmission ?? createRuntimeWebSocketAuthenticationAdmission();

  return {
    handleUpgrade(request, socket, head, callback) {
      options.webSocketServer.handleUpgrade(request, socket, head, (webSocket, upgradedRequest) => {
        const authenticationSocket = webSocket as RuntimeAuthenticationWebSocket;
        if (
          options.authPolicy &&
          consumeDesktopRuntimeWebSocketUpgradeAuthorization(upgradedRequest, options.authPolicy)
        ) {
          try {
            callback(webSocket, upgradedRequest);
          } catch (callbackError) {
            options.onUnexpectedError?.(callbackError);
            try {
              authenticationSocket.close(1011, "Runtime WebSocket gateway failed.");
            } catch {
              // The transport may already be closed.
            }
          }
          return;
        }
        const releaseAuthenticationAdmission = authenticationAdmission.acquire();
        if (!releaseAuthenticationAdmission) {
          try {
            authenticationSocket.close(1013, "Runtime WebSocket authentication capacity reached.");
          } catch {
            // The transport may already be closed.
          }
          return;
        }
        let state: "pending" | "acknowledging" | "authenticated" | "closed" = "pending";
        let timer: unknown;

        const clearTimer = () => {
          if (timer === undefined) return;
          timers.clearTimeout(timer);
          timer = undefined;
        };
        const removeListeners = () => {
          authenticationSocket.off("message", onMessage);
          authenticationSocket.off("close", onTransportClosed);
          authenticationSocket.off("error", onTransportClosed);
        };
        const cleanup = () => {
          clearTimer();
          removeListeners();
          releaseAuthenticationAdmission();
        };
        const fail = (errorCode: RuntimeWebSocketAuthenticationErrorCode) => {
          if (state === "authenticated" || state === "closed") return;
          state = "closed";
          cleanup();
          const closeCode = closeCodeForError(errorCode);
          try {
            authenticationSocket.send(
              JSON.stringify(createRuntimeWebSocketAuthenticationErrorFrame(errorCode)),
            );
          } catch {
            // Closing below remains the authoritative failure signal.
          }
          try {
            authenticationSocket.close(closeCode, closeReason(closeCode));
          } catch {
            // The transport may already be closed.
          }
        };
        function onTransportClosed() {
          if (state === "authenticated" || state === "closed") return;
          state = "closed";
          cleanup();
        }
        function onMessage(raw: unknown, isBinary: unknown) {
          if (state !== "pending") return;
          const text = authenticationFrameText(raw, isBinary);
          let value: unknown;
          try {
            value = text === undefined ? undefined : (JSON.parse(text) as unknown);
          } catch {
            value = undefined;
          }
          const frame = parseRuntimeWebSocketAuthenticateFrame(value);
          if (!frame) {
            fail(RuntimeWebSocketAuthenticationErrorCode.invalidFrame);
            return;
          }
          if (frame.protocolVersion !== RUNTIME_CONNECTION_PROTOCOL_VERSION) {
            fail(RuntimeWebSocketAuthenticationErrorCode.protocolVersionMismatch);
            return;
          }
          if (
            frame.instanceId !== policy.instanceId ||
            !secretsEqual(frame.accessToken, policy.accessToken)
          ) {
            fail(RuntimeWebSocketAuthenticationErrorCode.authenticationFailed);
            return;
          }

          state = "acknowledging";
          clearTimer();
          authenticationSocket.off("message", onMessage);
          try {
            authenticationSocket.send(
              JSON.stringify(createRuntimeWebSocketAuthenticatedFrame(policy.instanceId)),
              (error) => {
                if (state !== "acknowledging") return;
                if (error) {
                  fail(RuntimeWebSocketAuthenticationErrorCode.authenticationFailed);
                  return;
                }
                state = "authenticated";
                cleanup();
                try {
                  callback(webSocket, upgradedRequest);
                } catch (callbackError) {
                  options.onUnexpectedError?.(callbackError);
                  try {
                    authenticationSocket.close(1011, "Runtime WebSocket gateway failed.");
                  } catch {
                    // The transport may already be closed.
                  }
                }
              },
            );
          } catch {
            fail(RuntimeWebSocketAuthenticationErrorCode.authenticationFailed);
          }
        }

        authenticationSocket.once("message", onMessage);
        authenticationSocket.once("close", onTransportClosed);
        authenticationSocket.once("error", onTransportClosed);
        timer = timers.setTimeout(
          () => fail(RuntimeWebSocketAuthenticationErrorCode.authenticationTimedOut),
          policy.webSocketAuthenticationTimeoutMs,
        );
      });
    },
  };
}
