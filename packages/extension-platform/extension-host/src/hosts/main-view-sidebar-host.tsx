"use client";

import { useCallback, useSyncExternalStore, type ReactNode } from "react";

import { useExtensionEnvironment } from "../extension-context";
import { ExtensionErrorBoundary } from "./extension-error-boundary";

const NO_MAIN_VIEW = undefined;

export function MainViewSidebarHost({
  children,
  mobile,
  rail = false,
  onNavigate,
}: Readonly<{
  children: ReactNode;
  mobile: boolean;
  rail?: boolean;
  onNavigate?: () => void;
}>) {
  const { mainViews, manager, reportError } = useExtensionEnvironment();
  const activeView = useSyncExternalStore(
    mainViews.subscribe,
    mainViews.getSnapshot,
    mainViews.getInitialSnapshot,
  );
  const getDefinition = useCallback(
    () => (activeView ? manager.mainViews.get(activeView.kind) : NO_MAIN_VIEW),
    [activeView, manager],
  );
  const definition = useSyncExternalStore(
    manager.mainViews.subscribe,
    getDefinition,
    () => NO_MAIN_VIEW,
  );

  const MainViewSidebar = rail ? definition?.sidebarRail : definition?.sidebar;
  if (!activeView || !MainViewSidebar) return children;

  return (
    <div
      className="h-full min-h-0 shrink-0"
      data-main-view-sidebar-host={activeView.kind}
      data-main-view-sidebar-rail={rail ? "" : undefined}
    >
      <ExtensionErrorBoundary
        key={activeView.kind}
        contributionId={`${activeView.kind}.sidebar`}
        source="main-view"
        resetKey={activeView.revision}
        fallback={children}
        onError={reportError}
      >
        <MainViewSidebar
          view={activeView}
          close={mainViews.close}
          mobile={mobile}
          onNavigate={onNavigate}
        />
      </ExtensionErrorBoundary>
    </div>
  );
}
