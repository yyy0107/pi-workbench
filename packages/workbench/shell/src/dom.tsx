"use client";

import { createContext, useContext, useId, useMemo, type ReactNode } from "react";

export { resolveWorkbenchShellOwner } from "./shell/workbench-shell-owner";

export interface WorkbenchDomIds {
  readonly rightWorkspace: string;
  readonly rightWorkspaceAuxiliaryPane: string;
  readonly rightWorkspaceTabIdPrefix: string;
  readonly rightWorkspaceTabPanelIdPrefix: string;
}

const WorkbenchDomIdsContext = createContext<WorkbenchDomIds | undefined>(undefined);

function createWorkbenchDomIds(scopeId: string): WorkbenchDomIds {
  return Object.freeze({
    rightWorkspace: `${scopeId}-right-workspace`,
    rightWorkspaceAuxiliaryPane: `${scopeId}-right-workspace-auxiliary-pane`,
    rightWorkspaceTabIdPrefix: `${scopeId}-right-workspace-tab`,
    rightWorkspaceTabPanelIdPrefix: `${scopeId}-right-workspace-tabpanel`,
  });
}

/** Owns stable DOM IDREF targets for one reusable Workbench installation. */
export function WorkbenchDomIdsProvider({ children }: Readonly<{ children: ReactNode }>) {
  const scopeId = useId();
  const ids = useMemo(() => createWorkbenchDomIds(scopeId), [scopeId]);

  return <WorkbenchDomIdsContext.Provider value={ids}>{children}</WorkbenchDomIdsContext.Provider>;
}

/** Resolve DOM IDREF targets owned by the nearest WorkbenchShell installation. */
export function useWorkbenchDomIds(): WorkbenchDomIds {
  const ids = useContext(WorkbenchDomIdsContext);
  if (!ids) {
    throw new Error("useWorkbenchDomIds must be used within WorkbenchDomIdsProvider");
  }
  return ids;
}
