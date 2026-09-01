import type { ReactNode } from "react";

export {
  NEW_THREAD_COMPOSER_WIDTH,
  NEW_THREAD_COMPOSER_WIDTH_CLASS_NAME,
  THREAD_CONTENT_COMPACT_GUTTER_PX,
  THREAD_CONTENT_GUTTER_TRANSITION_CLASS_NAME,
  THREAD_CONTENT_INDEX_GUTTER_PX,
  THREAD_CONTENT_INDEX_RELEASE_WIDTH_PX,
  THREAD_CONTENT_MAX_WIDTH_PX,
  THREAD_CONTENT_MIN_WIDTH_PX,
  THREAD_CONTENT_WIDTH_CLASS_NAME,
  THREAD_INDEX_HIDE_WIDTH_PX,
  THREAD_SIDEBAR_AUTO_COLLAPSE_WIDTH_PX,
  THREAD_VIEWPORT_CONTENT_WIDTH_CLASS_NAME,
  resolveExpandedThreadWidth,
  resolveThreadResponsiveLayout,
} from "./layout/thread-content-width";
export type { ThreadResponsiveLayout } from "./layout/thread-content-width";

export function WorkbenchMain({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <main
      data-workbench-surface="main"
      className="bg-background min-h-0 min-w-0 flex-1 overflow-hidden"
    >
      {children}
    </main>
  );
}
