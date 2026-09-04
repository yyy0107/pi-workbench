import assert from "node:assert/strict";
import test from "node:test";

import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import {
  RuntimeProvider,
  useConversationNodes,
  useConversationSession,
  useSessionState,
} from "@workbench/agent-runtime-client";
import { ExtensionProvider } from "@workbench/extension-host/installation";
import { defineExtension } from "@workbench/extension-sdk";
import { WorkbenchStatusbar } from "@workbench/shell/hosts/statusbar";
import { createPanelStore } from "@workbench/shell/panels";

import { installMinimalReactDomEnvironment } from "../react-dom-environment";

test("WorkbenchStatusbar composes the exact public statusbar slots", () => {
  const statusbar = WorkbenchStatusbar();
  const children = statusbar.props.children.props.children as readonly {
    props: { name?: string };
  }[];

  assert.equal(statusbar.type, "footer");
  assert.equal(statusbar.props["data-workbench-surface"], "statusbar");
  assert.deepEqual(
    children.map((child) => child.props.name),
    ["statusbar.left", "statusbar.right"],
  );
});

test("statusbar slots bind the current session outside the conversation subtree", async () => {
  const dom = installMinimalReactDomEnvironment();
  Object.assign(dom.container.ownerDocument, {
    createElement: (tag: string) => ({
      ...dom.container,
      nodeName: tag.toUpperCase(),
      tagName: tag.toUpperCase(),
      setAttribute: () => undefined,
    }),
  });
  const root = createRoot(dom.container);
  const observed: unknown[] = [];
  const errors: unknown[] = [];
  const listeners = new Set<() => void>();
  type Runtime = ComponentProps<typeof RuntimeProvider>["runtime"];
  let current: ReturnType<Runtime["current"]["getSnapshot"]> = {
    sessionId: undefined,
    isNewThread: true,
  };
  const sessions = new Map(
    ["first", "second"].map((id) => {
      const snapshot = {
        sessionId: id,
        isRunning: id === "first",
        isLoading: false,
        hasMore: false,
        nodeKeys: [],
        composer: { text: "", attachments: [], mode: "send" as const, phase: "idle" as const },
      };
      return [
        id,
        {
          id,
          snapshot: { getSnapshot: () => snapshot, subscribe: () => () => undefined },
          actions: {},
          node: () => ({ getSnapshot: () => undefined, subscribe: () => () => undefined }),
        },
      ];
    }),
  );
  const runtime: Pick<Runtime, "current" | "session"> = {
    current: {
      getSnapshot: () => current,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    session: (id: string) => sessions.get(id),
  };

  function SessionStatus() {
    const id = useConversationSession().id;
    const running = useSessionState((snapshot) => snapshot.isRunning);
    const nodes = useConversationNodes();
    observed.push({ id, running, nodes: nodes.length });
    return null;
  }

  const extension = defineExtension({
    id: "test.session-status",
    name: "Session status",
    version: "1.0.0",
    setup: ({ slots }) =>
      (["statusbar.left", "statusbar.right"] as const).map((slot) =>
        slots.register(slot, {
          id: slot,
          component: SessionStatus,
        }),
      ),
  });

  try {
    await act(async () => {
      root.render(
        <RuntimeProvider runtime={runtime as Runtime}>
          <ExtensionProvider
            extensions={[extension]}
            panelStore={createPanelStore()}
            onError={(error) => errors.push(error)}
          >
            <WorkbenchStatusbar />
          </ExtensionProvider>
        </RuntimeProvider>,
      );
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(observed, []);

    for (const id of ["first", "second", "missing"]) {
      observed.length = 0;
      await act(async () => {
        current = { sessionId: id, isNewThread: false };
        for (const listener of listeners) listener();
      });
      assert.deepEqual(errors, []);
      assert.deepEqual(
        observed,
        id === "missing" ? [] : Array(2).fill({ id, running: id === "first", nodes: 0 }),
      );
    }
  } finally {
    await act(async () => root.unmount());
    dom.restore();
  }
});
