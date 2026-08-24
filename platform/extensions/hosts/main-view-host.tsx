"use client";

import { usePathname } from "next/navigation";
import { useCallback, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";

import { useExtensionEnvironment } from "../extension-context";
import { ExtensionErrorBoundary } from "./extension-error-boundary";

const NO_MAIN_VIEW = undefined;

export function MainViewHost({ children }: Readonly<{ children: ReactNode }>) {
  const { mainViews, manager, reportError } = useExtensionEnvironment();
  const pathname = usePathname();
  const previousPathname = useRef(pathname);
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

  useLayoutEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;
    mainViews.close();
  }, [mainViews, pathname]);

  if (!activeView || !definition) return children;

  const MainView = definition.component;

  return (
    <div className="h-full min-h-0" data-main-view-host={definition.kind}>
      <ExtensionErrorBoundary
        key={definition.kind}
        contributionId={definition.kind}
        source="main-view"
        resetKey={activeView.revision}
        fallback={children}
        onError={reportError}
      >
        <MainView view={activeView} close={mainViews.close} />
      </ExtensionErrorBoundary>
    </div>
  );
}
