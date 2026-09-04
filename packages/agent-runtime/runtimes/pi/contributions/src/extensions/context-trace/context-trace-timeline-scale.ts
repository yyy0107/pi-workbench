export interface ContextTraceTimelineScale {
  readonly startTime: number;
  readonly endTime: number;
  fractionAt(time: number): number;
  timeAt(fraction: number): number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Lay timeline events out by sequence rather than elapsed wall-clock time.
 *
 * Every interval between two observed timestamps receives the same visual width. This keeps a long
 * idle period from shrinking all useful activity while preserving chronological ordering and a
 * reversible mapping for the time-range interaction.
 */
export function createContextTraceTimelineScale(
  eventTimes: readonly number[],
): ContextTraceTimelineScale {
  const observedTimes = eventTimes
    .filter((time) => Number.isFinite(time))
    .toSorted((left, right) => left - right)
    .filter((time, index, times) => index === 0 || time !== times[index - 1]);
  const startTime = observedTimes[0] ?? 0;
  const endTime = observedTimes.length > 1 ? observedTimes.at(-1)! : startTime + 1;
  const points = observedTimes.length > 1 ? observedTimes : [startTime, endTime];
  const intervalCount = points.length - 1;

  const fractionAt = (time: number): number => {
    const boundedTime = clamp(time, startTime, endTime);
    if (boundedTime <= startTime) return 0;
    if (boundedTime >= endTime) return 1;

    let lowerIndex = 0;
    let upperIndex = points.length - 1;
    while (lowerIndex + 1 < upperIndex) {
      const candidateIndex = Math.floor((lowerIndex + upperIndex) / 2);
      if (points[candidateIndex] <= boundedTime) lowerIndex = candidateIndex;
      else upperIndex = candidateIndex;
    }

    const intervalStart = points[lowerIndex];
    const intervalEnd = points[upperIndex];
    const intervalFraction = (boundedTime - intervalStart) / (intervalEnd - intervalStart);
    return (lowerIndex + intervalFraction) / intervalCount;
  };

  const timeAt = (fraction: number): number => {
    const position = clamp(fraction, 0, 1) * intervalCount;
    const lowerIndex = Math.min(Math.floor(position), intervalCount - 1);
    const intervalFraction = position - lowerIndex;
    return points[lowerIndex] + (points[lowerIndex + 1] - points[lowerIndex]) * intervalFraction;
  };

  return { startTime, endTime, fractionAt, timeAt };
}
