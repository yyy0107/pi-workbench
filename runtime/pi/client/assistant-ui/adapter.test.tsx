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

  function Harness() {
    capturedRuntime = useWorkbenchRuntime(adapter);
    return createElement(
      AssistantRuntimeProvider,
      { runtime: capturedRuntime },
      createElement("span", null, "mounted"),
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
  } finally {
    manager.dispose();
  }
});
