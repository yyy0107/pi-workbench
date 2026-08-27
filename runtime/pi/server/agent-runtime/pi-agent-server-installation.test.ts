import assert from "node:assert/strict";
import test from "node:test";

import { PI_AGENT_RUNTIME_DESCRIPTOR } from "@/runtime/pi/descriptor";
import { createInstalledWorkbenchAgentServerAdapter } from "@/runtime/server/agent-runtime-installation";

import { createPiAgentServerInstallation } from "./pi-agent-server-installation";

test("installs Pi with one shared identity and preserves explicitly bound ports", () => {
  const commands = { getCatalog: async () => [] };
  const execution = {
    submit: async () => ({ kind: "started" as const }),
    regenerate: async () => undefined,
    resume: async () => undefined,
    selectBranch: async () => undefined,
    updateQueue: async () => undefined,
    cancel: async () => undefined,
  };
  const threads = {
    capabilities: { requestedThreadId: true, preset: false },
    list: async () => [],
    listSearchDocuments: async () => [],
    create: async () => ({ threadId: "created" }),
    rename: async () => ({ revision: 1 }),
    fork: async () => ({ threadId: "forked" }),
    delete: async () => undefined,
  };
  const installation = createPiAgentServerInstallation({ commands, execution, threads });
  const adapter = createInstalledWorkbenchAgentServerAdapter(installation);

  assert.equal(installation.descriptor, PI_AGENT_RUNTIME_DESCRIPTOR);
  assert.equal(adapter.id, PI_AGENT_RUNTIME_DESCRIPTOR.id);
  assert.equal(adapter.commands, commands);
  assert.equal(adapter.execution, execution);
  assert.equal(adapter.threads, threads);
});
