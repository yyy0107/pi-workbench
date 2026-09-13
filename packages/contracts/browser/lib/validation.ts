export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function string(value: unknown, maximum = 8192): value is string {
  return typeof value === "string" && value.length <= maximum;
}

export function finite(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
  );
}

export function member(value: unknown, options: readonly string[]): boolean {
  return typeof value === "string" && options.includes(value);
}
