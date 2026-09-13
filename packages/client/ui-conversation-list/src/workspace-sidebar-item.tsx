"use client";
import { useShallow } from "zustand/react/shallow";
import { useSidebarPointerReorder, type SidebarDropPosition } from "@workbench/ui-sidebar/reorder";
import { canStartSidebarDrag, sidebarDropPosition, sidebarItemScope } from "./sidebar-move";
import { useWorkspaceSidebar } from "./sidebar-context";
export function useWorkspaceSidebarItem(key: string) {
  const context = useWorkspaceSidebar(
    useShallow((state) => ({
      model: state.model,
      searchActive: state.searchActive,
      searchQuery: state.searchQuery,
      dragState: state.dragState,
      session: state.session,
      move: state.move,
    })),
  );
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
