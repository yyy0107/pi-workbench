import assert from "node:assert/strict";
import test from "node:test";
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import {
  RuntimeProvider,
  SessionProvider,
  useConversationNodes,
  useConversationSession,
} from "@workbench/agent-runtime-client";
import type {
  ConversationNode,
  ConversationSnapshot,
} from "@workbench/agent-runtime-contracts/conversation";
import { installMinimalReactDomEnvironment } from "./react-dom-environment";

function observable<T>(value: T) {
  const listeners = new Set<() => void>();
  return {
    listeners,
    getSnapshot: () => value,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next: T) {
      value = next;
      for (const listener of listeners) listener();
    },
  };
}

test("selected nodes isolate body updates and release subscriptions on range and session changes", async () => {
  const environment = installMinimalReactDomEnvironment();
  const root = createRoot(environment.container);
  const node = (key: string) => ({ key, kind: "user" as const, blocks: [] });
  function session(id: string) {
    const nodes = new Map(
      ["a", "b"].map((key) => [key, observable<ConversationNode | undefined>(node(key))]),
    );
    return {
      id,
      nodes,
      node: (key: string) => nodes.get(key)!,
      actions: {} as ReturnType<typeof useConversationSession>["actions"],
      snapshot: observable<ConversationSnapshot>({
        sessionId: id,
        nodeKeys: ["a", "b"],
        isLoading: false,
        isRunning: false,
        hasMore: false,
        composer: { text: "", attachments: [], mode: "send", phase: "idle" },
      }),
    };
  }
  const first = session("first");
  const second = session("second");
  const runtime = {
    current: observable({ sessionId: "first" }),
    session: (id: string) => (id === "first" ? first : second),
  } as unknown as ComponentProps<typeof RuntimeProvider>["runtime"];
  const select = (value: ConversationNode) => ({
    key: value.key,
    steering: value.presentation?.custom?.workbenchSteering === true,
  });
  const same = (a: ReturnType<typeof select>, b: ReturnType<typeof select>) =>
    a.key === b.key && a.steering === b.steering;
  let renders = 0;
  let selected: readonly ReturnType<typeof select>[] = [];
  let complete: readonly ConversationNode[] = [];
  function Structure({ keys }: { keys?: readonly string[] }) {
    selected = useConversationNodes({ nodeKeys: keys, select, isEqual: same });
    renders++;
    return null;
  }
  function Complete() {
    complete = useConversationNodes();
    return null;
  }
  const render = (id = "first", keys?: readonly string[]) =>
    act(async () =>
      root.render(
        <RuntimeProvider runtime={runtime}>
          <SessionProvider sessionId={id}>
            <Structure keys={keys} />
            <Complete />
          </SessionProvider>
        </RuntimeProvider>,
      ),
    );
  try {
    await render();
    const initialRenders = renders;
    const changed: ConversationNode = {
      ...node("b"),
      blocks: [{ key: "b:text", kind: "text", text: "delta" }],
    };
    await act(async () => first.nodes.get("b")!.set(changed));
    assert.equal(renders, initialRenders, "body changes do not render the structure consumer");
    assert.equal(complete[1], changed, "the no-argument API still receives full node changes");
    await act(async () =>
      first.nodes
        .get("b")!
        .set({ ...changed, presentation: { custom: { workbenchSteering: true } } }),
    );
    assert.equal(selected[1]?.steering, true);
    await act(async () =>
      first.snapshot.set({ ...first.snapshot.getSnapshot(), nodeKeys: ["b", "a"] }),
    );
    assert.deepEqual(
      selected.map((value) => value.key),
      ["b", "a"],
    );
    await render("first", ["a"]);
    const rangeRenders = renders;
    await act(async () => first.nodes.get("b")!.set(node("b")));
    assert.equal(renders, rangeRenders, "updates outside the selected range do not render it");
    await render("second");
    assert.equal(first.nodes.get("a")!.listeners.size + first.nodes.get("b")!.listeners.size, 0);
    assert.equal(first.snapshot.listeners.size, 0);
    assert.deepEqual(
      selected.map((value) => value.key),
      ["a", "b"],
    );
    await act(async () => second.nodes.get("a")!.set(undefined));
    assert.deepEqual(
      selected.map((value) => value.key),
      ["b"],
    );
  } finally {
    await act(async () => root.unmount());
    assert.equal(second.nodes.get("a")!.listeners.size + second.nodes.get("b")!.listeners.size, 0);
    assert.equal(second.snapshot.listeners.size, 0);
    environment.restore();
  }
});
