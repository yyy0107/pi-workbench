export type RpcIssuePathSegment = string | number;

/**
 * A validation issue returned in `bad-request` error details.
 *
 * Validators may attach additional structured metadata (for example
 * `expected` or `minimum`) without changing the common wire contract.
 */
export interface RpcIssue {
  code: string;
  path: RpcIssuePathSegment[];
  message: string;
  [key: string]: unknown;
}

export interface RpcError<Details extends Record<string, unknown> = Record<string, unknown>> {
  code: string;
  message: string;
  details: Details;
}

export interface ClientRequest<Method extends string = string, Payload = unknown> {
  type: "client-request";
  rpcId: string;
  method: Method;
  payload: Payload;
}

export interface RpcSuccess<Value> {
  ok: true;
  /** JSON serialization omits this property when the handler returns `undefined`. */
  value: Value;
}

export interface RpcFailure<Details extends Record<string, unknown> = Record<string, unknown>> {
  ok: false;
  error: RpcError<Details>;
}

export interface ServerResponse<
  Value = unknown,
  Details extends Record<string, unknown> = Record<string, unknown>,
> {
  type: "server-response";
  rpcId: string;
  result: RpcSuccess<Value> | RpcFailure<Details>;
}
