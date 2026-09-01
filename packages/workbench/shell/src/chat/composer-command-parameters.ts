import type {
  ComposerCommandArgsBinding,
  ComposerCommandArgsSchema,
  ComposerJsonValue,
} from "@workbench/extension-sdk";

export interface ComposerCommandParameterField {
  readonly id: string;
  readonly schema: Readonly<Record<string, ComposerJsonValue>>;
  readonly required: boolean;
}

export type ComposerCommandParameterIssue =
  | { readonly code: "required" }
  | { readonly code: "invalidChoice" }
  | { readonly code: "invalidNumber" }
  | { readonly code: "integer" }
  | { readonly code: "minimum"; readonly limit: number }
  | { readonly code: "maximum"; readonly limit: number }
  | { readonly code: "minLength"; readonly limit: number }
  | { readonly code: "maxLength"; readonly limit: number };

function isRecord(value: unknown): value is Readonly<Record<string, ComposerJsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: ComposerJsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: ComposerJsonValue | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function primitiveEnumValues(
  schema: Readonly<Record<string, ComposerJsonValue>>,
): readonly (string | number | boolean)[] {
  return Array.isArray(schema.enum)
    ? schema.enum.filter(
        (option): option is string | number | boolean =>
          typeof option === "string" ||
          (typeof option === "number" && Number.isFinite(option)) ||
          typeof option === "boolean",
      )
    : [];
}

export function composerCommandParameterEnumValues(
  schema: Readonly<Record<string, ComposerJsonValue>>,
): readonly (string | number | boolean)[] {
  return primitiveEnumValues(schema);
}

export function composerCommandParameterFields(
  argsSchema: ComposerCommandArgsSchema,
  argsBinding?: ComposerCommandArgsBinding,
): readonly ComposerCommandParameterField[] {
  const properties = isRecord(argsSchema.properties) ? argsSchema.properties : {};
  const required = new Set(
    Array.isArray(argsSchema.required)
      ? argsSchema.required.filter((value): value is string => typeof value === "string")
      : [],
  );
  const fieldIds = [
    ...(argsBinding ? [argsBinding.field] : []),
    ...Object.keys(properties),
    ...required,
  ].filter((field, index, fields) => fields.indexOf(field) === index);

  return fieldIds.map((id) => ({
    id,
    schema: isRecord(properties[id]) ? properties[id] : { type: "string" },
    required: required.has(id),
  }));
}

export function composerCommandParameterDefaults(
  argsSchema: ComposerCommandArgsSchema,
  argsBinding?: ComposerCommandArgsBinding,
): Readonly<Record<string, ComposerJsonValue>> {
  const defaults: Record<string, ComposerJsonValue> = {};
  for (const field of composerCommandParameterFields(argsSchema, argsBinding)) {
    const defaultValue = field.schema.default;
    if (defaultValue !== undefined) defaults[field.id] = defaultValue;
  }
  return defaults;
}

export function withComposerCommandParameterDefaults(
  argsSchema: ComposerCommandArgsSchema,
  argsBinding: ComposerCommandArgsBinding | undefined,
  values: Readonly<Record<string, ComposerJsonValue>> | undefined,
): Readonly<Record<string, ComposerJsonValue>> {
  return {
    ...composerCommandParameterDefaults(argsSchema, argsBinding),
    ...values,
  };
}

function parameterIssue(
  field: ComposerCommandParameterField,
  value: ComposerJsonValue | undefined,
): ComposerCommandParameterIssue | undefined {
  if (value === undefined || value === null || value === "") {
    return field.required ? { code: "required" } : undefined;
  }

  const enumValues = primitiveEnumValues(field.schema);
  if (enumValues.length > 0) {
    return enumValues.some((option) => Object.is(option, value))
      ? undefined
      : { code: "invalidChoice" };
  }

  const schemaType = stringValue(field.schema.type) ?? "string";
  if (schemaType === "number" || schemaType === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) return { code: "invalidNumber" };
    if (schemaType === "integer" && !Number.isInteger(value)) return { code: "integer" };
    const minimum = numberValue(field.schema.minimum);
    if (minimum !== undefined && value < minimum) return { code: "minimum", limit: minimum };
    const maximum = numberValue(field.schema.maximum);
    if (maximum !== undefined && value > maximum) return { code: "maximum", limit: maximum };
    return undefined;
  }

  if (schemaType === "boolean") {
    return typeof value === "boolean" ? undefined : { code: "invalidChoice" };
  }

  if (typeof value !== "string") return { code: "invalidChoice" };
  const minLength = numberValue(field.schema.minLength);
  if (minLength !== undefined && value.length < minLength) {
    return { code: "minLength", limit: minLength };
  }
  const maxLength = numberValue(field.schema.maxLength);
  if (maxLength !== undefined && value.length > maxLength) {
    return { code: "maxLength", limit: maxLength };
  }
  return undefined;
}

export function composerCommandParameterIssues(
  argsSchema: ComposerCommandArgsSchema,
  argsBinding: ComposerCommandArgsBinding | undefined,
  values: Readonly<Record<string, ComposerJsonValue>>,
): Readonly<Record<string, ComposerCommandParameterIssue>> {
  const issues: Record<string, ComposerCommandParameterIssue> = {};
  for (const field of composerCommandParameterFields(argsSchema, argsBinding)) {
    const issue = parameterIssue(field, values[field.id]);
    if (issue) issues[field.id] = issue;
  }
  return issues;
}
