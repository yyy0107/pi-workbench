import type { RpcError } from "./contracts";

const RPC_DOMAIN_ERROR_BRAND = Symbol.for("workbench.rpc-domain-error.v1");
const LEGACY_PI_RPC_DOMAIN_ERROR_BRAND = Symbol.for("workbench.pi.rpc-domain-error.v1");

/**
 * Base class for domain failures whose code, message, and details are explicitly safe to expose
 * through the Workbench RPC business-error envelope.
 */
export abstract class RpcDomainError<
  Code extends string = string,
  Details extends object = object,
> extends Error {
  abstract readonly code: Code;
  abstract readonly details: Details;

  protected constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    Object.defineProperty(this, RPC_DOMAIN_ERROR_BRAND, {
      configurable: false,
      enumerable: false,
      value: true,
      writable: false,
    });
  }
}

/** Recognizes only explicitly branded Error instances, including instances surviving server HMR. */
export function isRpcDomainError(error: unknown): error is RpcDomainError<string, object> {
  if (!(error instanceof Error)) return false;
  const candidate = error as Error & {
    code?: unknown;
    details?: unknown;
  };
  return (
    (Reflect.get(candidate, RPC_DOMAIN_ERROR_BRAND) === true ||
      Reflect.get(candidate, LEGACY_PI_RPC_DOMAIN_ERROR_BRAND) === true) &&
    typeof candidate.code === "string" &&
    candidate.details !== null &&
    typeof candidate.details === "object" &&
    !Array.isArray(candidate.details)
  );
}

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
