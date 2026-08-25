import assert from "node:assert/strict";
import test from "node:test";

import { AssistantRuntimeProvider, type AssistantRuntime } from "@assistant-ui/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "../i18n/provider";
import { PiSessionManager } from "./pi/client/runtime/manager";
import { useWorkbenchRuntime } from "./use-workbench-runtime";

test("mounts the Workbench adapter through the public assistant-ui provider boundary", () => {
  const manager = new PiSessionManager();
  let capturedRuntime: AssistantRuntime | undefined;

  function Harness() {
    capturedRuntime = useWorkbenchRuntime(manager);
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
    assert.ok(capturedRuntime);

    const threadList = capturedRuntime.threads.getState();
    assert.equal(threadList.mainThreadId, threadList.newThreadId);
    assert.deepEqual(threadList.threadIds, []);
    assert.equal(threadList.threadItems[threadList.mainThreadId]?.status, "new");
  } finally {
    manager.dispose();
  }
});
