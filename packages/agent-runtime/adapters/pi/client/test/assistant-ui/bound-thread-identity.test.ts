import assert from "node:assert/strict";
import test from "node:test";
import {
  AssistantRuntimeProvider,
  useAuiState,
  useExternalStoreRuntime,
  type ThreadMessage,
} from "@assistant-ui/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { createBoundPiThreadListAdapter } from "../../src/assistant-ui/bound-thread-identity";

function BoundRuntimeIdentityProbe({
  localId,
  remoteId,
  observe,
}: Readonly<{
  localId: string;
  remoteId?: string;
  observe(value: { localId: string; remoteId?: string }): void;
}>) {
  const messages: readonly ThreadMessage[] = [];
  const runtime = useExternalStoreRuntime({
    messages,
    isRunning: false,
    onNew: async () => undefined,
    adapters: { threadList: createBoundPiThreadListAdapter(localId, remoteId) },
  });

  function Probe() {
    observe({
      localId: useAuiState((state) => state.threadListItem.id),
      remoteId: useAuiState((state) => state.threadListItem.remoteId),
    });
    return null;
  }

  return createElement(AssistantRuntimeProvider, { runtime }, createElement(Probe));
}

test("bound Pi runtimes expose the exact remote session identity to assistant-ui", () => {
  const first = createBoundPiThreadListAdapter("scratch-1", "scratch-1");
  const second = createBoundPiThreadListAdapter("scratch-2", "scratch-2");

  assert.deepEqual(first, {
    threadId: "scratch-1",
    threads: [{ id: "scratch-1", remoteId: "scratch-1", status: "regular" }],
    archivedThreads: [],
  });
  assert.deepEqual(second, {
    threadId: "scratch-2",
    threads: [{ id: "scratch-2", remoteId: "scratch-2", status: "regular" }],
    archivedThreads: [],
  });
});

test("bound Pi runtimes preserve draft identity until a remote session exists", () => {
  assert.deepEqual(createBoundPiThreadListAdapter("draft-1"), {
    threadId: "draft-1",
    threads: [{ id: "draft-1", status: "regular" }],
    archivedThreads: [],
  });
});

test("assistant-ui exposes each bound scratch identity through threadListItem state", () => {
  const observed: Array<{ localId: string; remoteId?: string }> = [];

  for (const scratchSessionId of ["scratch-1", "scratch-2"]) {
    renderToStaticMarkup(
      createElement(BoundRuntimeIdentityProbe, {
        localId: scratchSessionId,
        remoteId: scratchSessionId,
        observe: (value) => observed.push(value),
      }),
    );
  }

  assert.deepEqual(observed, [
    { localId: "scratch-1", remoteId: "scratch-1" },
    { localId: "scratch-2", remoteId: "scratch-2" },
  ]);
});
