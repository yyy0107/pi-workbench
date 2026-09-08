import assert from "node:assert/strict";
import test from "node:test";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { BrowserCommand } from "@workbench/browser-contracts";
import { browserExtension } from "../../src/internal-extensions/browser";
import {
  bindPiAgentHostBindings,
  getPiAgentHostBindings,
} from "../../src/agent-runtime/pi-agent-host-bindings";

test("browser tool validates commands, shares the host browser, forwards cancellation, and emits native images", async () => {
  const previous = getPiAgentHostBindings();
  let tool: ToolDefinition | undefined;
  const calls: Array<{ command: BrowserCommand; signal?: AbortSignal }> = [];
  bindPiAgentHostBindings({
    browser: {
      async command(command, signal) {
        calls.push({ command, signal });
        if (command.type === "screenshot")
          return { name: "page.png", mimeType: "image/png", data: "cGljdHVyZQ==" };
        return { id: "workbench-conversation", url: "https://example.test/", title: "Example" };
      },
    },
  });
  try {
    await browserExtension({
      registerTool(definition: ToolDefinition) {
        tool = definition;
      },
    } as never);
    assert.ok(tool);
    const controller = new AbortController();
    const ctx = {
      cwd: "/workspace",
      sessionManager: { getSessionId: () => "conversation" },
    } as never;
    const attached = await tool.execute(
      "open",
      { action: "attach", url: "https://example.test/" },
      controller.signal,
      undefined,
      ctx,
    );
    assert.deepEqual(calls[0], {
      command: {
        type: "attach",
        sessionId: "workbench-conversation",
        projectId: "/workspace",
        url: "https://example.test/",
      },
      signal: controller.signal,
    });
    assert.deepEqual(attached.details, {
      browserSessionId: "workbench-conversation",
      url: "https://example.test/",
      projectId: "/workspace",
    });
    const screenshot = await tool.execute(
      "image",
      { action: "screenshot" },
      undefined,
      undefined,
      ctx,
    );
    assert.deepEqual(screenshot.content, [
      { type: "text", text: "{}" },
      { type: "image", mimeType: "image/png", data: "cGljdHVyZQ==" },
    ]);
    await assert.rejects(
      tool.execute(
        "invalid",
        { action: "input", params: { event: { kind: "mouse", x: -1 } } },
        undefined,
        undefined,
        ctx,
      ),
      /Invalid browser command/,
    );
    assert.equal(calls.length, 2);
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
    assert.equal(calls.length, 2);
  } finally {
    bindPiAgentHostBindings(previous);
  }
});
