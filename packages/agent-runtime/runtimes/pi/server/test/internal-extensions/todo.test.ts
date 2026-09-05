import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type ExtensionContext,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { ToolCapabilitySettings } from "../../src/internal-extensions/tool-availability";
import { prepareWorkbenchPiExtensions } from "../../src/internal-extensions/index";
import {
  TODO_EXTENSION_NAME,
  todoExtension,
  createTodoExtension,
} from "../../src/internal-extensions/todo";
import {
  TodoParamsSchema,
  type TaskDetails,
  type TodoParams,
} from "../../src/internal-extensions/rpiv-todo/tool/types";

async function harness(settings?: ToolCapabilitySettings) {
  let activeTools = ["read", "todo"];
  let tool: ToolDefinition<typeof TodoParamsSchema, TaskDetails> | undefined;
  const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => unknown>>();
  await createTodoExtension(settings)({
    registerTool: (definition: typeof tool) => {
      tool = definition;
    },
    on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    getActiveTools: () => activeTools,
    setActiveTools: (names: string[]) => {
      activeTools = names;
    },
  } as never);
  assert.equal(tool?.name, "todo");
  const context = (manager: SessionManager) =>
    ({ sessionManager: manager }) as unknown as ExtensionContext;
  return {
    get activeTools() {
      return activeTools;
    },
    execute: (manager: SessionManager, params: TodoParams) =>
      tool!.execute("todo-call", params, undefined, undefined, context(manager)),
    fire: async (event: string, manager: SessionManager) => {
      for (const handler of handlers.get(event) ?? [])
        await handler({ type: event }, context(manager));
    },
  };
}

function persist(manager: SessionManager, details: unknown) {
  return manager.appendMessage({
    role: "toolResult",
    toolName: "todo",
    toolCallId: "todo-call",
    content: [{ type: "text", text: "snapshot" }],
    details,
    isError: false,
    timestamp: Date.now(),
  });
}

test("built-in rpiv todo supports all six actions and returns full durable snapshots", async () => {
  const { execute } = await harness();
  const manager = SessionManager.inMemory();
  const create = await execute(manager, {
    action: "create",
    subject: "Implement",
    metadata: { priority: 1 },
  });
  assert.deepEqual(create.details.tasks, [
    { id: 1, subject: "Implement", status: "pending", metadata: { priority: 1 } },
  ]);
  const createSecond = await execute(manager, {
    action: "create",
    subject: "Verify",
    blockedBy: [1],
    owner: "agent",
  });
  assert.equal(createSecond.details.nextId, 3);
  // Consecutive calls share state even before their tool results have been appended to the branch.
  assert.equal(createSecond.details.tasks.length, 2);
  const update = await execute(manager, {
    action: "update",
    id: 1,
    status: "in_progress",
    activeForm: "Implementing",
    metadata: { priority: null, checked: true },
  });
  assert.deepEqual(update.details.tasks[0].metadata, { checked: true });
  assert.equal(create.details.tasks[0].status, "pending");
  const list = await execute(manager, { action: "list", status: "pending" });
  assert.match(list.content[0].type === "text" ? list.content[0].text : "", /#2 Verify/);
  assert.equal(list.details.tasks.length, 2);
  const get = await execute(manager, { action: "get", id: 1 });
  assert.match(get.content[0].type === "text" ? get.content[0].text : "", /blocks: #2/);
  await execute(manager, { action: "update", id: 1, status: "completed" });
  await execute(manager, {
    action: "update",
    id: 2,
    removeBlockedBy: [1],
    description: "Tests passed",
  });
  const deleted = await execute(manager, { action: "delete", id: 2 });
  assert.equal(deleted.details.tasks[1].status, "deleted");
  assert.equal(deleted.details.tasks[1].blockedBy, undefined);
  const hidden = await execute(manager, { action: "list" });
  assert.doesNotMatch(hidden.content[0].type === "text" ? hidden.content[0].text : "", /#2/);
  const shown = await execute(manager, { action: "list", includeDeleted: true });
  assert.match(shown.content[0].type === "text" ? shown.content[0].text : "", /\[deleted\] #2/);
  const clear = await execute(manager, { action: "clear" });
  assert.deepEqual(clear.details, {
    action: "clear",
    params: { action: "clear" },
    tasks: [],
    nextId: 1,
  });
});

test("invalid updates, dependencies and status transitions preserve the prior snapshot", async () => {
  const { execute } = await harness();
  const manager = SessionManager.inMemory();
  assert.match(
    (await execute(manager, { action: "create", subject: " " })).details.error!,
    /subject required/,
  );
  await execute(manager, { action: "create", subject: "A" });
  const before = await execute(manager, { action: "create", subject: "B", blockedBy: [1] });
  for (const params of [
    { action: "update", id: 1 },
    { action: "update", id: 1, addBlockedBy: [1] },
    { action: "update", id: 1, addBlockedBy: [2] },
    { action: "create", subject: "C", blockedBy: [99] },
    { action: "get", id: 99 },
  ] satisfies TodoParams[]) {
    const result = await execute(manager, params);
    assert.ok(result.details.error);
    assert.deepEqual(result.details.tasks, before.details.tasks);
    assert.equal(result.details.nextId, before.details.nextId);
  }
  await execute(manager, { action: "update", id: 1, status: "completed" });
  assert.match(
    (await execute(manager, { action: "update", id: 1, status: "in_progress" })).details.error!,
    /illegal transition/,
  );
});

test("replays rpiv history across reload, compaction, branch changes and isolated sessions", async () => {
  const first = await harness();
  const manager = SessionManager.inMemory();
  const original = (await first.execute(manager, { action: "create", subject: "Branch A" }))
    .details;
  const root = persist(manager, original);
  persist(manager, {
    ...original,
    tasks: [{ id: 2, subject: "Branch B", status: "in_progress" }],
    nextId: 3,
  });
  const restored = await harness();
  await restored.fire("session_start", manager);
  assert.equal(
    (await restored.execute(manager, { action: "get", id: 2 })).details.tasks[0].subject,
    "Branch B",
  );
  manager.branch(root);
  await restored.fire("agent_start", manager);
  assert.deepEqual(
    (await restored.execute(manager, { action: "list" })).details.tasks,
    original.tasks,
  );

  const second = SessionManager.inMemory();
  await restored.fire("session_start", second);
  assert.deepEqual((await restored.execute(second, { action: "list" })).details.tasks, []);
  const created = await restored.execute(second, { action: "create", subject: "Other session" });
  assert.equal(created.details.tasks[0].id, 1);

  // Corrupt / unrelated details must not erase the latest compatible rpiv snapshot.
  for (const bad of [
    { tasks: [null], nextId: 2 },
    { ...original, nextId: 1 },
    { tasks: [original.tasks[0], original.tasks[0]], nextId: 2 },
    { tasks: [{ ...original.tasks[0], blockedBy: ["invalid"] }], nextId: 2 },
    { items: [] },
  ])
    persist(manager, bad);
  manager.appendCompaction("summary", root, 100);
  await restored.fire("session_compact", manager);
  assert.deepEqual(
    (await restored.execute(manager, { action: "list" })).details.tasks,
    original.tasks,
  );
  persist(manager, { tasks: [], nextId: 1 });
  await restored.fire("session_tree", manager);
  assert.deepEqual((await restored.execute(manager, { action: "list" })).details.tasks, []);
  await restored.fire("session_shutdown", second);
  // Its unpersisted in-memory state was released, without clearing the other session's slot.
  assert.deepEqual((await restored.execute(second, { action: "list" })).details.tasks, []);
});

test("Pi loader exposes only the built-in todo while preserving unrelated extension capabilities", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "workbench-todo-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const loader = new DefaultResourceLoader({
    cwd: directory,
    agentDir: directory,
    settingsManager: SettingsManager.inMemory({}, { projectTrusted: false }),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [
      {
        name: "user.todo",
        factory: (pi) => {
          for (const name of ["todo", "unrelated"])
            pi.registerTool({
              name,
              label: name,
              description: name,
              parameters: TodoParamsSchema,
              async execute() {
                return { content: [], details: {} };
              },
            });
          pi.on("agent_start", async () => {});
        },
      },
      { name: TODO_EXTENSION_NAME, factory: todoExtension, hidden: true },
    ],
    extensionsOverride: (result) => {
      const runtime = result.runtime;
      const originalTools = result.extensions[0].tools;
      result.errors.push({ path: "unrelated", error: "keep this error" });
      const prepared = prepareWorkbenchPiExtensions(result);
      assert.equal(prepared.runtime, runtime);
      assert.ok(originalTools.has("todo"));
      return prepared;
    },
  });
  await loader.reload();
  const result = loader.getExtensions();
  assert.deepEqual(result.errors, [{ path: "unrelated", error: "keep this error" }]);
  const [external, builtin] = result.extensions;
  assert.deepEqual([...external.tools.keys()], ["unrelated"]);
  assert.ok(external.handlers.has("agent_start"));
  assert.deepEqual([...builtin.tools.keys()], ["todo"]);
  assert.ok(builtin.tools.get("todo")?.definition.promptGuidelines?.length);
  assert.ok(!result.extensions.some((extension) => extension.tools.has("workbench_todo")));
});

test("Todo toggles preserve tasks, reject stale calls and release preference listeners", async () => {
  let enabled = false;
  const listeners = new Set<(value: boolean) => void>();
  const api = await harness({
    readEnabled: async () => enabled,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
  const manager = SessionManager.inMemory();
  const setEnabled = (value: boolean) => {
    enabled = value;
    for (const listener of listeners) listener(value);
  };
  await api.fire("session_start", manager);
  assert.deepEqual(api.activeTools, ["read"]);
  const disabled = await api.execute(manager, { action: "create", subject: "Must not exist" });
  assert.match(disabled.details.error!, /disabled/);
  assert.deepEqual(disabled.details.tasks, []);
  setEnabled(true);
  assert.deepEqual(api.activeTools, ["read", "todo"]);
  const created = await api.execute(manager, { action: "create", subject: "Keep me" });
  setEnabled(false);
  assert.deepEqual(api.activeTools, ["read"]);
  const blocked = await api.execute(manager, { action: "clear" });
  assert.deepEqual(blocked.details.tasks, created.details.tasks);
  assert.match(blocked.details.error!, /disabled/);
  setEnabled(true);
  assert.deepEqual(
    (await api.execute(manager, { action: "list" })).details.tasks,
    created.details.tasks,
  );
  await api.fire("session_shutdown", manager);
  assert.equal(listeners.size, 0);
});
