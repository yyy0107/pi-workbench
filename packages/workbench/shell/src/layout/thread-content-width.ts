export const THREAD_CONTENT_MIN_WIDTH_PX = 320;
export const THREAD_CONTENT_INDEX_RELEASE_WIDTH_PX = 832;
export const THREAD_CONTENT_MAX_WIDTH_PX = 1080;
export const THREAD_CONTENT_INDEX_GUTTER_PX = 64;
export const THREAD_CONTENT_COMPACT_GUTTER_PX = 10;

export const NEW_THREAD_COMPOSER_WIDTH = "min(clamp(46rem, 74%, 876px), 100%)";
export const NEW_THREAD_COMPOSER_WIDTH_CLASS_NAME = "mx-auto w-[var(--new-thread-composer-width)]";

export const THREAD_INDEX_HIDE_WIDTH_PX =
  THREAD_CONTENT_INDEX_RELEASE_WIDTH_PX + THREAD_CONTENT_INDEX_GUTTER_PX * 2;
export const THREAD_SIDEBAR_AUTO_COLLAPSE_WIDTH_PX =
  THREAD_CONTENT_MIN_WIDTH_PX + THREAD_CONTENT_COMPACT_GUTTER_PX * 2;

// Resolve the content column once on the responsive grid shared by the viewport and footer.
// Only the index gutter animates on a responsive state change; viewport width stays immediate.
export const THREAD_CONTENT_WIDTH = `clamp(min(${THREAD_CONTENT_INDEX_RELEASE_WIDTH_PX}px, calc(100% - (var(--thread-viewport-inline-padding) + var(--scrollbar-hit-size)) * 2)), calc(100% - var(--thread-content-inline-gutter) * 2), ${THREAD_CONTENT_MAX_WIDTH_PX}px)`;

export const THREAD_CONTENT_WIDTH_CLASS_NAME = "w-full min-w-0 max-w-full";

export const THREAD_VIEWPORT_CONTENT_WIDTH_CLASS_NAME = `${THREAD_CONTENT_WIDTH_CLASS_NAME} relative col-start-2`;

export interface ThreadResponsiveLayout {
  conversationIndexHidden: boolean;
  sidebarAutoCollapsed: boolean;
}

/** Resolve gutter space from the final panel geometry, independently of auto-collapse policy. */
export function resolveTargetThreadWidth({
  currentThreadWidth,
  sidebarOccupiedWidth,
  sidebarTargetWidth,
  workspaceOccupiedWidth,
  workspaceTargetWidth,
}: {
  currentThreadWidth: number;
  sidebarOccupiedWidth: number;
  sidebarTargetWidth: number;
  workspaceOccupiedWidth: number;
  workspaceTargetWidth: number;
}): number | undefined {
  const widths = [
    currentThreadWidth,
    sidebarOccupiedWidth,
    sidebarTargetWidth,
    workspaceOccupiedWidth,
    workspaceTargetWidth,
  ];
  if (!widths.every(Number.isFinite)) return undefined;
  return Math.max(
    0,
    currentThreadWidth +
      sidebarOccupiedWidth -
      sidebarTargetWidth +
      workspaceOccupiedWidth -
      workspaceTargetWidth,
  );
}

export function resolveExpandedThreadWidth({
  currentThreadWidth,
  sidebarWidth,
  sidebarOccupiedWidth,
  workspaceWidth = 0,
  workspaceOccupiedWidth = 0,
}: {
  currentThreadWidth: number;
  sidebarWidth: number;
  sidebarOccupiedWidth: number;
  workspaceWidth?: number;
  workspaceOccupiedWidth?: number;
}): number | undefined {
  if (
    !Number.isFinite(currentThreadWidth) ||
    !Number.isFinite(sidebarWidth) ||
    !Number.isFinite(sidebarOccupiedWidth) ||
    !Number.isFinite(workspaceWidth) ||
    !Number.isFinite(workspaceOccupiedWidth)
  ) {
    return undefined;
  }

  const releasedSidebarWidth = Math.max(
    0,
    Math.max(0, sidebarWidth) - Math.max(0, sidebarOccupiedWidth),
  );
  return Math.max(
    0,
    currentThreadWidth -
      releasedSidebarWidth +
      Math.max(0, workspaceOccupiedWidth) -
      Math.max(0, workspaceWidth),
  );
}

export function resolveThreadResponsiveLayout(
  expandedThreadWidth: number,
): ThreadResponsiveLayout | undefined {
  if (!Number.isFinite(expandedThreadWidth)) return undefined;

  return {
    conversationIndexHidden: expandedThreadWidth <= THREAD_INDEX_HIDE_WIDTH_PX,
    sidebarAutoCollapsed: expandedThreadWidth <= THREAD_SIDEBAR_AUTO_COLLAPSE_WIDTH_PX,
  };
}
