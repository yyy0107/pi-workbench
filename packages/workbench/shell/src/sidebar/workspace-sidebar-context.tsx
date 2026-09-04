"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { useAgentRuntime, useCurrentSession, useThreadList } from "@workbench/agent-runtime-client";
import {
  useWorkspaceCapabilities,
  useWorkspaceSelection,
} from "@workbench/agent-runtime-client/workspaces";

import {
  useSidebarDragSession,
  useSidebarDragState,
  useSidebarPointerReorder,
  type SidebarDropPosition,
} from "../hooks/use-sidebar-pointer-reorder";
import { useI18n } from "../i18n";
import { resolveSidebarThreadWorkspaceId } from "../new-thread-policy";
import { DropdownMenuItem } from "../ui/dropdown-menu";
import { groupSidebarThreads } from "./thread-list-groups";
import { useHydrateThreadOrderStore, useThreadOrderStore } from "./thread-order-store";
import { resolveThreadOrder } from "./thread-sort";
import {
  commitSidebarMove,
  canStartSidebarDrag,
  resolveSidebarMove,
  sidebarDropPosition,
  sidebarItemScope,
  sidebarThreadKey,
  sidebarThreadScope,
  sidebarWorkspaceKey,
  type SidebarItem,
  type SidebarMoveModel,
} from "./sidebar-move";

function useWorkspaceSidebarController(searchQuery: string) {
  const { t } = useI18n();
  const runtime = useAgentRuntime();
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

  const data = useMemo(() => {
    const threads = threadList.threads.filter((thread) => !thread.isArchived);
    const threadsById = new Map(threads.map((thread) => [thread.threadId, thread]));
    const groups = groupSidebarThreads({
      threads,
      mainThreadId: current.threadId,
      draftWorkspaceId: selection.draftWorkspaceId,
    });
    const workspaceById = new Map(
      selection.workspaces.map((workspace) => [workspace.id, workspace]),
    );
    const pinnedDirectories = selection.workspaces.filter((workspace) => workspace.pinned === true);
    const directories = selection.workspaces.filter((workspace) => workspace.pinned !== true);
    const items = new Map<string, SidebarItem>([
      ["group:pinned", { key: "group:pinned", kind: "group", id: "pinned" }],
      ["group:projects", { key: "group:projects", kind: "group", id: "projects" }],
    ]);
    for (const workspace of selection.workspaces) {
      const key = sidebarWorkspaceKey(workspace.id);
      items.set(key, {
        key,
        kind: "workspace",
        id: workspace.id,
        pinned: workspace.pinned === true,
        canPin: true,
      });
    }
    for (const thread of threads) {
      const key = sidebarThreadKey(thread.threadId);
      items.set(key, {
        key,
        kind: "thread",
        id: thread.threadId,
        pinned: thread.isPinned,
        canPin: Boolean(runtime.threadActions.setPinned),
        workspaceId: resolveSidebarThreadWorkspaceId({
          managedWorkspaceId: thread.workspace?.id,
          isMainThread: thread.threadId === current.threadId,
          draftWorkspaceId: selection.draftWorkspaceId,
        }),
      });
    }
    const orders = new Map<string, readonly string[]>([
      [
        "workspaces:pinned",
        pinnedDirectories.map((workspace) => sidebarWorkspaceKey(workspace.id)),
      ],
      ["workspaces:projects", directories.map((workspace) => sidebarWorkspaceKey(workspace.id))],
    ]);
    const createdAt = new Map(threads.map((thread) => [thread.threadId, thread.createdAt]));
    const threadScopes: [string, readonly string[]][] = [
      ["pinned", groups.pinnedThreadIds],
      ["ungrouped", groups.ungroupedThreadIds],
      ...selection.workspaces.map((workspace): [string, readonly string[]] => [
        `workspace:${workspace.id}`,
        groups.threadIdsByWorkspace.get(workspace.id) ?? [],
      ]),
    ];
    for (const [scope, ids] of threadScopes) {
      orders.set(
        `threads:${scope}`,
        resolveThreadOrder(
          ids,
          createdAt,
          manualOrders[scope] ?? [],
          scope.startsWith("workspace:") && Boolean(runtime.threadActions.moveWithinWorkspace),
        ).map(sidebarThreadKey),
      );
    }
    return {
      model: { items, orders } satisfies SidebarMoveModel,
      threadsById,
      workspaceById,
      groups,
      pinnedDirectories,
      directories,
    };
  }, [
    current.threadId,
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
  const setGroupExpanded = (group: "pinned" | "projects", expanded: boolean) => {
    setExpandedGroups((state) => ({ ...state, [group]: expanded }));
  };
  const move = async (
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
  };

  return {
    ...data,
    current,
    selection,
    capabilities,
    runtime,
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

const WorkspaceSidebarContext = createContext<ReturnType<
  typeof useWorkspaceSidebarController
> | null>(null);

export function WorkspaceSidebarProvider({
  searchQuery,
  children,
}: {
  searchQuery: string;
  children: ReactNode;
}) {
  const value = useWorkspaceSidebarController(searchQuery);
  return (
    <WorkspaceSidebarContext.Provider value={value}>{children}</WorkspaceSidebarContext.Provider>
  );
}

export function useWorkspaceSidebar() {
  const context = useContext(WorkspaceSidebarContext);
  if (!context) throw new Error("Workspace sidebar rows require WorkspaceSidebarProvider");
  return context;
}

export function useWorkspaceSidebarItem(key: string) {
  const context = useWorkspaceSidebar();
  const item = context.model.items.get(key);
  const order =
    item && item.kind !== "group" ? (context.model.orders.get(sidebarItemScope(item)) ?? []) : [];
  const index = order.indexOf(key);
  const enabled = !context.searchActive && !context.dragState.pending;
  const drag = useSidebarPointerReorder({
    id: key,
    enabled: canStartSidebarDrag(
      context.model,
      key,
      context.searchQuery,
      context.dragState.pending,
    ),
    resolveDrop: (sourceKey, edge) =>
      context.searchActive ? undefined : sidebarDropPosition(context.model, sourceKey, key, edge),
    onDrop: (sourceKey, position) => context.move(sourceKey, key, position),
  });
  const run = (targetKey: string, position: SidebarDropPosition, pinMenu = false) => {
    void context.session
      .run(() => context.move(key, targetKey, position, pinMenu))
      .catch((error) => console.error("[workbench] sidebar action failed", error));
  };
  return {
    drag,
    canMoveUp: enabled && index > 0,
    canMoveDown: enabled && index >= 0 && index < order.length - 1,
    moveUp: () => {
      if (enabled && index > 0) run(order[index - 1]!, "before");
    },
    moveDown: () => {
      if (enabled && index >= 0 && index < order.length - 1) run(order[index + 1]!, "after");
    },
    togglePinned: () => {
      if (item && item.kind !== "group" && item.canPin)
        run(item.pinned ? "group:projects" : "group:pinned", "inside", true);
    },
  };
}

export function SidebarMoveMenuItems({
  controls,
}: {
  controls: ReturnType<typeof useWorkspaceSidebarItem>;
}) {
  const { t } = useI18n();
  return (
    <>
      <DropdownMenuItem disabled={!controls.canMoveUp} onClick={controls.moveUp}>
        <ArrowUpIcon />
        {t("workbench.sidebar.moveUp")}
      </DropdownMenuItem>
      <DropdownMenuItem disabled={!controls.canMoveDown} onClick={controls.moveDown}>
        <ArrowDownIcon />
        {t("workbench.sidebar.moveDown")}
      </DropdownMenuItem>
    </>
  );
}

export { sidebarThreadKey, sidebarWorkspaceKey, sidebarThreadScope };
