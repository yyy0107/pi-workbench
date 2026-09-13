import type { RpcIssue, RpcIssuePathSegment } from "../src/contracts";
import type { RpcValidationResult } from "../src/validation";

export function issue(
  code: string,
  path: readonly RpcIssuePathSegment[],
  message: string,
  metadata: Record<string, unknown> = {},
): RpcIssue {
  return { code, path: [...path], message, ...metadata };
}

export function validationSuccess<Value>(value: Value): RpcValidationResult<Value> {
  return { ok: true, value };
}

export function validationFailure<Value>(issues: RpcIssue[]): RpcValidationResult<Value> {
  return { ok: false, issues };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
