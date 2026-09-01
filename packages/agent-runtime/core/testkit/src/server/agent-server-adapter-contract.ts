import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { WorkbenchAgentCommand } from "@workbench/agent-runtime-contracts/commands";
import {
  AgentCommandCatalogError,
  type AgentCommandCatalogErrorCode,
  type AgentCommandCatalogPort,
  type AgentCommandCatalogTarget,
} from "@workbench/agent-runtime-server/commands";
import {
  AgentExecutionError,
  type AgentExecutionErrorCode,
  type AgentPromptAdmission,
  type AgentPromptSubmission,
  type AgentExecutionPort,
} from "@workbench/agent-runtime-server/execution";
import type { WorkbenchAgentServerAdapter } from "@workbench/agent-runtime-server/adapter";
import {
  AgentThreadStoreError,
  type AgentThreadStoreErrorCode,
  type AgentThreadCreateInput,
  type AgentThreadCreateResult,
  type AgentThreadRenameResult,
  type AgentThreadSearchDocument,
  type AgentThreadStoreCapabilities,
  type AgentThreadStorePort,
  type AgentThreadSummary,
} from "@workbench/agent-runtime-server/threads";

const COMMAND_PORT_METHODS = ["getCatalog"] as const;
const EXECUTION_PORT_METHODS = ["submit", "cancel"] as const;
const THREAD_STORE_PORT_METHODS = ["list", "create", "rename", "delete"] as const;

export const WORKBENCH_AGENT_SERVER_CONTRACT_INPUTS = Object.freeze({
  submission: {
    threadId: "contract-thread",
    mode: "follow-up",
    prompt: {
      text: "Inspect the contract",
      attachments: [
        {
          kind: "image",
          data: "contract-image",
          mediaType: "image/png",
          name: "contract.png",
        },
        {
          kind: "document",
          data: "contract-pdf",
          mediaType: "application/pdf",
          name: "contract.pdf",
        },
      ],
    },
    provenance: { requestId: "contract-request", clientTimeZone: "Etc/UTC" },
  } satisfies AgentPromptSubmission,
  create: {
    rootPath: "/contract-workspace",
    requestedThreadId: "contract-created",
  } satisfies AgentThreadCreateInput,
  rename: { threadId: "contract-thread", title: "Contract title" },
  fork: { threadId: "contract-thread", atStateToken: "7" },
});

export interface AgentServerCommandContractCase {
  readonly target: AgentCommandCatalogTarget;
  readonly commands: readonly WorkbenchAgentCommand[];
}

export interface WorkbenchAgentServerContractExpectations {
  readonly id: string;
  readonly commands: readonly AgentServerCommandContractCase[];
  readonly admission: AgentPromptAdmission;
  readonly threadCapabilities: AgentThreadStoreCapabilities;
  readonly threads: readonly AgentThreadSummary[];
  readonly created: AgentThreadCreateResult;
  readonly renamed: AgentThreadRenameResult;
  readonly optional?: Readonly<{
    regeneration?: true;
    resume?: true;
    branches?: true;
    queue?: true;
    searchDocuments?: readonly AgentThreadSearchDocument[];
    forked?: Readonly<{ threadId: string }>;
  }>;
}

export interface WorkbenchAgentServerContractHarness {
  readonly adapter: WorkbenchAgentServerAdapter;
  readonly expectedPorts?: Readonly<{
    commands?: AgentCommandCatalogPort;
    execution?: AgentExecutionPort;
    threads?: AgentThreadStorePort;
  }>;
  dispose?(): void | Promise<void>;
}

export interface WorkbenchAgentServerContractOptions<
  Harness extends WorkbenchAgentServerContractHarness,
> {
  readonly name: string;
  readonly createHarness: () => Harness;
  readonly expected: WorkbenchAgentServerContractExpectations;
  readonly failures?: Readonly<{
    createHarness: () => WorkbenchAgentServerContractHarness;
    commandCode: AgentCommandCatalogErrorCode;
    executionCode: AgentExecutionErrorCode;
    threadCode: AgentThreadStoreErrorCode;
  }>;
}

function assertCommand(command: WorkbenchAgentCommand): void {
  assert.ok(["builtin", "extension", "prompt", "skill"].includes(command.kind));
  assert.ok(command.name.length > 0);
  assert.ok(command.invocationName.length > 0);
  assert.equal(typeof command.exclusive, "boolean");
}

function assertThreadSummary(summary: AgentThreadSummary): void {
  assert.ok(summary.threadId.length > 0);
  assert.ok(summary.rootPath.length > 0);
  assert.ok(Number.isSafeInteger(summary.messageCount));
  assert.ok(summary.messageCount >= 0);
  assert.equal(typeof summary.transient, "boolean");
  assert.equal(typeof summary.running, "boolean");
}

async function disposeHarness(harness: WorkbenchAgentServerContractHarness): Promise<void> {
  await harness.dispose?.();
}

/** Registers observable laws for a backend-neutral Workbench Agent server implementation. */
export function defineWorkbenchAgentServerAdapterContract<
  Harness extends WorkbenchAgentServerContractHarness,
>({ name, createHarness, expected, failures }: WorkbenchAgentServerContractOptions<Harness>): void {
  describe(`${name} WorkbenchAgentServerAdapter contract`, () => {
    test("exposes one stable identity, the required ports, and explicit optional capabilities", async () => {
      const harness = createHarness();
      try {
        const { adapter } = harness;
        assert.equal(adapter.id, expected.id);
        assert.ok(adapter.id.trim().length > 0);
        for (const method of COMMAND_PORT_METHODS) {
          assert.equal(typeof adapter.commands[method], "function");
        }
        for (const method of EXECUTION_PORT_METHODS) {
          assert.equal(typeof adapter.execution[method], "function");
        }
        for (const method of THREAD_STORE_PORT_METHODS) {
          assert.equal(typeof adapter.threads[method], "function");
        }
        assert.equal(typeof adapter.threads.capabilities.requestedThreadId, "boolean");
        assert.equal(typeof adapter.threads.capabilities.preset, "boolean");
        assert.deepEqual(adapter.threads.capabilities, expected.threadCapabilities);
        assert.equal(
          Boolean(adapter.execution.regeneration),
          expected.optional?.regeneration === true,
        );
        assert.equal(Boolean(adapter.execution.resume), expected.optional?.resume === true);
        assert.equal(Boolean(adapter.execution.branches), expected.optional?.branches === true);
        assert.equal(Boolean(adapter.execution.queue), expected.optional?.queue === true);
        assert.equal(
          Boolean(adapter.threads.search),
          expected.optional?.searchDocuments !== undefined,
        );
        assert.equal(Boolean(adapter.threads.fork), expected.optional?.forked !== undefined);
        if (harness.expectedPorts?.commands) {
          assert.equal(adapter.commands, harness.expectedPorts.commands);
        }
        if (harness.expectedPorts?.execution) {
          assert.equal(adapter.execution, harness.expectedPorts.execution);
        }
        if (harness.expectedPorts?.threads) {
          assert.equal(adapter.threads, harness.expectedPorts.threads);
        }
      } finally {
        await disposeHarness(harness);
      }
    });

    test("returns only backend-neutral Composer command records for every target kind", async () => {
      const harness = createHarness();
      try {
        for (const contractCase of expected.commands) {
          const commands = await harness.adapter.commands.getCatalog(contractCase.target);
          for (const command of commands) assertCommand(command);
          assert.deepEqual(commands, contractCase.commands);
        }
      } finally {
        await disposeHarness(harness);
      }
    });

    test("accepts the required neutral prompt and cancellation model", async () => {
      const harness = createHarness();
      try {
        const { execution } = harness.adapter;
        assert.deepEqual(
          await execution.submit(WORKBENCH_AGENT_SERVER_CONTRACT_INPUTS.submission),
          expected.admission,
        );
        await execution.cancel({ threadId: "contract-thread" });
      } finally {
        await disposeHarness(harness);
      }
    });

    test("projects the required neutral thread catalog and lifecycle model", async () => {
      const harness = createHarness();
      try {
        const { threads } = harness.adapter;
        const summaries = await threads.list();
        for (const summary of summaries) assertThreadSummary(summary);
        assert.deepEqual(summaries, expected.threads);
        assert.deepEqual(
          await threads.create(WORKBENCH_AGENT_SERVER_CONTRACT_INPUTS.create),
          expected.created,
        );
        assert.deepEqual(
          await threads.rename(WORKBENCH_AGENT_SERVER_CONTRACT_INPUTS.rename),
          expected.renamed,
        );
        await threads.delete({ threadId: "contract-thread" });
      } finally {
        await disposeHarness(harness);
      }
    });

    if (expected.optional) {
      test("accepts the explicitly declared optional capability ports", async () => {
        const harness = createHarness();
        try {
          const { execution, threads } = harness.adapter;
          if (expected.optional?.regeneration) {
            await execution.regeneration!.regenerate({
              threadId: "contract-thread",
              userMessageId: "contract-user-message",
            });
          }
          if (expected.optional?.resume) {
            await execution.resume!.resume({
              threadId: "contract-thread",
              checkpointId: "contract-checkpoint",
              expectedStateToken: "contract-state",
            });
          }
          if (expected.optional?.branches) {
            await execution.branches!.select({
              threadId: "contract-thread",
              branchToken: "contract-branch",
            });
          }
          if (expected.optional?.queue) {
            await execution.queue!.update({
              threadId: "contract-thread",
              itemId: "contract-queue-edit",
              mutation: { kind: "edit", text: "Updated contract prompt" },
            });
            await execution.queue!.update({
              threadId: "contract-thread",
              itemId: "contract-queue-remove",
              mutation: { kind: "remove" },
            });
            await execution.queue!.update({
              threadId: "contract-thread",
              itemId: "contract-queue-steer",
              mutation: { kind: "steer" },
            });
          }
          if (expected.optional?.searchDocuments) {
            assert.deepEqual(
              await threads.search!.listDocuments(),
              expected.optional.searchDocuments,
            );
          }
          if (expected.optional?.forked) {
            assert.deepEqual(
              await threads.fork!.fork(WORKBENCH_AGENT_SERVER_CONTRACT_INPUTS.fork),
              expected.optional.forked,
            );
          }
        } finally {
          await disposeHarness(harness);
        }
      });
    }

    if (failures) {
      test("normalizes implementation failures to stable Workbench Agent errors", async () => {
        const harness = failures.createHarness();
        try {
          await assert.rejects(
            harness.adapter.commands.getCatalog({ kind: "thread", threadId: "missing" }),
            (error: unknown) => {
              assert.ok(error instanceof AgentCommandCatalogError);
              assert.equal(error.code, failures.commandCode);
              return true;
            },
          );
          await assert.rejects(
            harness.adapter.execution.cancel({ threadId: "missing" }),
            (error: unknown) => {
              assert.ok(error instanceof AgentExecutionError);
              assert.equal(error.code, failures.executionCode);
              return true;
            },
          );
          await assert.rejects(
            harness.adapter.threads.delete({ threadId: "missing" }),
            (error: unknown) => {
              assert.ok(error instanceof AgentThreadStoreError);
              assert.equal(error.code, failures.threadCode);
              return true;
            },
          );
        } finally {
          await disposeHarness(harness);
        }
      });
    }
  });
}
