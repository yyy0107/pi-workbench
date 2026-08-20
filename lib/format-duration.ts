export function formatCompactDuration(
  milliseconds: number | undefined,
  { zeroValue = "" }: Readonly<{ zeroValue?: string }> = {},
): string {
  const totalSeconds = Math.max(0, Math.round((milliseconds ?? 0) / 1_000));
  const units = [
    { seconds: 86_400, suffix: "d" },
    { seconds: 3_600, suffix: "h" },
    { seconds: 60, suffix: "m" },
    { seconds: 1, suffix: "s" },
  ] as const;
  let remaining = totalSeconds;

  const duration = units
    .flatMap((unit) => {
      const value = Math.floor(remaining / unit.seconds);
      remaining %= unit.seconds;
      return value === 0 ? [] : `${value}${unit.suffix}`;
    })
    .join("");

  return duration || zeroValue;
}
