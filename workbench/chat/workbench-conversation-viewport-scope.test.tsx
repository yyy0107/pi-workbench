import assert from "node:assert/strict";
import test from "node:test";

import {
  AssistantRuntimeProvider,
  useAui,
  useExternalStoreRuntime,
  useThreadViewportStore,
  type ThreadMessage,
} from "@assistant-ui/react";
import { act, createElement, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import {
  flushReactMicrotasks,
  installMinimalReactDomEnvironment,
} from "@/test-utils/react-dom-environment";

import { WorkbenchConversationViewportScope } from "./workbench-conversation-viewport-scope";

const EMPTY_MESSAGES: readonly ThreadMessage[] = [];

type ViewportStore = NonNullable<ReturnType<typeof useThreadViewportStore>>;

function ExternalRuntimeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const runtime = useExternalStoreRuntime({
    messages: EMPTY_MESSAGES,
    isRunning: false,
    onNew: async () => undefined,
  });

  return createElement(AssistantRuntimeProvider, { runtime }, children);
}

function NestedExternalRuntimeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const parentAui = useAui();
  const runtime = useExternalStoreRuntime({
    messages: EMPTY_MESSAGES,
    isRunning: false,
    onNew: async () => undefined,
  });

  return createElement(AssistantRuntimeProvider, { runtime, aui: parentAui }, children);
}

function ViewportStoreProbe({ observe }: Readonly<{ observe(store: ViewportStore): void }>) {
  observe(useThreadViewportStore());
  return null;
}

test("conversation viewport commands remain isolated across nested chat runtimes", async () => {
  const environment = installMinimalReactDomEnvironment();
  const root = createRoot(environment.container);
  let mounted = true;
  let mainStore: ViewportStore | undefined;
  let sideStore: ViewportStore | undefined;

  try {
    await act(async () => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(
            ExternalRuntimeProvider,
            null,
            createElement(
              WorkbenchConversationViewportScope,
              null,
              createElement(ViewportStoreProbe, {
                observe: (store) => {
                  mainStore = store;
                },
              }),
            ),
            createElement(
              NestedExternalRuntimeProvider,
              null,
              createElement(
                WorkbenchConversationViewportScope,
                null,
                createElement(ViewportStoreProbe, {
                  observe: (store) => {
                    sideStore = store;
                  },
                }),
              ),
            ),
          ),
        ),
      );
      await flushReactMicrotasks();
    });

    assert.ok(mainStore);
    assert.ok(sideStore);
    assert.notEqual(mainStore, sideStore);

    let mainCommands = 0;
    let sideCommands = 0;
    const stopMain = mainStore.getState().onScrollToBottom(() => {
      mainCommands += 1;
    });
    const stopSide = sideStore.getState().onScrollToBottom(() => {
      sideCommands += 1;
    });

    mainStore.getState().scrollToBottom({ behavior: "smooth" });
    assert.deepEqual({ mainCommands, sideCommands }, { mainCommands: 1, sideCommands: 0 });

    sideStore.getState().scrollToBottom({ behavior: "smooth" });
    assert.deepEqual({ mainCommands, sideCommands }, { mainCommands: 1, sideCommands: 1 });

    stopMain();
    stopSide();

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
