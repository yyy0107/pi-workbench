import type { RpcIssue, RpcIssuePathSegment } from "./contracts";
import { isRecord, issue, validationFailure, validationSuccess } from "../lib/validation-issues";

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
