import { DEFAULT_AUXILIARY_SURFACE_WIDTH, MIN_AUXILIARY_SURFACE_WIDTH } from "./workspace-store";

export { DEFAULT_AUXILIARY_SURFACE_WIDTH, MIN_AUXILIARY_SURFACE_WIDTH };
export const MIN_PRIMARY_SURFACE_WIDTH = 220;
export const MIN_HORIZONTAL_SPLIT_WIDTH = MIN_AUXILIARY_SURFACE_WIDTH + MIN_PRIMARY_SURFACE_WIDTH;
export const WIDE_AUXILIARY_SURFACE_WIDTH = 560;

export interface WorkspaceSplitLayout {
  mode: "single" | "horizontal" | "stacked";
  auxiliaryWidth: number;
  maximumAuxiliaryWidth: number;
}

export function clampAuxiliarySurfaceWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_AUXILIARY_SURFACE_WIDTH;
  return Math.max(MIN_AUXILIARY_SURFACE_WIDTH, Math.round(width));
}

export function auxiliarySurfaceSnapPoints(maximumWidth: number): readonly number[] {
  const maximum = Number.isFinite(maximumWidth)
    ? Math.max(MIN_AUXILIARY_SURFACE_WIDTH, Math.round(maximumWidth))
    : DEFAULT_AUXILIARY_SURFACE_WIDTH;
  const normal = Math.min(maximum, DEFAULT_AUXILIARY_SURFACE_WIDTH);
  const wide = Math.min(maximum, WIDE_AUXILIARY_SURFACE_WIDTH);
  return wide - normal >= 64 ? [normal, wide] : [normal];
}

export function resolveWorkspaceSplitLayout(
  containerWidth: number,
  preferredAuxiliaryWidth: number,
  hasAuxiliarySurface: boolean,
): WorkspaceSplitLayout {
  const width = Math.max(0, Math.round(containerWidth));
  if (!hasAuxiliarySurface) {
    return { mode: "single", auxiliaryWidth: 0, maximumAuxiliaryWidth: 0 };
  }
  if (width > 0 && width < MIN_HORIZONTAL_SPLIT_WIDTH) {
    return {
      mode: "stacked",
      auxiliaryWidth: width,
      maximumAuxiliaryWidth: width,
    };
  }

  const maximumAuxiliaryWidth = Math.max(
    MIN_AUXILIARY_SURFACE_WIDTH,
    width - MIN_PRIMARY_SURFACE_WIDTH,
  );
  return {
    mode: "horizontal",
    auxiliaryWidth: Math.min(
      clampAuxiliarySurfaceWidth(preferredAuxiliaryWidth),
      maximumAuxiliaryWidth,
    ),
    maximumAuxiliaryWidth,
  };
}
