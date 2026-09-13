"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAgentRuntime, useCurrentSession, useThreadList } from "@workbench/agent-runtime-client";
import {
  useWorkspaceCapabilities,
  useWorkspaceSelection,
} from "@workbench/agent-runtime-client/workspaces";

import {
  useSidebarDragSession,
  useSidebarDragState,
  type SidebarDropPosition,
} from "@workbench/ui-sidebar/reorder";
import { useTranslationBundle } from "@workbench/i18n";
import { sidebarTranslationBundle } from "./i18n";
import { useWorkbenchNavigation } from "@workbench/shell-context/navigation";

import { useHydrateThreadOrderStore, useThreadOrderStore } from "./thread-order-store";

import { commitSidebarMove, resolveSidebarMove } from "./sidebar-move";

import { projectSidebar } from "../lib/sidebar-projection";
import type { WorkspaceSidebarState } from "./sidebar-contracts";
export function useWorkspaceSidebarController(searchQuery: string): WorkspaceSidebarState {
  const { t } = useTranslationBundle(sidebarTranslationBundle);
  const runtime = useAgentRuntime();
  const navigation = useWorkbenchNavigation();
  const current = useCurrentSession();
  const threadList = useThreadList();
  const selection = useWorkspaceSelection();
  const capabilities = useWorkspaceCapabilities();
  const session = useSidebarDragSession();
  const dragState = useSidebarDragState();
  useHydrateThreadOrderStore();
  const manualOrders = useThreadOrderStore((state) => state.manualOrderByScope);
  const setManualOrder = useThreadOrderStore((state) => state.setManualOrder);
  const [expandedGroups, setExpandedGroups] = useState({ pinned: true, projects: true });
  const [error, setError] = useState<string>();
  const [revealedWorkspaceId, setRevealedWorkspaceId] = useState<string>();
  const searchActive = searchQuery.trim().length > 0;
  // Current selection only affects grouping while a draft workspace needs a fallback.
  const mainThreadId = selection.draftWorkspaceId ? current.threadId : undefined;

  const data = useMemo(() => {
    return projectSidebar({
      threadsInput: threadList.threads,
      workspaces: selection.workspaces,
      mainThreadId,
      draftWorkspaceId: selection.draftWorkspaceId,
      manualOrders,
      canPin: Boolean(runtime.threadActions.setPinned),
      canMoveWithinWorkspace: Boolean(runtime.threadActions.moveWithinWorkspace),
    });
  }, [
    mainThreadId,
    manualOrders,
    runtime.threadActions,
    selection.draftWorkspaceId,
    selection.workspaces,
    threadList.threads,
  ]);

  const latest = useRef({ data, searchActive });
  latest.current = { data, searchActive };
  useEffect(() => {
    if (searchActive) session.cancel();
  }, [searchActive, session]);
  const setGroupExpanded = useCallback((group: "pinned" | "projects", expanded: boolean) => {
    setExpandedGroups((state) => ({ ...state, [group]: expanded }));
  }, []);
  const move = useCallback(
    async (
      sourceKey: string,
      targetKey: string,
      position: SidebarDropPosition,
      pinMenu = false,
    ) => {
      const { data: currentData, searchActive: searching } = latest.current;
      const operation = resolveSidebarMove(currentData.model, sourceKey, targetKey, position);
      if (!operation || (searching && !(pinMenu && operation.pinChanged))) return;
      setError(undefined);
      const { source } = operation;
      const result = await commitSidebarMove(operation, {
        setPinned: async () => {
          if (source.kind === "workspace")
            await capabilities.setWorkspacePinned(source.id, operation.pinned);
          else await runtime.threadActions.setPinned?.(source.id, operation.pinned);
        },
        saveOrder: async () => {
          if (source.kind === "workspace") {
            await capabilities.moveWorkspaceBefore(source.id, operation.beforeId);
          } else if (
            !operation.pinned &&
            source.workspaceId &&
            runtime.threadActions.moveWithinWorkspace
          ) {
            await runtime.threadActions.moveWithinWorkspace({
              workspaceId: source.workspaceId,
              threadId: source.id,
              beforeThreadId: operation.beforeId,
            });
          } else {
            const ids = operation.order!.map((key) => currentData.model.items.get(key)!.id);
            await setManualOrder(operation.scope.slice("threads:".length), ids);
          }
        },
      });
      if (!result.ok) {
        console.error("[workbench] failed to save sidebar move", result.error);
        setError(
          t(
            result.phase === "pin"
              ? "workbench.sidebar.movePinFailed"
              : operation.pinChanged
                ? "workbench.sidebar.moveOrderFailedAfterPin"
                : "workbench.sidebar.moveOrderFailed",
          ),
        );
        if (result.phase === "pin") return;
      }
      if (source.kind === "workspace" || operation.pinned) {
        setGroupExpanded(operation.pinned ? "pinned" : "projects", true);
        if (source.kind === "workspace") setRevealedWorkspaceId(source.id);
      } else {
        const workspace = source.workspaceId
          ? currentData.workspaceById.get(source.workspaceId)
          : undefined;
        setGroupExpanded(workspace?.pinned ? "pinned" : "projects", true);
        if (workspace) {
          capabilities.setWorkspaceCollapsed(workspace.id, false);
          setRevealedWorkspaceId(workspace.id);
        }
      }
    },
    [capabilities, runtime, setGroupExpanded, setManualOrder, t],
  );

  const threadActions = useMemo(
    () => ({ archive: runtime.threadActions.archive, setPinned: runtime.threadActions.setPinned }),
    [runtime.threadActions.archive, runtime.threadActions.setPinned],
  );
  const workspaceActions = useMemo(
    () => ({
      openWorkspaceFolder: capabilities.openWorkspaceFolder,
      destroyNewThread: capabilities.destroyNewThread,
      activateWorkspace: capabilities.activateWorkspace,
      deactivateWorkspace: capabilities.deactivateWorkspace,
      removeWorkspace: capabilities.removeWorkspace,
      setWorkspaceCollapsed: capabilities.setWorkspaceCollapsed,
    }),
    [
      capabilities.openWorkspaceFolder,
      capabilities.destroyNewThread,
      capabilities.activateWorkspace,
      capabilities.deactivateWorkspace,
      capabilities.removeWorkspace,
      capabilities.setWorkspaceCollapsed,
    ],
  );
  const viewNavigation = useMemo(
    () => ({
      isHome: navigation.isHome,
      currentConversationId: navigation.currentConversationId,
      openHome: navigation.openHome,
      openConversation: navigation.openConversation,
    }),
    [
      navigation.isHome,
      navigation.currentConversationId,
      navigation.openHome,
      navigation.openConversation,
    ],
  );
  const viewSelection = useMemo(
    () => ({
      workspaces: selection.workspaces,
      activeWorkspaceId: selection.activeWorkspaceId,
      draftWorkspaceId: selection.draftWorkspaceId,
      collapsedWorkspaceIds: selection.collapsedWorkspaceIds,
    }),
    [
      selection.workspaces,
      selection.activeWorkspaceId,
      selection.draftWorkspaceId,
      selection.collapsedWorkspaceIds,
    ],
  );
  return {
    ...data,
    navigation: viewNavigation,
    activeThreadId: current.threadId,
    selection: viewSelection,
    workspaceActions,
    threadActions,
    switchToNewThread: runtime.switchToNewThread,
    isLoading: threadList.isLoading,
    searchQuery,
    searchActive,
    dragState,
    session,
    expandedGroups,
    setGroupExpanded,
    error,
    revealedWorkspaceId,
    move,
  };
}
