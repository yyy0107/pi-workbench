export function upwardDisclosureScrollDelta(heightIncrease: number): number {
  return Number.isFinite(heightIncrease) ? Math.max(0, heightIncrease) : 0;
}

export function shouldCompensateDisclosureOpening(
  opening: boolean,
  preferUpward: boolean,
): boolean {
  return opening && preferUpward;
}

export function preservesBothScrollbarGutters(scrollbarGutter: string): boolean {
  return scrollbarGutter.split(/\s+/).includes("both-edges");
}
