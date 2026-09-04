export const THREAD_CONTENT_MIN_WIDTH_PX = 448;
export const THREAD_CONTENT_INDEX_RELEASE_WIDTH_PX = 832;
export const THREAD_CONTENT_MAX_WIDTH_PX = 1080;
export const THREAD_CONTENT_INDEX_GUTTER_PX = 64;
export const THREAD_CONTENT_COMPACT_GUTTER_PX = 10;

export const NEW_THREAD_COMPOSER_WIDTH = "min(clamp(46rem, 74cqw, 876px), calc(100cqw - 2rem))";
export const NEW_THREAD_COMPOSER_WIDTH_CLASS_NAME = "mx-auto w-[var(--new-thread-composer-width)]";

export const THREAD_INDEX_HIDE_WIDTH_PX =
  THREAD_CONTENT_INDEX_RELEASE_WIDTH_PX + THREAD_CONTENT_INDEX_GUTTER_PX * 2;
export const THREAD_SIDEBAR_AUTO_COLLAPSE_WIDTH_PX =
  THREAD_CONTENT_MIN_WIDTH_PX + THREAD_CONTENT_COMPACT_GUTTER_PX * 2;

export const THREAD_CONTENT_GUTTER_TRANSITION_CLASS_NAME =
  "transition-[--thread-content-inline-gutter] duration-(--layout-motion-duration) ease-(--layout-motion-ease) data-[resizing=true]:transition-none motion-reduce:transition-none";

export const THREAD_CONTENT_WIDTH_CLASS_NAME =
  "w-[var(--thread-content-width)] min-w-[var(--thread-content-min-width)] max-w-[var(--thread-content-max-width)]";

export const THREAD_VIEWPORT_CONTENT_WIDTH_CLASS_NAME = `${THREAD_CONTENT_WIDTH_CLASS_NAME} relative [inset-inline-start:min(0px,calc((100%-clamp(var(--thread-content-min-width),var(--thread-content-width),var(--thread-content-max-width)))/2))]`;

export interface ThreadResponsiveLayout {
  conversationIndexHidden: boolean;
  sidebarAutoCollapsed: boolean;
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
