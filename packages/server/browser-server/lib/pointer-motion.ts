import type { BrowserCursor } from "@workbench/browser-contracts";

type Point = Pick<BrowserCursor, "x" | "y">;

/** Timed native mouse samples in CSS pixels; the last sample is always the exact target. */
export function createPointerTrajectory(
  from: Point,
  to: Point,
  viewport: { width: number; height: number },
): Array<Point & { delayMs: number }> {
  if (![from.x, from.y, to.x, to.y, viewport.width, viewport.height].every(Number.isFinite))
    throw new RangeError("Pointer coordinates and viewport dimensions must be finite.");
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (!distance) return [];

  const duration = Math.min(750, 55 + 20 * Math.sqrt(distance));
  const steps = Math.ceil(duration / (1000 / 60));
  const bend =
    (Math.random() < 0.5 ? -1 : 1) * Math.min(64, distance * 0.12) * (0.6 + Math.random() * 0.4);
  // Bound the bend to the viewport or the range of explicitly requested offscreen endpoints.
  const control = {
    x: Math.max(
      Math.min(0, from.x, to.x),
      Math.min(
        Math.max(viewport.width, from.x, to.x),
        (from.x + to.x) / 2 - (dy / distance) * bend,
      ),
    ),
    y: Math.max(
      Math.min(0, from.y, to.y),
      Math.min(
        Math.max(viewport.height, from.y, to.y),
        (from.y + to.y) / 2 + (dx / distance) * bend,
      ),
    ),
  };
  // ponytail: one bounded curve per move; add waypoints if avoiding hover obstacles is required.
  return Array.from({ length: steps }, (_, index) => {
    const t = (index + 1) / steps;
    // Zero velocity and acceleration at both ends, with a faster middle section.
    const progress = t * t * t * (10 + t * (-15 + 6 * t));
    const rest = 1 - progress;
    return {
      x:
        index === steps - 1
          ? to.x
          : rest * rest * from.x + 2 * rest * progress * control.x + progress * progress * to.x,
      y:
        index === steps - 1
          ? to.y
          : rest * rest * from.y + 2 * rest * progress * control.y + progress * progress * to.y,
      delayMs: duration / steps,
    };
  });
}
