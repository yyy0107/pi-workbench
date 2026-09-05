import assert from "node:assert/strict";
import test from "node:test";
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { RuntimeProvider } from "@workbench/agent-runtime-client";
import type { ConversationNode } from "@workbench/agent-runtime-contracts/conversation";
import { installMinimalReactDomEnvironment } from "../../../../test/react-dom-environment";
import { useTerminalToolCall } from "./use-terminal-tool-call";

test("retained tool terminals read only their target session, never current or same-id calls elsewhere", async () => {
  const dom = installMinimalReactDomEnvironment();
  const root = createRoot(dom.container);
  type Runtime = ComponentProps<typeof RuntimeProvider>["runtime"];
  const listeners = new Map<string, Set<() => void>>();
  const nodes = new Map<string, ConversationNode>();
  const sessions = new Map(
    ["a", "b"].map((id) => {
      const node: ConversationNode = {
        key: "assistant",
        kind: "assistant",
        createdAt: 0,
        status: "running",
        blocks: [
          {
            key: "tool",
            kind: "tool-call",
            callId: "same-id",
            toolName: "bash",
            argumentsText: "{}",
            status: "running",
            result: id,
          },
        ],
      };
      nodes.set(id, node);
      listeners.set(id, new Set());
      const snapshot = {
        sessionId: id,
        isRunning: false,
        isLoading: false,
        hasMore: false,
        nodeKeys: ["assistant"],
        composer: { text: "", attachments: [], mode: "send" as const, phase: "idle" as const },
      };
      return [
        id,
        {
          id,
          snapshot: { getSnapshot: () => snapshot, subscribe: () => () => {} },
          actions: {},
          node: () => ({
            getSnapshot: () => nodes.get(id),
            subscribe: (listener: () => void) => {
              listeners.get(id)!.add(listener);
              return () => {
                listeners.get(id)!.delete(listener);
              };
            },
          }),
        },
      ];
    }),
  );
  const catalog = { threads: [], isLoading: false };
  const runtime = {
    current: {
      getSnapshot: () => ({ sessionId: "b", threadId: "b", isNewThread: false }),
      subscribe: () => () => {},
    },
    threads: { getSnapshot: () => catalog, subscribe: () => () => {} },
    session: (id: string) => sessions.get(id),
  } as unknown as Runtime;
  const observed = new Map<string, unknown>();
  function Probe({
    id,
    piSessionId,
    threadId,
  }: {
    id: string;
    piSessionId?: string;
    threadId?: string;
  }) {
    const tool = useTerminalToolCall({
      mode: "transcript",
      command: "test",
      toolCallId: "same-id",
      piSessionId,
      threadId,
    });
    observed.set(id, tool?.result);
    return null;
  }
  try {
    await act(async () =>
      root.render(
        <RuntimeProvider runtime={runtime}>
          <Probe id="pinned" piSessionId="a" threadId="b" />
          <Probe id="thread" threadId="a" />
          <Probe id="missing" piSessionId="missing" threadId="b" />
          <Probe id="empty" />
        </RuntimeProvider>,
      ),
    );
    assert.deepEqual(Object.fromEntries(observed), {
      pinned: "a",
      thread: "a",
      missing: undefined,
      empty: undefined,
    });
    await act(async () => {
      const old = nodes.get("a")! as Extract<ConversationNode, { kind: "assistant" }>;
      nodes.set("a", {
        ...old,
        blocks: [{ ...old.blocks[0]!, result: "a updated" } as (typeof old.blocks)[0]],
      });
      listeners.get("a")!.forEach((listener) => listener());
    });
    assert.equal(observed.get("pinned"), "a updated");
    assert.equal(observed.get("thread"), "a updated");
    assert.equal(observed.get("missing"), undefined);
  } finally {
    await act(async () => root.unmount());
    assert.equal(listeners.get("a")!.size, 0);
    dom.restore();
  }
});
