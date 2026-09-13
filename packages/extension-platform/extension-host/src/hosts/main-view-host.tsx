"use client";

import { useCallback, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";

import { useExtensionEnvironment } from "../extension-context";
import { ExtensionErrorBoundary } from "./extension-error-boundary";

const NO_MAIN_VIEW = undefined;

export interface MainViewHostProps {
  children: ReactNode;
  /**
   * The application supplies a stable navigation identity (for example, its current pathname).
   * Main Views are transient and close when that identity changes, without coupling the generic
   * host to a particular router.
   */
  navigationKey?: unknown;
}

export function MainViewHost({ children, navigationKey }: Readonly<MainViewHostProps>) {
  const { mainViews, manager, reportError } = useExtensionEnvironment();
  const previousNavigationKey = useRef(navigationKey);
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
    if (Object.is(previousNavigationKey.current, navigationKey)) return;
    previousNavigationKey.current = navigationKey;
    mainViews.close();
  }, [mainViews, navigationKey]);

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
