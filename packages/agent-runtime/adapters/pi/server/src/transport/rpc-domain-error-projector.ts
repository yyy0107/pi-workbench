import { isRpcDomainError } from "@workbench/server-core/rpc-domain-error";
import { rpcBusinessError } from "./rpc-transport";

export type RpcDomainErrorProjector = (error: unknown) => never;

/** Converts only explicitly branded domain errors into browser-visible business failures. */
export const projectRpcDomainError: RpcDomainErrorProjector = (error): never => {
  if (!isRpcDomainError(error)) throw error;
  throw rpcBusinessError(error.code, error.message, { ...error.details }, { cause: error });
};
