// Adapted from @juicesharp/rpiv-todo 2.9.0 (MIT); see ../LICENSE.
import type { TaskState } from "../state/state";
import type { Op } from "../state/state-reducer";
import { deriveBlocks } from "../state/task-graph";
import { sanitizeTerminalText } from "./sanitize";
import type { Task, TaskAction, TaskDetails, TaskMutationParams } from "./types";

function formatListLine(t: Task): string {
  const block = t.blockedBy?.length ? ` ⛓ ${t.blockedBy.map((id) => `#${id}`).join(",")}` : "";
  const form =
    t.status === "in_progress" && t.activeForm ? ` (${sanitizeTerminalText(t.activeForm)})` : "";
  return `[${t.status}] #${t.id} ${sanitizeTerminalText(t.subject)}${form}${block}`;
}

function formatGetLines(task: Task, state: TaskState): string {
  const blocks = deriveBlocks(state.tasks).get(task.id) ?? [];
  const lines = [`#${task.id} [${task.status}] ${sanitizeTerminalText(task.subject)}`];
  if (task.description) lines.push(`  description: ${sanitizeTerminalText(task.description)}`);
  if (task.activeForm) lines.push(`  activeForm: ${sanitizeTerminalText(task.activeForm)}`);
  if (task.blockedBy?.length) {
    lines.push(`  blockedBy: ${task.blockedBy.map((id) => `#${id}`).join(", ")}`);
  }
  if (blocks.length) {
    lines.push(`  blocks: ${blocks.map((id) => `#${id}`).join(", ")}`);
  }
  if (task.owner) lines.push(`  owner: ${sanitizeTerminalText(task.owner)}`);
  return lines.join("\n");
}

export function formatContent(op: Op, state: TaskState): string {
  switch (op.kind) {
    case "create": {
      const t = state.tasks.find((x) => x.id === op.taskId);
      // Defensive — `op.taskId` always resolves on success path.
      if (!t) return `Created #${op.taskId}`;
      return `Created #${t.id}: ${sanitizeTerminalText(t.subject)} (pending)`;
    }
    case "update": {
      if (!op.changed) {
        return `No change: #${op.id} already matches the requested values (status: ${op.toStatus})`;
      }
      const transition =
        op.fromStatus !== op.toStatus ? ` (${op.fromStatus} → ${op.toStatus})` : "";
      return `Updated #${op.id}${transition}`;
    }
    case "delete":
      return `Deleted #${op.id}: ${sanitizeTerminalText(op.subject)}`;
    case "clear":
      return `Cleared ${op.count} tasks`;
    case "list": {
      let view = state.tasks;
      if (!op.includeDeleted) view = view.filter((t) => t.status !== "deleted");
      if (op.statusFilter) view = view.filter((t) => t.status === op.statusFilter);
      return view.length === 0 ? "No tasks" : view.map(formatListLine).join("\n");
    }
    case "get":
      return formatGetLines(op.task, state);
    case "error":
      return `Error: ${op.message}`;
  }
}

export function buildToolResult(
  action: TaskAction,
  params: TaskMutationParams,
  state: TaskState,
  op: Op,
): { content: Array<{ type: "text"; text: string }>; details: TaskDetails } {
  const text = formatContent(op, state);
  const details: TaskDetails = {
    action,
    params: params as Record<string, unknown>,
    tasks: state.tasks,
    nextId: state.nextId,
    ...(op.kind === "error" ? { error: op.message } : {}),
  };
  return { content: [{ type: "text", text }], details };
}
