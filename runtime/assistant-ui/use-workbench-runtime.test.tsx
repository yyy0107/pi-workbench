import assert from "node:assert/strict";
import test from "node:test";

import {
  AssistantRuntimeProvider,
  InMemoryThreadListAdapter,
  useExternalStoreRuntime,
  type AssistantRuntime,
  type ThreadMessage,
} from "@assistant-ui/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { WorkbenchAgentRuntimeAdapter } from "./agent-runtime-adapter";
import { useWorkbenchRuntime } from "./use-workbench-runtime";

test("mounts an agent adapter without depending on a concrete backend", () => {
  let capturedRuntime: AssistantRuntime | undefined;
  const adapter: WorkbenchAgentRuntimeAdapter = {
    id: "test-agent",
    threadListAdapter: new InMemoryThreadListAdapter(),
    getThreadListRevision: () => 0,
    subscribeThreadList: () => () => undefined,
    useCommandCatalog: () => [],
    useThreadRuntime() {
      const messages: readonly ThreadMessage[] = [];
      return useExternalStoreRuntime({
        messages,
        isRunning: false,
        onNew: async () => undefined,
      });
    },
  };

  function Harness() {
    capturedRuntime = useWorkbenchRuntime(adapter);
    return createElement(
      AssistantRuntimeProvider,
      { runtime: capturedRuntime },
      createElement("span", null, "mounted"),
    );
  }

  const markup = renderToStaticMarkup(createElement(Harness));
  assert.equal(markup, "<span>mounted</span>");
  assert.ok(capturedRuntime);

  const threadList = capturedRuntime.threads.getState();
  assert.equal(threadList.mainThreadId, threadList.newThreadId);
  assert.deepEqual(threadList.threadIds, []);
  assert.equal(threadList.threadItems[threadList.mainThreadId]?.status, "new");
});
