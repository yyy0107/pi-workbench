import type { ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { replayFromBranch } from "./rpiv-todo/state/replay";
import { applyTaskMutation } from "./rpiv-todo/state/state-reducer";
import type { TaskState } from "./rpiv-todo/state/state";
import { buildToolResult } from "./rpiv-todo/tool/response-envelope";
import { TOOL_NAME, TOOL_LABEL, TodoParamsSchema } from "./rpiv-todo/tool/types";

import { bindToolAvailability, type ToolCapabilitySettings } from "./tool-availability";

export const TODO_EXTENSION_NAME = "workbench.rpiv-todo";

// Tool guidance adapted from rpiv todo 2.9.0 (MIT); see ./rpiv-todo/LICENSE.
const DEFAULT_PROMPT_SNIPPET = "Manage a task list to track multi-step progress";
const DEFAULT_PROMPT_GUIDELINES: string[] = [
  "Use `todo` for complex work with 3+ steps, when the user gives you a list of tasks, or immediately after receiving new instructions to capture requirements. Skip it for single trivial tasks and purely conversational requests.",
  "When starting a task from the todo list, mark it in_progress BEFORE beginning work. Mark it completed IMMEDIATELY when done — never batch completions. Exactly one task in_progress at a time.",
  "Never mark a task completed if tests are failing, the implementation is partial, or you hit unresolved errors — keep it in_progress and create a new task for the blocker instead.",
  "Task status is a 4-state machine: pending → in_progress → completed, plus deleted as a tombstone. Pass activeForm (present-continuous label, e.g. 'researching existing tool') when marking in_progress.",
  'To change a task\'s status, call update with the task id and the target status, e.g. {"action":"update","id":3,"status":"completed"} or {"action":"update","id":3,"status":"in_progress","activeForm":"writing tests"}. status is the field that changes the task; an update without a mutable field (status or another) is rejected.',
  "Use blockedBy to express dependencies (A is blocked by B). On create, pass blockedBy as the initial set. On update, use addBlockedBy / removeBlockedBy (additive merge — do not resend the full array). Cycles are rejected.",
  "list hides tombstoned (deleted) tasks by default; pass includeDeleted:true to see them. Pass status to filter by a single status.",
  "Subject must be short and imperative (e.g. 'Research existing tool'); description is for long-form detail. activeForm is a present-continuous label shown while in_progress.",
];

export function createTodoExtension(settings?: ToolCapabilitySettings): ExtensionFactory {
  return (pi) => {
    const readEnabled = bindToolAvailability(pi, TOOL_NAME, settings, false);
    const states = new Map<string, TaskState>();
    const restore = (_event: unknown, ctx: ExtensionContext) => {
      states.set(ctx.sessionManager.getSessionId(), replayFromBranch(ctx));
    };
    pi.on("session_start", restore);
    pi.on("session_compact", restore);
    pi.on("session_tree", restore);
    // Workbench also selects branches directly through SessionManager, including regeneration.
    pi.on("agent_start", restore);
    pi.on("session_shutdown", (_event, ctx) => {
      states.delete(ctx.sessionManager.getSessionId());
    });

    pi.registerTool({
      name: TOOL_NAME,
      label: TOOL_LABEL,
      description:
        "Manage a task list for tracking multi-step progress. Actions: create (new task), update (change status/fields/dependencies), list (all tasks, optionally filtered by status), get (single task details), delete (tombstone), clear (reset all). Status: pending → in_progress → completed, plus deleted tombstone. Use this to plan and track multi-step work like research, design, and implementation.",
      promptSnippet: DEFAULT_PROMPT_SNIPPET,
      promptGuidelines: DEFAULT_PROMPT_GUIDELINES,
      parameters: TodoParamsSchema,
      async execute(_id, params, _signal, _onUpdate, ctx) {
        const enabled = await readEnabled();
        const id = ctx.sessionManager.getSessionId();
        const state = states.get(id) ?? replayFromBranch(ctx);
        if (!enabled) {
          return buildToolResult(params.action, params, state, {
            kind: "error",
            message: "Todo is disabled in Workbench settings; no tasks were changed.",
          });
        }
        const result = applyTaskMutation(state, params.action, params);
        // Commit before returning: another call may start before Pi persists this tool result.
        states.set(id, result.state);
        return buildToolResult(params.action, params, result.state, result.op);
      },
    });
  };
}

export const todoExtension = createTodoExtension();
