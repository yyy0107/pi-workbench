import type {
  ConversationNode,
  ToolCallBlock,
} from "@workbench/agent-runtime-contracts/conversation";

export interface TodoItem {
  readonly id: string;
  readonly text: string;
  readonly status: "pending" | "in_progress" | "completed";
  readonly description?: string;
  readonly activeForm?: string;
  readonly owner?: string;
  readonly blockedBy?: readonly string[];
}

export interface TodoSnapshot {
  readonly toolName: string;
  readonly items: readonly TodoItem[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isStatus(value: unknown): value is TodoItem["status"] {
  return value === "pending" || value === "in_progress" || value === "completed";
}

function workbenchItems(value: unknown): TodoItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items: TodoItem[] = [];
  for (const [index, raw] of value.entries()) {
    const item = record(raw);
    if (!item || typeof item.text !== "string" || !item.text.trim() || !isStatus(item.status)) {
      return undefined;
    }
    // This tool replaces the whole list and does not provide persistent item IDs.
    items.push({ id: String(index), text: item.text, status: item.status });
  }
  return items;
}

function rpivItems(value: unknown): TodoItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items: TodoItem[] = [];
  const ids = new Set<number>();
  for (const raw of value) {
    const item = record(raw);
    if (
      !item ||
      typeof item.id !== "number" ||
      !Number.isSafeInteger(item.id) ||
      item.id < 1 ||
      ids.has(item.id) ||
      typeof item.subject !== "string" ||
      (!isStatus(item.status) && item.status !== "deleted") ||
      (item.blockedBy !== undefined &&
        (!Array.isArray(item.blockedBy) ||
          !item.blockedBy.every((id) => Number.isSafeInteger(id) && id > 0)))
    ) {
      return undefined;
    }
    ids.add(item.id);
    if (item.status === "deleted") continue;
    items.push({
      id: String(item.id),
      text: item.subject,
      status: item.status,
      ...(typeof item.description === "string" ? { description: item.description } : {}),
      ...(typeof item.activeForm === "string" ? { activeForm: item.activeForm } : {}),
      ...(typeof item.owner === "string" ? { owner: item.owner } : {}),
      ...(Array.isArray(item.blockedBy) ? { blockedBy: item.blockedBy.map(String) } : {}),
    });
  }
  return items;
}

/** Add a tool's snapshot decoder here; the panel and timeline share these adapters. */
export const todoAdapters: Readonly<
  Record<string, (block: ToolCallBlock) => readonly TodoItem[] | undefined>
> = {
  workbench_todo: (block) => {
    const details = record(record(block.result)?.details);
    return workbenchItems(
      details && "items" in details ? details.items : record(block.arguments)?.items,
    );
  },
  todo: (block) => rpivItems(record(record(block.result)?.details)?.tasks),
};

export function isTodoTool(toolName: string): boolean {
  return Object.hasOwn(todoAdapters, toolName);
}

/** Ignore partial, failed, or malformed updates so they cannot replace the last valid list. */
export function readTodoSnapshot(block: ToolCallBlock): TodoSnapshot | undefined {
  if (block.status !== "complete" || block.error || !isTodoTool(block.toolName)) return undefined;
  const result = record(block.result);
  if (result?.error !== undefined || record(result?.details)?.error !== undefined) return undefined;
  const items = todoAdapters[block.toolName]?.(block);
  return items === undefined ? undefined : { toolName: block.toolName, items };
}

/** Derive from the active branch; never retain task state across sessions or branch changes. */
export function latestTodoSnapshots(nodes: readonly ConversationNode[]): TodoSnapshot[] {
  const latest = new Map<string, TodoSnapshot>();
  for (const node of nodes) {
    if (node.kind !== "assistant") continue;
    for (const block of node.blocks) {
      if (block.kind !== "tool-call") continue;
      const snapshot = readTodoSnapshot(block);
      if (snapshot) latest.set(snapshot.toolName, snapshot);
    }
  }
  // The built-in rpiv tool replaces workbench_todo; retired tasks remain visible in history only.
  if (latest.has("todo")) latest.delete("workbench_todo");
  // An empty snapshot clears only its own source, including rpiv's tombstoned-only list.
  return [...latest.values()].filter((snapshot) => snapshot.items.length > 0);
}
