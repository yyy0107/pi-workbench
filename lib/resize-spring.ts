export interface SpringAnimation {
  cancel(): void;
  setTarget(value: number): void;
}

export interface SpringOptions {
  from: number;
  to: number;
  velocity?: number;
  stiffness?: number;
  damping?: number;
  mass?: number;
  restSpeed?: number;
  restDelta?: number;
  onUpdate(value: number): void;
  onComplete?(): void;
}

export function nearestSnapPoint(value: number, points: readonly number[]): number {
  if (points.length === 0) return value;
  return points.reduce((nearest, point) =>
    Math.abs(point - value) < Math.abs(nearest - value) ? point : nearest,
  );
}

export function applyMagneticSnap(
  value: number,
  points: readonly number[],
  radius = 48,
  lockRadius = 8,
): number {
  const point = nearestSnapPoint(value, points);
  const delta = value - point;
  const distance = Math.abs(delta);

  if (distance >= radius) return value;
  if (distance <= lockRadius) return point;

  const progress = (distance - lockRadius) / (radius - lockRadius);
  const easedProgress = progress * progress * (3 - 2 * progress);
  const resistedDistance = radius * easedProgress;

  return point + Math.sign(delta) * resistedDistance;
}

export function projectValue(value: number, velocityPxPerMs: number, projectionMs = 140): number {
  return value + velocityPxPerMs * projectionMs;
}

export function animateSpring({
  from,
  to,
  velocity = 0,
  stiffness = 520,
  damping = 38,
  mass = 0.72,
  restSpeed = 5,
  restDelta = 0.25,
  onUpdate,
  onComplete,
}: SpringOptions): SpringAnimation {
  let active = true;
  let frame = 0;
  let target = to;

  const finish = () => {
    if (!active) return;
    active = false;
    onUpdate(target);
    onComplete?.();
  };

  if (
    Math.abs(from - to) <= restDelta ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  ) {
    finish();
    return { cancel() {}, setTarget() {} };
  }

  let position = from;
  let speed = velocity;
  let lastTime = performance.now();
  const startedAt = lastTime;

  const tick = (now: number) => {
    if (!active) return;

    const elapsedSeconds = Math.min((now - lastTime) / 1000, 0.032);
    lastTime = now;
    const springForce = -stiffness * (position - target);
    const dampingForce = -damping * speed;
    speed += ((springForce + dampingForce) / mass) * elapsedSeconds;
    position += speed * elapsedSeconds;

    if (
      (Math.abs(speed) <= restSpeed && Math.abs(position - target) <= restDelta) ||
      now - startedAt >= 1000
    ) {
      finish();
      return;
    }

    onUpdate(position);
    frame = window.requestAnimationFrame(tick);
  };

  frame = window.requestAnimationFrame(tick);
  return {
    cancel() {
      if (!active) return;
      active = false;
      window.cancelAnimationFrame(frame);
    },
    setTarget(value) {
      if (!active) return;
      target = value;
    },
  };
}
