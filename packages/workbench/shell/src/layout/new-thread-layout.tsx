"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

interface NewThreadLayout {
  readonly dockComposerWhenEmpty: boolean;
  setDockComposerWhenEmpty(docked: boolean): void;
}

const NewThreadLayoutContext = createContext<NewThreadLayout | undefined>(undefined);

/** The new-conversation entry owns placement; changing projects may replace the draft Session. */
export function NewThreadLayoutProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [dockComposerWhenEmpty, setDockComposerWhenEmpty] = useState(false);
  const layout = useMemo(
    () => ({ dockComposerWhenEmpty, setDockComposerWhenEmpty }),
    [dockComposerWhenEmpty],
  );

  return (
    <NewThreadLayoutContext.Provider value={layout}>{children}</NewThreadLayoutContext.Provider>
  );
}

export function useNewThreadLayout(): NewThreadLayout {
  const layout = useContext(NewThreadLayoutContext);
  if (!layout) throw new Error("New thread layout requires WorkbenchNavigationProvider.");
  return layout;
}
