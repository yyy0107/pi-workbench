export function cssTimeMilliseconds(value: string): number {
  const normalized = value.trim();
  if (normalized.endsWith("ms")) return Number.parseFloat(normalized) || 0;
  if (normalized.endsWith("s")) return (Number.parseFloat(normalized) || 0) * 1000;
  return 0;
}

export function widthTransitionMilliseconds(element: HTMLElement): number {
  const styles = window.getComputedStyle(element);
  const properties = styles.transitionProperty.split(",").map((value) => value.trim());
  const durations = styles.transitionDuration.split(",").map(cssTimeMilliseconds);
  const delays = styles.transitionDelay.split(",").map(cssTimeMilliseconds);

  return properties.reduce((longest, property, index) => {
    if (property !== "all" && property !== "width") return longest;
    const duration = durations[index % durations.length] ?? 0;
    const delay = delays[index % delays.length] ?? 0;
    return Math.max(longest, duration + delay);
  }, 0);
}
