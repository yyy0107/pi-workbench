import type { useAgentRuntime } from "@workbench/agent-runtime-client";
import type {
  useWorkspaceCapabilities,
  useWorkspaceSelection,
} from "@workbench/agent-runtime-client/workspaces";
import type { useWorkbenchNavigation } from "@workbench/shell-context/navigation";
import type {
  useSidebarDragSession,
  useSidebarDragState,
  SidebarDropPosition,
} from "@workbench/ui-sidebar/reorder";
import type { projectSidebar } from "../lib/sidebar-projection";

/** Explicit view surface: no complete Runtime or workspace capability facade. */
export interface WorkspaceSidebarState extends ReturnType<typeof projectSidebar> {
  navigation: Pick<
    ReturnType<typeof useWorkbenchNavigation>,
    "isHome" | "currentConversationId" | "openHome" | "openConversation"
  >;
  activeThreadId: string | undefined;
  selection: Pick<
    ReturnType<typeof useWorkspaceSelection>,
    "workspaces" | "activeWorkspaceId" | "draftWorkspaceId" | "collapsedWorkspaceIds"
  >;
  workspaceActions: Pick<
    ReturnType<typeof useWorkspaceCapabilities>,
    | "openWorkspaceFolder"
    | "destroyNewThread"
    | "activateWorkspace"
    | "deactivateWorkspace"
    | "removeWorkspace"
    | "setWorkspaceCollapsed"
  >;
  threadActions: Pick<ReturnType<typeof useAgentRuntime>["threadActions"], "archive" | "setPinned">;
  switchToNewThread: ReturnType<typeof useAgentRuntime>["switchToNewThread"];
  isLoading: boolean;
  searchQuery: string;
  searchActive: boolean;
  dragState: ReturnType<typeof useSidebarDragState>;
  session: Pick<ReturnType<typeof useSidebarDragSession>, "run">;
  expandedGroups: { pinned: boolean; projects: boolean };
  setGroupExpanded(group: "pinned" | "projects", expanded: boolean): void;
  error?: string;
  revealedWorkspaceId?: string;
  move(
    sourceKey: string,
    targetKey: string,
    position: SidebarDropPosition,
    pinMenu?: boolean,
  ): Promise<void>;
}
