import assert from "node:assert/strict";
import test from "node:test";

import type { ToolCallBlock } from "@workbench/agent-runtime-contracts/conversation";

import { ExtensionManager } from "@workbench/extension-sdk/internal";

import { defineMessage } from "@workbench/shell/i18n";

import { interactiveRequestsExtension } from "./extension";

test("registers the ask_user renderer and localized timeline presentation", () => {
  const manager = new ExtensionManager();
  const activation = manager.activate(interactiveRequestsExtension);
  const presentation = manager.renderers.toolPresentations.get("ask_user");
  const block = {
    key: "tool:ask-user-call",
    kind: "tool-call",
    callId: "ask-user-call",
    toolName: "ask_user",
    arguments: {
      questions: [
        { id: "first", question: "First question?" },
        { id: "second", question: "Second question?" },
      ],
    },
    argumentsText: JSON.stringify({
      questions: [
        { id: "first", question: "First question?" },
        { id: "second", question: "Second question?" },
      ],
    }),
    status: "running",
  } satisfies ToolCallBlock;
  const partialBlock = {
    ...block,
    arguments: { questions: [{ id: "first" }] },
    argumentsText: '{"questions":[{"id":"first"',
  } satisfies ToolCallBlock;

  assert.equal(typeof manager.renderers.tools.get("ask_user"), "function");
  assert.deepEqual(
    presentation?.activeLabel,
    defineMessage("extensions.interactiveRequests.askUserTool.activityRunning"),
  );
  assert.equal(typeof presentation?.getActiveLabel, "function");
  if (typeof presentation?.getActiveLabel !== "function") return;
  assert.deepEqual(
    presentation.getActiveLabel(block),
    defineMessage("extensions.interactiveRequests.askUserTool.activityRunning"),
  );
  assert.deepEqual(
    presentation.getActiveLabel(partialBlock),
    defineMessage("extensions.interactiveRequests.askUserTool.activityGenerating"),
  );
  assert.deepEqual(
    presentation?.label,
    defineMessage("extensions.interactiveRequests.askUserTool.activityComplete"),
  );
  assert.deepEqual(
    presentation?.summarize?.(block),
    defineMessage("extensions.interactiveRequests.askUserTool.questionCount", { count: 2 }),
  );
  assert.equal(presentation?.summarize?.(partialBlock), "…");

  activation.dispose();
  assert.equal(manager.renderers.tools.get("ask_user"), undefined);
  assert.equal(manager.renderers.toolPresentations.get("ask_user"), undefined);
});
