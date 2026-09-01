import { PanelDock } from "./panel-dock";

/** Terminal panels live outside RightWorkspace so hiding the inspector never owns their lifecycle. */
export function TerminalDrawer() {
  return <PanelDock location="bottom" />;
}
