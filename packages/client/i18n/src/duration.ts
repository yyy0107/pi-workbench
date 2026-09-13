const MILLISECONDS_PER_SECOND = 1_000;
const MILLISECONDS_PER_MINUTE = 60 * MILLISECONDS_PER_SECOND;

function normalizeMilliseconds(milliseconds: number | undefined): number {
  return milliseconds !== undefined && Number.isFinite(milliseconds)
    ? Math.max(0, milliseconds)
    : 0;
}

function formatDurationUnit(
  value: number,
  locale: string,
  unit: Intl.NumberFormatOptions["unit"],
  fractionDigits: Readonly<{
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
  }> = {},
): string {
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit,
    unitDisplay: "narrow",
    ...fractionDigits,
  }).format(value);
}

export function formatCompactDuration(
  milliseconds: number | undefined,
  locale: string,
  { includeZero = false }: Readonly<{ includeZero?: boolean }> = {},
): string {
  const totalSeconds = Math.round(normalizeMilliseconds(milliseconds) / MILLISECONDS_PER_SECOND);
  const units = [
    { seconds: 86_400, unit: "day" },
    { seconds: 3_600, unit: "hour" },
    { seconds: 60, unit: "minute" },
    { seconds: 1, unit: "second" },
  ] as const;
  let remaining = totalSeconds;

  const durationParts = units.flatMap((unit) => {
    const value = Math.floor(remaining / unit.seconds);
    remaining %= unit.seconds;
    return value === 0 ? [] : formatDurationUnit(value, locale, unit.unit);
  });

  if (durationParts.length > 0) {
    return new Intl.ListFormat(locale, { style: "narrow", type: "unit" }).format(durationParts);
  }
  return includeZero ? formatDurationUnit(0, locale, "second") : "";
}

/**
 * Formats short measured durations without embedding English unit suffixes in callers.
 * Sub-second values use milliseconds, values below a minute use fractional seconds,
 * and longer values fall back to the compact multi-unit representation.
 */
export function formatAdaptiveDuration(
  milliseconds: number | undefined,
  locale: string,
  {
    minimumFractionDigits,
    maximumFractionDigits = 2,
  }: Readonly<{
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
  }> = {},
): string {
  const normalizedMilliseconds = normalizeMilliseconds(milliseconds);

  if (normalizedMilliseconds < MILLISECONDS_PER_SECOND) {
    return formatDurationUnit(Math.round(normalizedMilliseconds), locale, "millisecond");
  }
  if (normalizedMilliseconds < MILLISECONDS_PER_MINUTE) {
    return formatDurationUnit(normalizedMilliseconds / MILLISECONDS_PER_SECOND, locale, "second", {
      minimumFractionDigits,
      maximumFractionDigits,
    });
  }
  return formatCompactDuration(normalizedMilliseconds, locale, { includeZero: true });
}
