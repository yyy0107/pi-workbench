import assert from "node:assert/strict";
import test from "node:test";

import { defineWorkbenchAgentRuntimeDescriptor } from "@workbench/agent-runtime-contracts/descriptor";
import type { WorkbenchAgentServerAdapter } from "@workbench/agent-runtime-server/adapter";
import {
  createInstalledWorkbenchAgentServerAdapter,
  type WorkbenchAgentServerInstallation,
} from "@workbench/agent-runtime-server/installation";

function createRequiredBaseAdapter(id = "fixture-agent-server"): WorkbenchAgentServerAdapter {
  return {
    id,
    commands: {
      getCatalog: async () => [],
    },
    execution: {
      submit: async () => ({ kind: "started" }),
      cancel: async () => undefined,
    },
    threads: {
      capabilities: { requestedThreadId: false, preset: false },
      list: async () => [],
      create: async () => ({ threadId: "created-thread" }),
      rename: async () => ({}),
      delete: async () => undefined,
    },
  };
}

test("creates the server adapter selected by one explicit installation", () => {
  const adapter = createRequiredBaseAdapter();
  const installation: WorkbenchAgentServerInstallation = {
    descriptor: defineWorkbenchAgentRuntimeDescriptor(adapter.id),
    createAdapter: () => adapter,
  };

  assert.equal(createInstalledWorkbenchAgentServerAdapter(installation), adapter);
});

test("rejects a descriptor and server adapter identity mismatch", () => {
  const installation: WorkbenchAgentServerInstallation = {
    descriptor: defineWorkbenchAgentRuntimeDescriptor("selected-runtime"),
    createAdapter: createRequiredBaseAdapter,
  };

  assert.throws(
    () => createInstalledWorkbenchAgentServerAdapter(installation),
    /selected-runtime.*fixture-agent-server/,
  );
});
