import type { ThreadListItem } from "@workbench/agent-runtime-client";
import type { WorkspaceSummary } from "@workbench/agent-runtime-client/workspaces";
import { groupSidebarThreads } from "../src/thread-list-groups";
import { resolveSidebarThreadWorkspaceId } from "@workbench/shell-context/navigation-policy";
import { resolveThreadOrder } from "./thread-sort";
import {
  sidebarWorkspaceKey,
  sidebarThreadKey,
  type SidebarItem,
  type SidebarMoveModel,
} from "../src/sidebar-move";
export function projectSidebar({
  threadsInput,
  workspaces,
  mainThreadId,
  draftWorkspaceId,
  manualOrders,
  canPin,
  canMoveWithinWorkspace,
}: {
  threadsInput: readonly ThreadListItem[];
  workspaces: readonly WorkspaceSummary[];
  mainThreadId?: string;
  draftWorkspaceId?: string;
  manualOrders: Readonly<Record<string, readonly string[]>>;
  canPin: boolean;
  canMoveWithinWorkspace: boolean;
}) {
  const threads = threadsInput.filter((thread) => !thread.isArchived);
  const threadsById = new Map(threads.map((thread) => [thread.threadId, thread]));
  const groups = groupSidebarThreads({
    threads,
    mainThreadId,
    draftWorkspaceId: draftWorkspaceId,
  });
  const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  const pinnedDirectories = workspaces.filter((workspace) => workspace.pinned === true);
  const directories = workspaces.filter((workspace) => workspace.pinned !== true);
  const items = new Map<string, SidebarItem>([
    ["group:pinned", { key: "group:pinned", kind: "group", id: "pinned" }],
    ["group:projects", { key: "group:projects", kind: "group", id: "projects" }],
  ]);
  for (const workspace of workspaces) {
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
      canPin: canPin,
      workspaceId: resolveSidebarThreadWorkspaceId({
        managedWorkspaceId: thread.workspace?.id,
        isMainThread: thread.threadId === mainThreadId,
        draftWorkspaceId: draftWorkspaceId,
      }),
    });
  }
  const orders = new Map<string, readonly string[]>([
    ["workspaces:pinned", pinnedDirectories.map((workspace) => sidebarWorkspaceKey(workspace.id))],
    ["workspaces:projects", directories.map((workspace) => sidebarWorkspaceKey(workspace.id))],
  ]);
  const createdAt = new Map(threads.map((thread) => [thread.threadId, thread.createdAt]));
  const threadScopes: [string, readonly string[]][] = [
    ["pinned", groups.pinnedThreadIds],
    ["ungrouped", groups.ungroupedThreadIds],
    ...workspaces.map((workspace): [string, readonly string[]] => [
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
        scope.startsWith("workspace:") && canMoveWithinWorkspace,
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
}
