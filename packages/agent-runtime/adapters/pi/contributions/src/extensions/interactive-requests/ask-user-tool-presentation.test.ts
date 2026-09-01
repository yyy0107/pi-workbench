import assert from "node:assert/strict";
import test from "node:test";

import type { ToolCallMessagePart } from "@assistant-ui/react";

import { ExtensionManager } from "@workbench/extension-sdk/internal";

import { definePiMessage } from "../../i18n";

import { interactiveRequestsExtension } from "./extension";

test("registers the ask_user renderer and localized timeline presentation", () => {
  const manager = new ExtensionManager();
  const activation = manager.activate(interactiveRequestsExtension);
  const presentation = manager.renderers.toolPresentations.get("ask_user");
  const part = {
    type: "tool-call",
    toolCallId: "ask-user-call",
    toolName: "ask_user",
    args: {
      questions: [
        { id: "first", question: "First question?" },
        { id: "second", question: "Second question?" },
      ],
    },
    argsText: JSON.stringify({
      questions: [
        { id: "first", question: "First question?" },
        { id: "second", question: "Second question?" },
      ],
    }),
  } satisfies ToolCallMessagePart;
  const partialPart = {
    ...part,
    args: { questions: [{ id: "first" }] },
    argsText: '{"questions":[{"id":"first"',
  } satisfies ToolCallMessagePart;

  assert.equal(typeof manager.renderers.tools.get("ask_user"), "function");
  assert.deepEqual(
    presentation?.activeLabel,
    definePiMessage("extensions.interactiveRequests.askUserTool.activityRunning"),
  );
  assert.equal(typeof presentation?.getActiveLabel, "function");
  if (typeof presentation?.getActiveLabel !== "function") return;
  assert.deepEqual(
    presentation.getActiveLabel(part),
    definePiMessage("extensions.interactiveRequests.askUserTool.activityRunning"),
  );
  assert.deepEqual(
    presentation.getActiveLabel(partialPart),
    definePiMessage("extensions.interactiveRequests.askUserTool.activityGenerating"),
  );
  assert.deepEqual(
    presentation?.label,
    definePiMessage("extensions.interactiveRequests.askUserTool.activityComplete"),
  );
  assert.deepEqual(
    presentation?.summarize?.(part),
    definePiMessage("extensions.interactiveRequests.askUserTool.questionCount", { count: 2 }),
  );
  assert.equal(presentation?.summarize?.(partialPart), "…");

  activation.dispose();
  assert.equal(manager.renderers.tools.get("ask_user"), undefined);
  assert.equal(manager.renderers.toolPresentations.get("ask_user"), undefined);
});
