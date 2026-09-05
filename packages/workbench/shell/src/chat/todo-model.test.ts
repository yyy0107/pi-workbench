import assert from "node:assert/strict";
import test from "node:test";
import type {
  ConversationNode,
  ToolCallBlock,
} from "@workbench/agent-runtime-contracts/conversation";

import { isTodoTool, latestTodoSnapshots, readTodoSnapshot } from "./todo-model";

function tool(toolName: string, fields: Partial<ToolCallBlock> = {}): ToolCallBlock {
  return {
    kind: "tool-call",
    key: toolName,
    callId: toolName,
    toolName,
    argumentsText: "{}",
    status: "complete",
    ...fields,
  };
}

function branch(...blocks: ToolCallBlock[]): ConversationNode[] {
  return [{ kind: "assistant", key: "reply", status: "complete", blocks }];
}

const pending = { text: "Implement", status: "pending" } as const;
const complete = { text: "Implement", status: "completed" } as const;
const workbench = tool("workbench_todo", { arguments: { items: [pending] } });
const rpiv = tool("todo", {
  arguments: { action: "list", status: "pending" },
  result: {
    text: "[pending] #2 Verify",
    details: {
      action: "list",
      nextId: 4,
      tasks: [
        { id: 1, subject: "Implement", status: "completed" },
        {
          id: 2,
          subject: "Verify",
          description: "Run the targeted checks",
          activeForm: "Running checks",
          status: "pending",
          blockedBy: [1],
          owner: "agent",
        },
        { id: 3, subject: "Removed", status: "deleted" },
      ],
    },
  },
});

test("reads Workbench history and prefers the committed result over submitted arguments", () => {
  assert.deepEqual(readTodoSnapshot(workbench)?.items, [{ id: "0", ...pending }]);
  assert.deepEqual(
    readTodoSnapshot({
      ...workbench,
      result: { text: "saved", details: { items: [complete] } },
    })?.items,
    [{ id: "0", ...complete }],
  );
});

test("rpiv uses the full result snapshot even for filtered list calls and hides tombstones", () => {
  assert.deepEqual(readTodoSnapshot(rpiv)?.items, [
    { id: "1", text: "Implement", status: "completed" },
    {
      id: "2",
      text: "Verify",
      status: "pending",
      description: "Run the targeted checks",
      activeForm: "Running checks",
      owner: "agent",
      blockedBy: ["1"],
    },
  ]);
});

test("rpiv replaces the retired Workbench panel while preserving branch-local history", () => {
  const updated = tool("workbench_todo", { arguments: { items: [complete] } });
  const history = branch(workbench, rpiv, updated);
  assert.deepEqual(latestTodoSnapshots(history), [readTodoSnapshot(rpiv)]);

  const cleared = tool("workbench_todo", { arguments: { items: [] } });
  assert.deepEqual(latestTodoSnapshots([...history, ...branch(cleared)]), [readTodoSnapshot(rpiv)]);
  const deleted = tool("todo", {
    result: { details: { tasks: [{ id: 1, subject: "Removed", status: "deleted" }], nextId: 2 } },
  });
  assert.deepEqual(latestTodoSnapshots(branch(rpiv, deleted)), []);
  assert.deepEqual(
    latestTodoSnapshots(
      branch(
        workbench,
        rpiv,
        tool("todo", {
          result: { details: { tasks: [], nextId: 1 } },
        }),
      ),
    ),
    [],
  );
  // Replaying an earlier branch or another session cannot inherit newer task state.
  assert.deepEqual(latestTodoSnapshots(branch(workbench)), [readTodoSnapshot(workbench)]);
  assert.deepEqual(latestTodoSnapshots([]), []);
});

test("partial, failed, unrelated, and malformed updates cannot wipe out a valid list", () => {
  const invalid: ToolCallBlock[] = [
    ...(["running", "requires-action", "incomplete", "error"] as const).map((status) => ({
      ...workbench,
      status,
      arguments: { items: [] },
    })),
    { ...workbench, result: { details: { items: [], error: "failed" } } },
    { ...workbench, arguments: { items: [{ text: "Partial" }] } },
    { ...workbench, arguments: { items: [pending, null] } },
    { ...workbench, result: { details: { items: "invalid" } } },
    tool("todo", { arguments: { action: "clear" }, result: "Error: failed" }),
    tool("todo", { result: { details: { tasks: [], error: "failed" } } }),
    tool("todo", { result: { details: { tasks: [{ id: 1, status: "pending" }] } } }),
    tool("todo", {
      result: {
        details: {
          tasks: [
            { id: 1, subject: "A", status: "pending" },
            { id: 1, subject: "B", status: "pending" },
          ],
        },
      },
    }),
    tool("todo", {
      result: {
        details: { tasks: [{ id: 1, subject: "A", status: "pending", blockedBy: ["invalid"] }] },
      },
    }),
    { ...workbench, toolName: "some_todo_tool" },
    { ...workbench, toolName: "constructor" },
  ];
  for (const block of invalid) {
    assert.equal(readTodoSnapshot(block), undefined);
    assert.deepEqual(latestTodoSnapshots(branch(workbench, block)), [readTodoSnapshot(workbench)]);
  }
  assert.equal(isTodoTool("todo"), true);
  assert.equal(isTodoTool("some_todo_tool"), false);
});
