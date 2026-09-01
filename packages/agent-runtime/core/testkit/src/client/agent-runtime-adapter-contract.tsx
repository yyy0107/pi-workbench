import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { useAuiState, type AssistantRuntime } from "@assistant-ui/react";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { WorkbenchAgentCommand } from "@workbench/agent-runtime-contracts/commands";
import type {
  WorkbenchAgentRuntimeAdapter,
  WorkbenchAgentThreadSnapshot,
} from "@workbench/agent-runtime-client/adapter";
import {
  useWorkbenchAgentCommands,
  useWorkbenchAgentRuntimeId,
  useWorkbenchAgentThreadActions,
  useWorkbenchAgentThreadSnapshot,
} from "@workbench/agent-runtime-client/context";
import { WorkbenchAgentRuntimeHost } from "@workbench/agent-runtime-client";

const THREAD_LIST_ADAPTER_METHODS = [
  "list",
  "rename",
  "archive",
  "unarchive",
  "delete",
  "initialize",
  "generateTitle",
  "fetch",
] as const;

type RuntimeCapabilities = ReturnType<AssistantRuntime["thread"]["getState"]>["capabilities"];

export interface WorkbenchAgentRuntimeContractHarness {
  readonly adapter: WorkbenchAgentRuntimeAdapter;
  wrap?(element: ReactElement): ReactElement;
  dispose?(): void | Promise<void>;
}

export interface WorkbenchAgentRuntimeContractExpectations {
  readonly id: string;
  readonly commandNames?: readonly string[];
  readonly threadSnapshot?: Partial<WorkbenchAgentThreadSnapshot>;
  readonly threadCapabilities?: Partial<RuntimeCapabilities>;
  readonly hasThreadStore?: boolean;
}

export interface WorkbenchAgentRuntimeContractOptions<
  Harness extends WorkbenchAgentRuntimeContractHarness,
> {
  readonly name: string;
  readonly createHarness: () => Harness;
  readonly expected: WorkbenchAgentRuntimeContractExpectations;
  readonly mutateThreadList?: (harness: Harness) => void | Promise<void>;
  readonly mutateThread?: (harness: Harness, threadId: string) => void | Promise<void>;
}

function assertRevision(value: number, label: string): void {
  assert.ok(Number.isSafeInteger(value), `${label} must be a safe integer`);
  assert.ok(value >= 0, `${label} must be non-negative`);
}

function assertThreadSnapshot(snapshot: WorkbenchAgentThreadSnapshot): void {
  assert.equal(typeof snapshot.isRunning, "boolean");
  assert.equal(typeof snapshot.isWaitingForInput, "boolean");
  assert.equal(typeof snapshot.hasUnreadCompletion, "boolean");
  assert.equal(typeof snapshot.isPinned, "boolean");
  if (snapshot.lastMessageAt !== undefined) {
    assert.ok(snapshot.lastMessageAt instanceof Date);
    assert.ok(Number.isFinite(snapshot.lastMessageAt.valueOf()));
  }
  if (snapshot.workspace !== undefined) {
    assert.ok(snapshot.workspace.id.length > 0);
  }
}

function assertCommand(command: WorkbenchAgentCommand): void {
  assert.ok(["builtin", "extension", "prompt", "skill"].includes(command.kind));
  assert.ok(command.name.length > 0);
  assert.ok(command.invocationName.length > 0);
  assert.equal(typeof command.exclusive, "boolean");
}

async function disposeHarness(harness: WorkbenchAgentRuntimeContractHarness): Promise<void> {
  await harness.dispose?.();
}

/**
 * Registers the backend-neutral laws every browser Agent Runtime adapter must satisfy.
 *
 * Implementation-specific SDK, transport, and message projection assertions stay in the owning
 * runtime. This suite exercises only the Workbench and assistant-ui boundary visible to consumers.
 */
export function defineWorkbenchAgentRuntimeAdapterContract<
  Harness extends WorkbenchAgentRuntimeContractHarness,
>({
  name,
  createHarness,
  expected,
  mutateThreadList,
  mutateThread,
}: WorkbenchAgentRuntimeContractOptions<Harness>): void {
  describe(`${name} WorkbenchAgentRuntimeAdapter contract`, () => {
    test("exposes a stable implementation identity and complete assistant-ui adapter surface", async () => {
      const harness = createHarness();
      try {
        const { adapter } = harness;
        assert.equal(adapter.id, expected.id);
        assert.ok(adapter.id.trim().length > 0);
        assert.equal(adapter.id, adapter.id);
        assert.equal(typeof adapter.useThreadRuntime, "function");
        assert.equal(typeof adapter.useCommandCatalog, "function");
        assert.equal(typeof adapter.getThreadListRevision, "function");
        assert.equal(typeof adapter.subscribeThreadList, "function");
        for (const method of THREAD_LIST_ADAPTER_METHODS) {
          assert.equal(
            typeof adapter.threadListAdapter[method],
            "function",
            `threadListAdapter.${method} is required`,
          );
        }

        assertRevision(adapter.getThreadListRevision(), "thread-list revision");
        const unsubscribe = adapter.subscribeThreadList(() => undefined);
        assert.equal(typeof unsubscribe, "function");
        unsubscribe();
        unsubscribe();

        assert.equal(Boolean(adapter.threadStore), expected.hasThreadStore ?? false);
        if (adapter.threadStore) {
          assertRevision(adapter.threadStore.getRevision(undefined), "empty thread revision");
          assertThreadSnapshot(adapter.threadStore.getSnapshot(undefined));
          const unsubscribeThread = adapter.threadStore.subscribe(undefined, () => undefined);
          assert.equal(typeof unsubscribeThread, "function");
          unsubscribeThread();
          unsubscribeThread();
        }
      } finally {
        await disposeHarness(harness);
      }
    });

    test("mounts through the generic Workbench host and publishes neutral Runtime state", async () => {
      const harness = createHarness();
      let captured:
        | {
            readonly runtimeId: string;
            readonly commands: readonly WorkbenchAgentCommand[];
            readonly threadSnapshot: WorkbenchAgentThreadSnapshot;
            readonly actions: ReturnType<typeof useWorkbenchAgentThreadActions>;
            readonly mainThreadId: string;
            readonly runtimeThreadId: string;
            readonly messagesCount: number;
            readonly isRunning: boolean;
            readonly capabilities: RuntimeCapabilities;
            readonly implementationCapabilities: RuntimeCapabilities;
          }
        | undefined;

      function Probe() {
        const implementationRuntime = harness.adapter.useThreadRuntime();
        captured = {
          runtimeId: useWorkbenchAgentRuntimeId(),
          commands: useWorkbenchAgentCommands(),
          threadSnapshot: useWorkbenchAgentThreadSnapshot("contract-thread"),
          actions: useWorkbenchAgentThreadActions(),
          mainThreadId: useAuiState((state) => state.threads.mainThreadId),
          runtimeThreadId: useAuiState((state) => state.threadListItem.id),
          messagesCount: useAuiState((state) => state.thread.messages.length),
          isRunning: useAuiState((state) => state.thread.isRunning),
          capabilities: useAuiState((state) => state.thread.capabilities),
          implementationCapabilities: implementationRuntime.thread.getState().capabilities,
        };
        return createElement("span", null, useWorkbenchAgentRuntimeId());
      }

      try {
        const host = createElement(WorkbenchAgentRuntimeHost, {
          adapter: harness.adapter,
          children: createElement(Probe),
        });
        const markup = renderToStaticMarkup(harness.wrap ? harness.wrap(host) : host);
        assert.equal(markup, `<span>${expected.id}</span>`);
        assert.ok(captured);
        assert.equal(captured.runtimeId, expected.id);
        assert.equal(captured.mainThreadId, captured.runtimeThreadId);
        assert.equal(captured.messagesCount, 0);
        assert.equal(typeof captured.isRunning, "boolean");
        for (const command of captured.commands) assertCommand(command);
        if (expected.commandNames) {
          assert.deepEqual(
            captured.commands.map((command) => command.name),
            expected.commandNames,
          );
        }
        assertThreadSnapshot(captured.threadSnapshot);
        if (expected.threadSnapshot) {
          assert.deepEqual(
            { ...captured.threadSnapshot, ...expected.threadSnapshot },
            captured.threadSnapshot,
          );
        }
        for (const [capability, value] of Object.entries(expected.threadCapabilities ?? {})) {
          assert.equal(
            captured.implementationCapabilities[capability as keyof RuntimeCapabilities],
            value,
            `Unexpected ${capability} capability`,
          );
        }
        for (const capability of Object.values(captured.capabilities)) {
          assert.equal(typeof capability, "boolean");
        }
        if (captured.actions.setPinned !== undefined) {
          assert.equal(typeof captured.actions.setPinned, "function");
        }
        if (captured.actions.moveWithinWorkspace !== undefined) {
          assert.equal(typeof captured.actions.moveWithinWorkspace, "function");
        }
      } finally {
        await disposeHarness(harness);
      }
    });

    if (mutateThreadList) {
      test("publishes a monotonic thread-list revision for structural invalidation", async () => {
        const harness = createHarness();
        let notifications = 0;
        const unsubscribe = harness.adapter.subscribeThreadList(() => {
          notifications += 1;
        });
        try {
          const before = harness.adapter.getThreadListRevision();
          await mutateThreadList(harness);
          const after = harness.adapter.getThreadListRevision();
          assertRevision(after, "updated thread-list revision");
          assert.ok(after > before);
          assert.ok(notifications > 0);
        } finally {
          unsubscribe();
          await disposeHarness(harness);
        }
      });
    }

    if (mutateThread) {
      test("publishes a monotonic per-thread presentation revision", async () => {
        const harness = createHarness();
        const threadId = "contract-thread";
        const store = harness.adapter.threadStore;
        assert.ok(store, `${name} must expose threadStore for this contract scenario`);
        let notifications = 0;
        const unsubscribe = store.subscribe(threadId, () => {
          notifications += 1;
        });
        try {
          const before = store.getRevision(threadId);
          await mutateThread(harness, threadId);
          const after = store.getRevision(threadId);
          assertRevision(after, "updated thread revision");
          assert.ok(after > before);
          assert.ok(notifications > 0);
          assertThreadSnapshot(store.getSnapshot(threadId));
        } finally {
          unsubscribe();
          await disposeHarness(harness);
        }
      });
    }
  });
}
