export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function diagnosticText(diagnostic: {
  type: string;
  error?: { name?: string; message: string; code?: string | number };
  details?: Record<string, unknown>;
}): string {
  const error = isRecord(diagnostic.error) ? diagnostic.error : undefined;
  const details = isRecord(diagnostic.details) ? diagnostic.details : undefined;

  return [
    optionalString(diagnostic.type),
    optionalString(error?.name),
    optionalString(error?.message),
    typeof error?.code === "string" || typeof error?.code === "number"
      ? String(error.code)
      : undefined,
    typeof details?.status === "number" ? String(details.status) : undefined,
    optionalString(details?.statusText),
    optionalString(details?.errorCode),
  ]
    .filter((value) => Boolean(value))
    .join(" ");
}
