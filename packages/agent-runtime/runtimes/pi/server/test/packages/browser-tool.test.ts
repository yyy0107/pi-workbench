import assert from "node:assert/strict";
import test from "node:test";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { validateToolArguments } from "@earendil-works/pi-ai";
import type { BrowserCommand } from "@workbench/browser-contracts";
import browserExtension, { createBrowserExtension } from "@workbench/pi-browser";
import {
  bindPiAgentHostBindings,
  getPiAgentHostBindings,
} from "../../src/agent-runtime/pi-agent-host-bindings";

test("browser tool scopes tabs, projects snapshots, validates actions, and forwards cancellation and native images", async () => {
  const previous = getPiAgentHostBindings();
  let tool: ToolDefinition | undefined;
  const calls: Array<{ command: BrowserCommand; signal?: AbortSignal }> = [];
  const projectId = "workspace-1";
  const session = {
    id: "workbench-conversation",
    projectId,
    url: "https://example.test/",
    title: "Example",
  };
  const snapshot = {
    session,
    snapshotId: "snapshot-1",
    nodes: [{ ref: "snapshot-1:0", role: "textbox", name: "Search" }],
    truncated: false,
  };
  bindPiAgentHostBindings({
    browser: {
      async resolveProjectId(cwd) {
        assert.equal(cwd, "/workspace");
        return projectId;
      },
      async command(command, signal) {
        calls.push({ command, signal });
        if (command.type === "screenshot")
          return {
            name: "page.png",
            mimeType: "image/png",
            data: "cGljdHVyZQ==",
            viewport: { width: 640, height: 480 },
            capture: { width: 640, height: 480 },
          };
        if (command.type === "snapshot") return snapshot;
        if (command.type === "tabs.list") return [session];
        return session;
      },
    },
  });
  try {
    await browserExtension({
      on() {},
      registerTool(definition: ToolDefinition) {
        tool = definition;
      },
    } as never);
    assert.ok(tool);
    const registeredTool = tool;
    assert.equal(tool.name, "workbench_browser");
    assert.equal(tool.executionMode, "sequential");
    for (const action of ["tabs.list", "snapshot", "click", "fill", "dialog.respond"])
      assert.deepEqual(
        validateToolArguments(registeredTool, {
          type: "toolCall",
          id: "schema",
          name: registeredTool.name,
          arguments: { action },
        }),
        { action },
      );
    for (const action of ["permission.respond", "settings.update", "cookies.import"])
      assert.throws(() =>
        validateToolArguments(registeredTool, {
          type: "toolCall",
          id: "schema",
          name: registeredTool.name,
          arguments: { action },
        }),
      );
    const controller = new AbortController();
    const ctx = {
      cwd: "/workspace",
      sessionManager: { getSessionId: () => "conversation" },
    } as never;
    const attached = await tool.execute(
      "open",
      {
        action: "attach",
        url: "https://example.test/",
        params: { type: "permission.respond", sessionId: "other-tab", projectId: "/other" },
      },
      controller.signal,
      undefined,
      ctx,
    );
    assert.deepEqual(calls[0], {
      command: {
        type: "attach",
        sessionId: "workbench-conversation",
        projectId,
        url: "https://example.test/",
      },
      signal: controller.signal,
    });
    assert.deepEqual(attached.details, {
      browserSessionId: "workbench-conversation",
      url: "https://example.test/",
      projectId,
    });
    const screenshot = await tool.execute(
      "image",
      { action: "screenshot" },
      undefined,
      undefined,
      ctx,
    );
    assert.deepEqual(screenshot.content, [
      {
        type: "text",
        text: JSON.stringify({
          viewport: { width: 640, height: 480 },
          capture: { width: 640, height: 480 },
        }),
      },
      { type: "image", mimeType: "image/png", data: "cGljdHVyZQ==" },
    ]);
    const tabs = await tool.execute(
      "tabs",
      { action: "tabs.list", params: { projectId: "/other" } },
      controller.signal,
      undefined,
      ctx,
    );
    assert.deepEqual(calls.at(-1), {
      command: { type: "tabs.list", projectId },
      signal: controller.signal,
    });
    assert.deepEqual(tabs.details, {}, "listing tabs must not invent a default tab to reveal");
    assert.deepEqual(tabs.content, [{ type: "text", text: JSON.stringify([session]) }]);
    const observed = await tool.execute(
      "observe",
      { action: "snapshot" },
      controller.signal,
      undefined,
      ctx,
    );
    assert.deepEqual(observed.details, attached.details);
    assert.deepEqual(observed.content, [{ type: "text", text: JSON.stringify(snapshot) }]);
    for (const [action, params] of [
      ["click", { ref: "snapshot-1:0" }],
      ["fill", { ref: "snapshot-1:0", text: "Workbench" }],
      ["dialog.respond", { accept: false }],
    ] as const) {
      const operated = await tool.execute(
        action,
        { action, sessionId: "selected-tab", params },
        controller.signal,
        undefined,
        ctx,
      );
      assert.deepEqual(calls.at(-1), {
        command: { type: action, sessionId: "selected-tab", ...params },
        signal: controller.signal,
      });
      assert.deepEqual(operated.details, {
        browserSessionId: "selected-tab",
        url: session.url,
        projectId,
      });
    }
    const callCount = calls.length;
    for (const params of [
      { action: "input", params: { event: { kind: "mouse", x: -1 } } },
      { action: "click", params: { ref: "" } },
      { action: "fill", params: { ref: "snapshot-1:0", text: 1 } },
      { action: "dialog.respond", params: { accept: "yes" } },
    ]) {
      await assert.rejects(
        tool.execute("invalid", params, undefined, undefined, ctx),
        /Invalid browser command/,
      );
    }
    assert.equal(calls.length, callCount);
    controller.abort();
    await assert.rejects(
      tool.execute(
        "aborted",
        { action: "navigate", url: "https://example.test/" },
        controller.signal,
        undefined,
        ctx,
      ),
    );
    assert.equal(calls.length, callCount);
  } finally {
    bindPiAgentHostBindings(previous);
  }
});

test("browser control spans tool calls and continuations, then ends at cancellation, settlement, or reload", async () => {
  let tool!: ToolDefinition;
  const handlers = new Map<string, () => void>();
  const calls: Array<{ signal?: AbortSignal; controlSignal?: AbortSignal }> = [];
  const extension = createBrowserExtension(() => ({
    async command(_command, signal, controlSignal) {
      calls.push({ signal, controlSignal });
    },
  }));
  const api = {
    on(event: string, handler: () => void) {
      handlers.set(event, handler);
    },
    registerTool(definition: ToolDefinition) {
      tool = definition;
    },
  } as never;
  await extension(api);
  const command = new AbortController();
  const context = {
    cwd: "/workspace",
    sessionManager: { getSessionId: () => "conversation" },
  };
  const execute = (ctx: typeof context & { signal?: AbortSignal } = context) =>
    tool.execute("snapshot", { action: "snapshot" }, command.signal, undefined, ctx as never);
  handlers.get("agent_settled")!();
  await execute();
  await execute();
  const first = calls[0]!.controlSignal!;
  assert.ok(first instanceof AbortSignal);
  assert.equal(calls[1]?.controlSignal, first, "consecutive tools keep the same control lifetime");
  assert.equal(calls[0]?.signal, command.signal);
  assert.notEqual(first, command.signal);
  assert.equal(handlers.has("agent_end"), false, "automatic continuations retain control");
  assert.equal(first.aborted, false);
  handlers.get("agent_settled")!();
  assert.equal(first.aborted, true);
  assert.equal(command.signal.aborted, false, "settlement does not cancel page commands");

  const run = new AbortController();
  await execute({ ...context, signal: run.signal });
  const nextRun = calls.at(-1)!.controlSignal!;
  assert.notEqual(nextRun, first);
  assert.equal(nextRun.aborted, false);
  run.abort();
  assert.equal(nextRun.aborted, true, "canceling between tools ends presence immediately");
  assert.equal(command.signal.aborted, false);
  handlers.get("agent_settled")!();

  await execute();
  const beforeReload = calls.at(-1)!.controlSignal!;
  handlers.get("session_shutdown")!();
  handlers.get("session_shutdown")!();
  assert.equal(beforeReload.aborted, true);
  assert.equal(command.signal.aborted, false);
  await extension(api);
  await execute();
  const afterReload = calls.at(-1)!.controlSignal!;
  assert.notEqual(afterReload, beforeReload);
  assert.equal(afterReload.aborted, false);
  command.abort();
  assert.equal(afterReload.aborted, false, "a per-tool abort does not own run presence");
  handlers.get("session_shutdown")!();
  assert.equal(afterReload.aborted, true);
});
