import assert from "node:assert/strict";
import test from "node:test";

import { useAuiState } from "@assistant-ui/react";
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

import {
  flushReactMicrotasks,
  installMinimalReactDomEnvironment,
} from "@/test-utils/react-dom-environment";

import {
  useWorkbenchAgentCommands,
  useWorkbenchAgentRuntimeId,
  useWorkbenchAgentThreadActions,
  useWorkbenchAgentThreadSnapshot,
} from "./agent-runtime-context";
import { WorkbenchAgentRuntimeHost } from "./agent-runtime-host";
import { createFixtureAgentRuntime } from "./testing/fixture-agent-runtime";

test("mounts a non-Pi Agent Runtime through the generic host", () => {
  const fixture = createFixtureAgentRuntime();
  fixture.setCommands([
    {
      kind: "builtin",
      name: "fixture",
      invocationName: "fixture",
      effect: "agent-turn",
      exclusive: false,
      description: "Fixture command",
    },
  ]);
  fixture.setThreadSnapshot("probe-thread", {
    title: "Fixture conversation",
    isRunning: false,
    isWaitingForInput: false,
    hasUnreadCompletion: false,
    isPinned: false,
  });

  function Probe() {
    const mainThreadId = useAuiState((state) => state.threads.mainThreadId);
    const runtimeThreadId = useAuiState((state) => state.threadListItem.id);
    const runtimeId = useWorkbenchAgentRuntimeId();
    const commands = useWorkbenchAgentCommands();
    const thread = useWorkbenchAgentThreadSnapshot("probe-thread");
    const actions = useWorkbenchAgentThreadActions();
    const status = mainThreadId === runtimeThreadId ? "mounted" : "missing";
    return createElement(
      "span",
      null,
      `${status}:${runtimeId}:${commands[0]?.name}:${thread.title}:${actions.setPinned ? "pin" : "no-pin"}`,
    );
  }

  const markup = renderToStaticMarkup(
    createElement(WorkbenchAgentRuntimeHost, {
      adapter: fixture.adapter,
      children: createElement(Probe),
    }),
  );

  assert.equal(markup, "<span>mounted:fixture-agent:fixture:Fixture conversation:no-pin</span>");
});

test("keeps one thread presentation subscription and publishes projected updates", async () => {
  const environment = installMinimalReactDomEnvironment();
  const fixture = createFixtureAgentRuntime();
  const root = createRoot(environment.container);
  let observedTitle: string | undefined;
  let mounted = true;

  function Probe() {
    observedTitle = useWorkbenchAgentThreadSnapshot("tracked-thread").title;
    return null;
  }

  try {
    await act(async () => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(WorkbenchAgentRuntimeHost, {
            adapter: fixture.adapter,
            children: createElement(Probe),
          }),
        ),
      );
      await flushReactMicrotasks();
    });
    assert.equal(fixture.activeThreadSubscriptions, 1);
    assert.equal(observedTitle, undefined);

    await act(async () => {
      fixture.setThreadSnapshot("tracked-thread", {
        title: "Updated title",
        isRunning: true,
        isWaitingForInput: false,
        hasUnreadCompletion: false,
        isPinned: true,
      });
      await flushReactMicrotasks();
    });
    assert.equal(observedTitle, "Updated title");

    await act(async () => {
      root.unmount();
      await flushReactMicrotasks();
    });
    mounted = false;
    assert.equal(fixture.activeThreadSubscriptions, 0);
  } finally {
    if (mounted) {
      await act(async () => {
        root.unmount();
        await flushReactMicrotasks();
      });
    }
    environment.restore();
  }
});

test("keeps one revision subscription and treats an adapter replacement as a new baseline", async () => {
  const environment = installMinimalReactDomEnvironment();
  const fixture = createFixtureAgentRuntime();
  const root = createRoot(environment.container);
  let mounted = true;

  const renderHost = (adapter = fixture.adapter) =>
    createElement(
      StrictMode,
      null,
      createElement(WorkbenchAgentRuntimeHost, { adapter, children: null }),
    );

  try {
    await act(async () => {
      root.render(renderHost());
      await flushReactMicrotasks();
    });
    assert.equal(fixture.activeSubscriptions, 1);

    const initialListCalls = fixture.threadListAdapter.listCalls;
    await act(async () => {
      fixture.publishThreadListChange();
      await flushReactMicrotasks();
    });
    assert.equal(fixture.threadListAdapter.listCalls, initialListCalls + 1);

    const replacement: typeof fixture.adapter = {
      ...fixture.adapter,
      id: "fixture-agent-replacement",
      getThreadListRevision: () => fixture.revision + 100,
    };
    await act(async () => {
      root.render(renderHost(replacement));
      await flushReactMicrotasks();
    });
    assert.equal(fixture.activeSubscriptions, 1);
    assert.equal(fixture.threadListAdapter.listCalls, initialListCalls + 1);

    await act(async () => {
      root.unmount();
      await flushReactMicrotasks();
    });
    mounted = false;
    assert.equal(fixture.activeSubscriptions, 0);
  } finally {
    if (mounted) {
      await act(async () => {
        root.unmount();
        await flushReactMicrotasks();
      });
    }
    environment.restore();
  }
});
