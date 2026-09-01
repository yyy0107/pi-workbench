import type {
  ComposerCommandArgsBinding,
  ComposerCommandArgsSchema,
} from "@workbench/extension-sdk";

interface ComposerCommandArgumentHintOptions {
  readonly explicitHint?: string;
  readonly argsSchema?: ComposerCommandArgsSchema;
  readonly argsBinding?: ComposerCommandArgsBinding;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Formats JSON Schema fields as conventional CLI argument syntax. */
export function composerCommandArgumentHint({
  explicitHint,
  argsSchema,
  argsBinding,
}: ComposerCommandArgumentHintOptions): string | undefined {
  const explicit = explicitHint?.trim();
  if (explicit) return explicit;

  const properties = isRecord(argsSchema?.properties) ? Object.keys(argsSchema.properties) : [];
  const fields = argsBinding
    ? [argsBinding.field, ...properties.filter((field) => field !== argsBinding.field)]
    : properties;
  if (fields.length === 0) return undefined;

  const required = new Set(
    Array.isArray(argsSchema?.required)
      ? argsSchema.required.filter((field): field is string => typeof field === "string")
      : [],
  );
  return fields.map((field) => (required.has(field) ? `<${field}>` : `[${field}]`)).join(" ");
}
