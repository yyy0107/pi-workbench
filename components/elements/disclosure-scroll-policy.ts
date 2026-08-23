export function upwardDisclosureScrollDelta(
  heightIncrease: number,
  visibleSpaceAbove: number,
): number {
  const growth = Number.isFinite(heightIncrease) ? Math.max(0, heightIncrease) : 0;
  const spaceAbove = Number.isFinite(visibleSpaceAbove) ? Math.max(0, visibleSpaceAbove) : 0;

  return Math.min(growth, spaceAbove);
}

export function shouldCompensateDisclosureOpening(
  opening: boolean,
  preferUpward: boolean,
): boolean {
  return opening && preferUpward;
}
