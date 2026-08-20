import type {
  ClientRequest,
  RpcError,
  RpcIssue,
  RpcIssuePathSegment,
  ServerResponse,
} from "../../rpc-contracts";
// Node's native TypeScript test runner requires an explicit extension here;
// the project intentionally keeps allowImportingTsExtensions disabled.
// @ts-expect-error TS5097 -- this source is bundled without emitting TypeScript imports.
import * as apiRequestTrust from "./local-api-request-trust.ts";

const { configuredApiTrustedHosts, inspectApiRequestTrust } = apiRequestTrust;

export const DEFAULT_MAX_RPC_REQUEST_BODY_BYTES = 160 * 1024 * 1024;

export type RpcValidationResult<Value> =
  | { ok: true; value: Value }
  | { ok: false; issues: RpcIssue[] };

export interface RpcValidator<Value> {
  (value: unknown, path?: readonly RpcIssuePathSegment[]): RpcValidationResult<Value>;
  readonly optional?: false;
  readonly output?: Value;
}

export interface RpcOptionalValidator<Value> {
  (value: unknown, path?: readonly RpcIssuePathSegment[]): RpcValidationResult<Value | undefined>;
  readonly optional: true;
  readonly output?: Value | undefined;
}

type AnyRpcValidator = RpcValidator<unknown> | RpcOptionalValidator<unknown>;

export type InferRpcValidator<Validator> =
  Validator extends RpcOptionalValidator<infer Value>
    ? Value | undefined
    : Validator extends RpcValidator<infer Value>
      ? Value
      : never;

type RequiredShapeKeys<Shape extends Record<string, AnyRpcValidator>> = {
  [Key in keyof Shape]-?: Shape[Key] extends RpcOptionalValidator<unknown> ? never : Key;
}[keyof Shape];

type OptionalShapeKeys<Shape extends Record<string, AnyRpcValidator>> = Exclude<
  keyof Shape,
  RequiredShapeKeys<Shape>
>;

export type InferRpcObject<Shape extends Record<string, AnyRpcValidator>> = {
  [Key in RequiredShapeKeys<Shape>]: InferRpcValidator<Shape[Key]>;
} & {
  [Key in OptionalShapeKeys<Shape>]?: Exclude<InferRpcValidator<Shape[Key]>, undefined>;
};

export interface RpcStringOptions {
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  trim?: boolean;
}

export interface RpcNumberOptions {
  integer?: boolean;
  minimum?: number;
  maximum?: number;
}

export interface RpcArrayOptions {
  minLength?: number;
  maxLength?: number;
}

export interface RpcRefinementOptions {
  code?: string;
  message: string;
  path?: readonly RpcIssuePathSegment[];
}

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

function issue(
  code: string,
  path: readonly RpcIssuePathSegment[],
  message: string,
  metadata: Record<string, unknown> = {},
): RpcIssue {
  return { code, path: [...path], message, ...metadata };
}

function validationSuccess<Value>(value: Value): RpcValidationResult<Value> {
  return { ok: true, value };
}

function validationFailure<Value>(issues: RpcIssue[]): RpcValidationResult<Value> {
  return { ok: false, issues };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatLiteral(value: string | number | boolean | null): string {
  return JSON.stringify(value);
}

export const rpcUnknown: RpcValidator<unknown> = (value) => validationSuccess(value);

export function rpcString(options: RpcStringOptions = {}): RpcValidator<string> {
  return (value, path = []) => {
    if (typeof value !== "string") {
      return validationFailure([
        issue("invalid_type", path, "Expected a string", {
          expected: "string",
          received: value === null ? "null" : typeof value,
        }),
      ]);
    }

    const parsed = options.trim ? value.trim() : value;
    if (options.minLength !== undefined && parsed.length < options.minLength) {
      return validationFailure([
        issue("too_small", path, `String must contain at least ${options.minLength} character(s)`, {
          minimum: options.minLength,
          inclusive: true,
          type: "string",
        }),
      ]);
    }
    if (options.maxLength !== undefined && parsed.length > options.maxLength) {
      return validationFailure([
        issue("too_big", path, `String must contain at most ${options.maxLength} character(s)`, {
          maximum: options.maxLength,
          inclusive: true,
          type: "string",
        }),
      ]);
    }
    if (options.pattern) {
      options.pattern.lastIndex = 0;
      if (!options.pattern.test(parsed)) {
        return validationFailure([
          issue("invalid_string", path, "String does not match the required pattern", {
            validation: "regex",
          }),
        ]);
      }
    }

    return validationSuccess(parsed);
  };
}

export const rpcBoolean: RpcValidator<boolean> = (value, path = []) =>
  typeof value === "boolean"
    ? validationSuccess(value)
    : validationFailure([
        issue("invalid_type", path, "Expected a boolean", {
          expected: "boolean",
          received: value === null ? "null" : typeof value,
        }),
      ]);

export function rpcNumber(options: RpcNumberOptions = {}): RpcValidator<number> {
  return (value, path = []) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return validationFailure([
        issue("invalid_type", path, "Expected a finite number", {
          expected: "number",
          received: value === null ? "null" : typeof value,
        }),
      ]);
    }
    if (options.integer && !Number.isInteger(value)) {
      return validationFailure([
        issue("invalid_type", path, "Expected an integer", {
          expected: "integer",
          received: "number",
        }),
      ]);
    }
    if (options.minimum !== undefined && value < options.minimum) {
      return validationFailure([
        issue("too_small", path, `Number must be greater than or equal to ${options.minimum}`, {
          minimum: options.minimum,
          inclusive: true,
          type: "number",
        }),
      ]);
    }
    if (options.maximum !== undefined && value > options.maximum) {
      return validationFailure([
        issue("too_big", path, `Number must be less than or equal to ${options.maximum}`, {
          maximum: options.maximum,
          inclusive: true,
          type: "number",
        }),
      ]);
    }

    return validationSuccess(value);
  };
}

export function rpcInteger(options: Omit<RpcNumberOptions, "integer"> = {}): RpcValidator<number> {
  return rpcNumber({ ...options, integer: true });
}

export function rpcLiteral<const Value extends string | number | boolean | null>(
  expected: Value,
): RpcValidator<Value> {
  return (value, path = []) =>
    value === expected
      ? validationSuccess(expected)
      : validationFailure([
          issue("invalid_literal", path, `Expected ${formatLiteral(expected)}`, { expected }),
        ]);
}

export function rpcEnum<const Values extends readonly [string, ...string[]]>(
  values: Values,
): RpcValidator<Values[number]> {
  const accepted = new Set<string>(values);
  return (value, path = []) =>
    typeof value === "string" && accepted.has(value)
      ? validationSuccess(value as Values[number])
      : validationFailure([
          issue("invalid_enum_value", path, `Expected one of: ${values.join(", ")}`, {
            options: [...values],
          }),
        ]);
}

export function rpcOptional<Value>(validator: RpcValidator<Value>): RpcOptionalValidator<Value> {
  const optionalValidator = ((value: unknown, path: readonly RpcIssuePathSegment[] = []) =>
    value === undefined
      ? validationSuccess(undefined)
      : validator(value, path)) as RpcOptionalValidator<Value>;
  Object.defineProperty(optionalValidator, "optional", { value: true });
  return optionalValidator;
}

export function rpcNullable<Value>(validator: RpcValidator<Value>): RpcValidator<Value | null> {
  return (value, path = []) => (value === null ? validationSuccess(null) : validator(value, path));
}

export function rpcArray<Value>(
  validator: RpcValidator<Value>,
  options: RpcArrayOptions = {},
): RpcValidator<Value[]> {
  return (value, path = []) => {
    if (!Array.isArray(value)) {
      return validationFailure([
        issue("invalid_type", path, "Expected an array", {
          expected: "array",
          received: value === null ? "null" : typeof value,
        }),
      ]);
    }
    if (options.minLength !== undefined && value.length < options.minLength) {
      return validationFailure([
        issue("too_small", path, `Array must contain at least ${options.minLength} element(s)`, {
          minimum: options.minLength,
          inclusive: true,
          type: "array",
        }),
      ]);
    }
    if (options.maxLength !== undefined && value.length > options.maxLength) {
      return validationFailure([
        issue("too_big", path, `Array must contain at most ${options.maxLength} element(s)`, {
          maximum: options.maxLength,
          inclusive: true,
          type: "array",
        }),
      ]);
    }

    const parsed: Value[] = [];
    const issues: RpcIssue[] = [];
    value.forEach((item, index) => {
      const result = validator(item, [...path, index]);
      if (result.ok) parsed.push(result.value);
      else issues.push(...result.issues);
    });
    return issues.length > 0 ? validationFailure(issues) : validationSuccess(parsed);
  };
}

/**
 * Validates a legacy API object. Unknown keys are deliberately accepted and
 * stripped, matching the permissive object behavior of the reference API.
 */
export function rpcObject<const Shape extends Record<string, AnyRpcValidator>>(
  shape: Shape,
): RpcValidator<InferRpcObject<Shape>> {
  return (value, path = []) => {
    if (!isRecord(value)) {
      return validationFailure([
        issue("invalid_type", path, "Expected an object", {
          expected: "object",
          received: value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
        }),
      ]);
    }

    const parsed: Record<string, unknown> = {};
    const issues: RpcIssue[] = [];
    for (const key of Object.keys(shape)) {
      const validator = shape[key];
      const exists = Object.hasOwn(value, key);
      if (!exists && validator.optional === true) continue;

      const result = validator(value[key], [...path, key]);
      if (result.ok) parsed[key] = result.value;
      else issues.push(...result.issues);
    }

    return issues.length > 0
      ? validationFailure(issues)
      : validationSuccess(parsed as InferRpcObject<Shape>);
  };
}

export function rpcRecord<Value>(
  validator: RpcValidator<Value>,
): RpcValidator<Record<string, Value>> {
  return (value, path = []) => {
    if (!isRecord(value)) {
      return validationFailure([
        issue("invalid_type", path, "Expected an object", {
          expected: "object",
          received: value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
        }),
      ]);
    }

    const parsed: Record<string, Value> = {};
    const issues: RpcIssue[] = [];
    for (const [key, item] of Object.entries(value)) {
      const result = validator(item, [...path, key]);
      if (result.ok) parsed[key] = result.value;
      else issues.push(...result.issues);
    }
    return issues.length > 0 ? validationFailure(issues) : validationSuccess(parsed);
  };
}

type RpcUnionValue<Validators extends readonly RpcValidator<unknown>[]> =
  Validators[number] extends RpcValidator<infer Value> ? Value : never;

export function rpcUnion<const Validators extends readonly RpcValidator<unknown>[]>(
  validators: Validators,
): RpcValidator<RpcUnionValue<Validators>> {
  return (value, path = []) => {
    const alternatives: RpcIssue[][] = [];
    for (const validator of validators) {
      const result = validator(value, path);
      if (result.ok) return validationSuccess(result.value as RpcUnionValue<Validators>);
      alternatives.push(result.issues);
    }
    return validationFailure([
      issue("invalid_union", path, "Value does not match any allowed shape", {
        unionErrors: alternatives,
      }),
    ]);
  };
}

export function rpcRefine<Value>(
  validator: RpcValidator<Value>,
  predicate: (value: Value) => boolean,
  options: RpcRefinementOptions,
): RpcValidator<Value> {
  return (value, path = []) => {
    const result = validator(value, path);
    if (!result.ok) return result;
    if (predicate(result.value)) return result;
    return validationFailure([
      issue(options.code ?? "custom", [...path, ...(options.path ?? [])], options.message),
    ]);
  };
}

export const rpc = {
  unknown: rpcUnknown,
  string: rpcString,
  boolean: rpcBoolean,
  number: rpcNumber,
  integer: rpcInteger,
  literal: rpcLiteral,
  enum: rpcEnum,
  optional: rpcOptional,
  nullable: rpcNullable,
  array: rpcArray,
  object: rpcObject,
  record: rpcRecord,
  union: rpcUnion,
  refine: rpcRefine,
} as const;

export function createRpcError<Details extends Record<string, unknown>>(
  code: string,
  message: string,
  details: Details,
): RpcError<Details> {
  return { code, message, details };
}

export class RpcBusinessError<
  Details extends Record<string, unknown> = Record<string, unknown>,
> extends Error {
  readonly rpcError: RpcError<Details>;

  constructor(rpcError: RpcError<Details>, options?: ErrorOptions) {
    super(rpcError.message, options);
    this.name = "RpcBusinessError";
    this.rpcError = rpcError;
  }
}

export function rpcBusinessError<Details extends Record<string, unknown>>(
  code: string,
  message: string,
  details: Details,
  options?: ErrorOptions,
): RpcBusinessError<Details> {
  return new RpcBusinessError(createRpcError(code, message, details), options);
}

function plainResponse(status: number, body: string, headers?: HeadersInit): Response {
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
