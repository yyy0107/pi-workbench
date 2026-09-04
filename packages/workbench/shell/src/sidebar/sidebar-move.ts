import type { SidebarDropPosition } from "../hooks/use-sidebar-pointer-reorder";

export type SidebarItem =
  | { key: string; kind: "group"; id: "pinned" | "projects" }
  | { key: string; kind: "workspace"; id: string; pinned: boolean; canPin: boolean }
  | {
      key: string;
      kind: "thread";
      id: string;
      pinned: boolean;
      canPin: boolean;
      workspaceId?: string;
    };
export interface SidebarMoveModel {
  items: ReadonlyMap<string, SidebarItem>;
  orders: ReadonlyMap<string, readonly string[]>;
}
export interface SidebarMove {
  source: Exclude<SidebarItem, { kind: "group" }>;
  pinned: boolean;
  pinChanged: boolean;
  scope: string;
  order?: readonly string[];
  beforeId?: string;
}
export const sidebarWorkspaceKey = (id: string) => `workspace:${id}`;
export const sidebarThreadKey = (id: string) => `thread:${id}`;
export const sidebarThreadScope = (workspaceId?: string) =>
  workspaceId ? `threads:workspace:${workspaceId}` : "threads:ungrouped";
export function sidebarItemScope(item: Exclude<SidebarItem, { kind: "group" }>): string {
  return item.kind === "workspace"
    ? `workspaces:${item.pinned ? "pinned" : "projects"}`
    : item.pinned
      ? "threads:pinned"
      : sidebarThreadScope(item.workspaceId);
}

export function canStartSidebarDrag(
  model: SidebarMoveModel,
  key: string,
  searchQuery: string,
  pending: boolean,
): boolean {
  const item = model.items.get(key);
  return (
    !searchQuery.trim() &&
    !pending &&
    Boolean(
      item &&
      item.kind !== "group" &&
      (item.canPin || (model.orders.get(sidebarItemScope(item))?.length ?? 0) > 1),
    )
  );
}

/** Only pin membership changes across scopes; a thread's workspace never changes here. */
export function resolveSidebarMove(
  model: SidebarMoveModel,
  sourceKey: string,
  targetKey: string,
  position: SidebarDropPosition,
): SidebarMove | undefined {
  const source = model.items.get(sourceKey);
  const target = model.items.get(targetKey);
  if (!source || !target || source.kind === "group" || sourceKey === targetKey) return;
  let pinned: boolean;
  let preserveOrder = false;
  if (target.kind === "group") {
    if (position !== "inside") return;
    pinned = target.id === "pinned";
    if (source.kind === "thread" && !pinned) {
      if (!source.pinned) return;
      preserveOrder = true;
    }
  } else if (source.kind === "workspace") {
    if (target.kind !== "workspace" || position === "inside") return;
    pinned = target.pinned;
  } else if (target.kind === "workspace") {
    if (position !== "inside" || !source.pinned || source.workspaceId !== target.id) return;
    pinned = false;
  } else {
    if (position === "inside" || (!target.pinned && source.workspaceId !== target.workspaceId))
      return;
    pinned = target.pinned;
  }
  const pinChanged = pinned !== source.pinned;
  if (pinChanged && !source.canPin) return;
  const scope = sidebarItemScope({ ...source, pinned });
  if (preserveOrder) return { source, pinned, pinChanged, scope };
  const currentOrder = model.orders.get(scope) ?? [];
  const order = currentOrder.filter((key) => key !== sourceKey);
  let insertionIndex = order.length;
  if (position !== "inside") {
    const targetIndex = order.indexOf(targetKey);
    if (targetIndex < 0) return;
    insertionIndex = targetIndex + (position === "after" ? 1 : 0);
  }
  const beforeKey = order[insertionIndex];
  order.splice(insertionIndex, 0, sourceKey);
  if (
    !pinChanged &&
    order.length === currentOrder.length &&
    order.every((key, index) => key === currentOrder[index])
  )
    return;
  return {
    source,
    pinned,
    pinChanged,
    scope,
    order,
    beforeId: beforeKey ? model.items.get(beforeKey)?.id : undefined,
  };
}

export function sidebarDropPosition(
  model: SidebarMoveModel,
  sourceKey: string,
  targetKey: string,
  edge: "before" | "after",
): SidebarDropPosition | undefined {
  const source = model.items.get(sourceKey);
  const target = model.items.get(targetKey);
  const position =
    target?.kind === "group" || (source?.kind === "thread" && target?.kind === "workspace")
      ? "inside"
      : edge;
  return resolveSidebarMove(model, sourceKey, targetKey, position) ? position : undefined;
}

/** A successful pin stays committed if the separate order write fails. */
export async function commitSidebarMove(
  move: SidebarMove,
  operations: {
    setPinned(): Promise<void>;
    saveOrder(): Promise<void>;
  },
): Promise<{ ok: true } | { ok: false; phase: "pin" | "order"; error: unknown }> {
  if (move.pinChanged) {
    try {
      await operations.setPinned();
    } catch (error) {
      return { ok: false, phase: "pin", error };
    }
  }
  if (move.order) {
    try {
      await operations.saveOrder();
    } catch (error) {
      return { ok: false, phase: "order", error };
    }
  }
  return { ok: true };
}
