import { issue, isRecord, validationSuccess, validationFailure } from "../lib/validation-issues";
import { createRpcError, RpcBusinessError, rpcBusinessError } from "./errors";
import type { RpcValidator, RpcValidationResult } from "./validation";
import { isRpcDomainError } from "./errors";
import type { ClientRequest, RpcError, RpcIssue, ServerResponse } from "./contracts";
import {
  configuredApiTrustedHosts,
  inspectApiRequestTrust,
} from "@workbench/server-core/request-trust";

export const DEFAULT_MAX_RPC_REQUEST_BODY_BYTES = 1024 * 1024;

export interface RpcHandlerContext<Method extends string = string> {
  method: Method;
  rpcId: string;
  request: Request;
  signal: AbortSignal;
}

export interface RpcPostHandlerOptions<Method extends string, Payload, Value> {
  /** The endpoint name after `/api/`; the request envelope method must match it exactly. */
  method: Method;
  payload: RpcValidator<Payload>;
  handler: (payload: Payload, context: RpcHandlerContext<Method>) => Value | Promise<Value>;
  maxRequestBodyBytes?: number;
  /** Allow configured non-loopback authorities after the same Host/Origin checks. */
  trustedHosts?: readonly string[];
  /** Restrict a capability such as native picking or path opening to loopback callers. */
  loopbackOnly?: boolean;
  onUnexpectedError?: (
    error: unknown,
    context: { method: Method; rpcId?: string; request: Request },
  ) => void;
}

export interface TrustedJsonPostOptions {
  maxRequestBodyBytes?: number;
  /** Allow configured non-loopback authorities after the same Host/Origin checks. */
  trustedHosts?: readonly string[];
  /** Restrict a capability to loopback callers after normal trust validation. */
  loopbackOnly?: boolean;
  onUnexpectedError?: (error: unknown, context: { request: Request }) => void;
}

export type TrustedJsonPostResult =
  | { ok: true; value: unknown }
  | { ok: false; response: Response };

interface BodyReadSuccess {
  ok: true;
  bytes: Uint8Array;
}

interface BodyReadFailure {
  ok: false;
  response: Response;
}

function plainResponse(
  status: number,
  body: string,
  headers?: ConstructorParameters<typeof Headers>[0],
): Response {
  return new Response(body, { status, headers });
}

function payloadTooLargeResponse(): Response {
  return plainResponse(413, "Payload Too Large", { connection: "close" });
}

function parseContentLength(value: string | null): bigint | undefined | null {
  if (value === null) return undefined;
  if (!/^[0-9]+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

async function discardBody(request: Request): Promise<void> {
  try {
    await request.body?.cancel();
  } catch {
    // The response is already decided; a body cancellation failure is not observable by the caller.
  }
}

async function readBody(
  request: Request,
  maximumBytes: number,
): Promise<BodyReadSuccess | BodyReadFailure> {
  const declaredLength = parseContentLength(request.headers.get("content-length"));
  if (declaredLength === null) {
    await discardBody(request);
    return { ok: false, response: plainResponse(400, "Bad Request") };
  }
  if (declaredLength !== undefined && declaredLength > BigInt(maximumBytes)) {
    await discardBody(request);
    return { ok: false, response: payloadTooLargeResponse() };
  }

  if (!request.body) return { ok: true, bytes: new Uint8Array() };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      try {
        await reader.cancel();
      } catch {
        // The oversized response takes precedence over cancellation cleanup.
      }
      return { ok: false, response: payloadTooLargeResponse() };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

function isJsonContentType(value: string | null): boolean {
  return value !== null && /^application\/json\s*(?:;.*)?$/i.test(value);
}

function badRequestResponse(rpcId: string, issues: RpcIssue[]): Response {
  const response: ServerResponse<never, { issues: RpcIssue[] }> = {
    type: "server-response",
    rpcId,
    result: {
      ok: false,
      error: createRpcError("bad-request", "Invalid RPC request", { issues }),
    },
  };
  return Response.json(response);
}

function successResponse<Value>(rpcId: string, value: Value): Response {
  const response = {
    type: "server-response",
    rpcId,
    result: { ok: true, value },
  } satisfies ServerResponse<Value>;
  return Response.json(response);
}

function businessErrorResponse(rpcId: string, error: RpcError): Response {
  const response: ServerResponse<never> = {
    type: "server-response",
    rpcId,
    result: { ok: false, error },
  };
  return Response.json(response);
}

function validateClientRequest<Method extends string, Payload>(
  value: unknown,
  method: Method,
  payloadValidator: RpcValidator<Payload>,
): RpcValidationResult<ClientRequest<Method, Payload>> {
  if (!isRecord(value)) {
    return validationFailure([
      issue("invalid_type", [], "Expected a client request object", {
        expected: "object",
        received: value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
      }),
    ]);
  }

  const issues: RpcIssue[] = [];
  if (value.type !== "client-request") {
    issues.push(
      issue("invalid_literal", ["type"], 'Expected "client-request"', {
        expected: "client-request",
      }),
    );
  }
  if (typeof value.rpcId !== "string") {
    issues.push(
      issue("invalid_type", ["rpcId"], "Expected a string", {
        expected: "string",
        received: value.rpcId === null ? "null" : typeof value.rpcId,
      }),
    );
  }
  if (typeof value.method !== "string") {
    issues.push(
      issue("invalid_type", ["method"], "Expected a string", {
        expected: "string",
        received: value.method === null ? "null" : typeof value.method,
      }),
    );
  } else if (value.method !== method) {
    issues.push(
      issue(
        "invalid_literal",
        ["method"],
        `Expected method to match endpoint ${JSON.stringify(method)}`,
        {
          expected: method,
        },
      ),
    );
  }

  let parsedPayload: Payload | undefined;
  if (!Object.hasOwn(value, "payload")) {
    issues.push(issue("invalid_type", ["payload"], "Required", { expected: "present" }));
  } else {
    const payloadResult = payloadValidator(value.payload, ["payload"]);
    if (payloadResult.ok) parsedPayload = payloadResult.value;
    else issues.push(...payloadResult.issues);
  }

  if (issues.length > 0) return validationFailure(issues);
  return validationSuccess({
    type: "client-request",
    rpcId: value.rpcId as string,
    method,
    payload: parsedPayload as Payload,
  });
}

function reportUnexpectedError<Method extends string>(
  options: RpcPostHandlerOptions<Method, unknown, unknown>,
  error: unknown,
  request: Request,
  rpcId?: string,
): void {
  try {
    if (options.onUnexpectedError) {
      options.onUnexpectedError(error, { method: options.method, rpcId, request });
    } else {
      console.error(`[workbench-pi] RPC ${options.method} failed`, error);
    }
  } catch {
    // Error reporting must never affect the transport response.
  }
}

function internalErrorResponse(): Response {
  return plainResponse(500, "Internal Server Error");
}

function reportJsonPostError(
  options: TrustedJsonPostOptions,
  error: unknown,
  request: Request,
): void {
  try {
    if (options.onUnexpectedError) options.onUnexpectedError(error, { request });
    else console.error("[workbench-pi] JSON API request failed", error);
  } catch {
    // Diagnostics must never affect the transport response.
  }
}

/**
 * Shared carrier boundary for JSON-only POST endpoints.
 *
 * `POST /api/respond` deliberately does not use a `ClientRequest`, but it must
 * have exactly the same method, trust, media-type, UTF-8 and body-size rules as
 * the regular RPC endpoints.
 */
export async function readTrustedJsonPost(
  request: Request,
  options: TrustedJsonPostOptions = {},
): Promise<TrustedJsonPostResult> {
  if (request.method !== "POST") {
    return { ok: false, response: plainResponse(405, "Method Not Allowed", { allow: "POST" }) };
  }
  const trust = inspectApiRequestTrust(request, {
    trustedHosts: options.trustedHosts ?? configuredApiTrustedHosts(),
  });
  if (!trust.trusted || (options.loopbackOnly && !trust.loopback)) {
    return { ok: false, response: plainResponse(403, "Forbidden") };
  }
  if (!isJsonContentType(request.headers.get("content-type"))) {
    await discardBody(request);
    return { ok: false, response: plainResponse(415, "Unsupported Media Type") };
  }

  const maximumBytes = options.maxRequestBodyBytes ?? DEFAULT_MAX_RPC_REQUEST_BODY_BYTES;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    reportJsonPostError(
      options,
      new RangeError("maxRequestBodyBytes must be a positive safe integer"),
      request,
    );
    return { ok: false, response: internalErrorResponse() };
  }

  let body: BodyReadSuccess | BodyReadFailure;
  try {
    body = await readBody(request, maximumBytes);
  } catch (error) {
    reportJsonPostError(options, error, request);
    return { ok: false, response: internalErrorResponse() };
  }
  if (!body.ok) return body;

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body.bytes);
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: plainResponse(400, "Bad Request") };
  }
}

export async function handleRpcPost<Method extends string, Payload, Value>(
  request: Request,
  options: RpcPostHandlerOptions<Method, Payload, Value>,
): Promise<Response> {
  const body = await readTrustedJsonPost(request, {
    ...(options.maxRequestBodyBytes === undefined
      ? {}
      : { maxRequestBodyBytes: options.maxRequestBodyBytes }),
    ...(options.trustedHosts === undefined ? {} : { trustedHosts: options.trustedHosts }),
    ...(options.loopbackOnly === undefined ? {} : { loopbackOnly: options.loopbackOnly }),
    onUnexpectedError: (error) =>
      reportUnexpectedError(
        options as RpcPostHandlerOptions<Method, unknown, unknown>,
        error,
        request,
      ),
  });
  if (!body.ok) return body.response;
  const decoded = body.value;

  const fallbackRpcId = isRecord(decoded) && typeof decoded.rpcId === "string" ? decoded.rpcId : "";
  let validated: RpcValidationResult<ClientRequest<Method, Payload>>;
  try {
    validated = validateClientRequest(decoded, options.method, options.payload);
  } catch (error) {
    reportUnexpectedError(
      options as RpcPostHandlerOptions<Method, unknown, unknown>,
      error,
      request,
      fallbackRpcId,
    );
    return internalErrorResponse();
  }
  if (!validated.ok) return badRequestResponse(fallbackRpcId, validated.issues);

  try {
    const value = await options.handler(validated.value.payload, {
      method: options.method,
      rpcId: validated.value.rpcId,
      request,
      signal: request.signal,
    });
    return successResponse(validated.value.rpcId, value);
  } catch (error) {
    if (error instanceof RpcBusinessError) {
      try {
        return businessErrorResponse(validated.value.rpcId, error.rpcError);
      } catch (serializationError) {
        reportUnexpectedError(
          options as RpcPostHandlerOptions<Method, unknown, unknown>,
          serializationError,
          request,
          validated.value.rpcId,
        );
        return internalErrorResponse();
      }
    }
    reportUnexpectedError(
      options as RpcPostHandlerOptions<Method, unknown, unknown>,
      error,
      request,
      validated.value.rpcId,
    );
    return internalErrorResponse();
  }
}

export function createRpcPostHandler<Method extends string, Payload, Value>(
  options: RpcPostHandlerOptions<Method, Payload, Value>,
): (request: Request) => Promise<Response> {
  return (request) => handleRpcPost(request, options);
}

export interface RpcRouteGroup {
  handle(request: Request, method: string): Promise<Response> | undefined;
}

/** Dispatches to the first domain route group that claims the RPC method. */
export function dispatchRpcRouteGroups(
  request: Request,
  method: string,
  groups: readonly RpcRouteGroup[],
): Promise<Response> | undefined {
  for (const group of groups) {
    const response = group.handle(request, method);
    if (response) return response;
  }
  return undefined;
}

export type RpcDomainErrorProjector = (error: unknown) => never;

/** Converts only explicitly branded domain errors into browser-visible business failures. */
export const projectRpcDomainError: RpcDomainErrorProjector = (error): never => {
  if (!isRpcDomainError(error)) throw error;
  throw rpcBusinessError(error.code, error.message, { ...error.details }, { cause: error });
};
