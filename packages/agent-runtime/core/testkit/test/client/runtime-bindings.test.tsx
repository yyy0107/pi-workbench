import assert from "node:assert/strict";
import test from "node:test";

import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";

import {
  RuntimeProvider,
  SessionProvider,
  useAgentRuntime,
  useConversationNode,
  useSessionState,
  useThreadList,
} from "@workbench/agent-runtime-client";
import {
  createFakeAgentRuntime,
  createFakeConversationSession,
} from "@workbench/agent-runtime-testkit/runtime";

import { flushReactMicrotasks, installMinimalReactDomEnvironment } from "./react-dom-environment";

test("isolates Runtime, thread, Session, and node selectors", async () => {
  const environment = installMinimalReactDomEnvironment();
  const session = createFakeConversationSession("session-1");
  const runtime = createFakeAgentRuntime([session]);
  runtime.switchToThread(session.id);
  const root = createRoot(environment.container);
  let mounted = true;
  const renders = { runtime: 0, threads: 0, session: 0, node: 0 };

  function RuntimeProbe() {
    assert.equal(useAgentRuntime(), runtime);
    renders.runtime += 1;
    return null;
  }

  function ThreadProbe() {
    useThreadList((snapshot) => snapshot.isLoading);
    renders.threads += 1;
    return null;
  }

  function SessionProbe() {
    useSessionState((snapshot) => snapshot.isRunning);
    renders.session += 1;
    return null;
  }

  function NodeProbe() {
    useConversationNode("assistant-1", (node) => node?.key);
    renders.node += 1;
    return null;
  }

  try {
    await act(async () => {
      root.render(
        createElement(RuntimeProvider, {
          runtime,
          children: [
            createElement(RuntimeProbe, { key: "runtime" }),
            createElement(ThreadProbe, { key: "threads" }),
            createElement(SessionProvider, {
              key: "session",
              children: [
                createElement(SessionProbe, { key: "session-state" }),
                createElement(NodeProbe, { key: "node" }),
              ],
            }),
          ],
        }),
      );
      await flushReactMicrotasks();
    });
    assert.deepEqual(renders, { runtime: 1, threads: 1, session: 1, node: 1 });

    await act(async () => {
      runtime.patchThreads({ error: { code: "changed", message: "Changed" } });
      session.setNode({
        key: "other-user",
        kind: "user",
        blocks: [{ key: "other-user:text", kind: "text", text: "hello" }],
      });
      await flushReactMicrotasks();
    });
    assert.deepEqual(renders, { runtime: 1, threads: 1, session: 1, node: 1 });

    await act(async () => {
      runtime.patchThreads({ isLoading: true });
      session.patchSnapshot({ isRunning: true });
      session.setNode({
        key: "assistant-1",
        kind: "assistant",
        status: "running",
        blocks: [{ key: "assistant-1:text", kind: "text", text: "token" }],
      });
      await flushReactMicrotasks();
    });
    assert.deepEqual(renders, { runtime: 1, threads: 2, session: 2, node: 2 });

    await act(async () => {
      root.unmount();
      await flushReactMicrotasks();
    });
    mounted = false;
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

test("remounts the SessionProvider subtree by stable Session id", async () => {
  const environment = installMinimalReactDomEnvironment();
  const first = createFakeConversationSession("session-1");
  const second = createFakeConversationSession("session-2");
  const runtime = createFakeAgentRuntime([first, second]);
  runtime.switchToThread(first.id);
  const root = createRoot(environment.container);
  let mounted = true;
  const lifecycle: string[] = [];

  function Probe() {
    const sessionId = useSessionState((snapshot) => snapshot.sessionId);
    useEffect(() => {
      lifecycle.push(`mount:${sessionId}`);
      return () => {
        lifecycle.push(`unmount:${sessionId}`);
      };
    }, [sessionId]);
    return null;
  }

  try {
    await act(async () => {
      root.render(
        createElement(RuntimeProvider, {
          runtime,
          children: createElement(SessionProvider, {
            fallback: null,
            children: createElement(Probe),
          }),
        }),
      );
      await flushReactMicrotasks();
    });
    assert.deepEqual(lifecycle, ["mount:session-1"]);

    await act(async () => {
      runtime.switchToThread(second.id);
      await flushReactMicrotasks();
    });
    assert.deepEqual(lifecycle, ["mount:session-1", "unmount:session-1", "mount:session-2"]);

    await act(async () => {
      runtime.switchToNewThread();
      await flushReactMicrotasks();
    });
    assert.deepEqual(lifecycle, [
      "mount:session-1",
      "unmount:session-1",
      "mount:session-2",
      "unmount:session-2",
    ]);

    await act(async () => {
      root.unmount();
      await flushReactMicrotasks();
    });
    mounted = false;
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
