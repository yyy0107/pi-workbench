import assert from "node:assert/strict";
import test from "node:test";

import { AssistantRuntimeProvider, type AssistantRuntime } from "@assistant-ui/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "@/i18n/provider";
import { useWorkbenchRuntime } from "@/runtime/assistant-ui/use-workbench-runtime";

import { PiSessionManager } from "../runtime/manager";
import { createPiAgentRuntimeAdapter, PI_AGENT_RUNTIME_ADAPTER_ID } from "./adapter";

test("mounts Pi through the Workbench Agent Runtime adapter boundary", () => {
  const manager = new PiSessionManager();
  const adapter = createPiAgentRuntimeAdapter(manager);
  let capturedRuntime: AssistantRuntime | undefined;
  let capturedPiThreadRuntime: AssistantRuntime | undefined;

  function PiThreadRuntimeProbe() {
    capturedPiThreadRuntime = adapter.useThreadRuntime();
    return createElement("span", null, "mounted");
  }

  function Harness() {
    capturedRuntime = useWorkbenchRuntime(adapter);
    return createElement(
      AssistantRuntimeProvider,
      { runtime: capturedRuntime },
      createElement(PiThreadRuntimeProbe),
    );
  }

  try {
    const markup = renderToStaticMarkup(
      createElement(I18nProvider, { initialLocale: "en-US", children: createElement(Harness) }),
    );
    assert.equal(markup, "<span>mounted</span>");
    assert.equal(adapter.id, PI_AGENT_RUNTIME_ADAPTER_ID);
    assert.ok(capturedRuntime);

    const threadList = capturedRuntime.threads.getState();
    assert.equal(threadList.mainThreadId, threadList.newThreadId);
    assert.deepEqual(threadList.threadIds, []);
    assert.equal(threadList.threadItems[threadList.mainThreadId]?.status, "new");

    assert.ok(capturedPiThreadRuntime);
    const capabilities = capturedPiThreadRuntime.thread.getState().capabilities;
    assert.equal(capabilities.switchToBranch, true);
    assert.equal(capabilities.switchBranchDuringRun, false);
    assert.equal(capabilities.edit, false);
    // assistant-ui currently derives both branch switching and message deletion from
    // setMessages. Pi supplies it as a branch-switching bridge and owns the durable
    // mutation through unstable_onBranchChange.
    assert.equal(capabilities.delete, true);
    assert.equal(capabilities.reload, true);
    assert.equal(capabilities.refetchThread, true);
    assert.equal(capabilities.cancel, true);
    assert.equal(capabilities.attachments, true);
    assert.equal(capabilities.dictation, true);
    assert.equal(capabilities.feedback, true);
    assert.equal(capabilities.queue, false);
  } finally {
    manager.dispose();
  }
});
