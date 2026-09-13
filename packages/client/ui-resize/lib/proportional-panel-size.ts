export interface ProportionalPanelSize {
  share: number;
  minimum: number;
  remainingMinimum: number;
}

/** Capture the current split once; parent resizing must not rebase the split every frame. */
export function resolvePanelShare(width: number, availableWidth: number): number {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return 0;
  return Number.isFinite(width) ? Math.min(1, Math.max(0, width / availableWidth)) : 0;
}

export function resolveProportionalPanelWidth(
  availableWidth: number,
  { share, minimum, remainingMinimum }: ProportionalPanelSize,
): number {
  const available = Math.max(0, availableWidth);
  return Math.min(Math.max(0, available - remainingMinimum), Math.max(minimum, available * share));
}

/** The owner establishes an inline-size container shared by all participating panels. */
export function proportionalPanelWidthCss({
  minimum,
  remainingMinimum,
}: Omit<ProportionalPanelSize, "share">): string {
  const docked = "(1 - var(--workbench-panel-maximization, 0))";
  const share = `calc(var(--workbench-panel-share) * ${docked} + var(--workbench-panel-maximization, 0))`;
  return `min(max(0px, calc(100cqw - ${remainingMinimum}px * ${docked})), max(calc(${minimum}px * ${docked}), calc(100cqw * ${share})))`;
}
