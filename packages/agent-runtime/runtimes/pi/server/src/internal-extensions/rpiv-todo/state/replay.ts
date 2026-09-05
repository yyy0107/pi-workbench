// Adapted from @juicesharp/rpiv-todo 2.9.0 (MIT); see ../LICENSE.
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Task } from "../tool/types";
import type { TaskState } from "./state";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isTask(value: unknown): value is Task {
  if (!isRecord(value) || !isId(value.id) || typeof value.subject !== "string") return false;
  if (
    typeof value.status !== "string" ||
    !["pending", "in_progress", "completed", "deleted"].includes(value.status)
  )
    return false;
  for (const field of ["description", "activeForm", "owner"]) {
    if (value[field] !== undefined && typeof value[field] !== "string") return false;
  }
  if (
    value.blockedBy !== undefined &&
    (!Array.isArray(value.blockedBy) || !value.blockedBy.every(isId))
  ) {
    return false;
  }
  return value.metadata === undefined || isRecord(value.metadata);
}

/** Last valid full snapshot on the current branch wins, including before a compaction entry. */
export function replayFromBranch(ctx: Pick<ExtensionContext, "sessionManager">): TaskState {
  let state: TaskState = { tasks: [], nextId: 1 };
  for (const entry of ctx.sessionManager.getBranch()) {
    if (
      entry.type !== "message" ||
      entry.message.role !== "toolResult" ||
      entry.message.toolName !== "todo"
    ) {
      continue;
    }
    const details: unknown = entry.message.details;
    if (!isRecord(details) || !isId(details.nextId) || !Array.isArray(details.tasks)) continue;
    if (!details.tasks.every(isTask)) continue;
    const nextId = details.nextId;
    const ids = details.tasks.map((task) => task.id);
    if (new Set(ids).size !== ids.length || ids.some((id) => id >= nextId)) continue;
    state = { tasks: details.tasks.map((task) => ({ ...task })), nextId };
  }
  return state;
}
