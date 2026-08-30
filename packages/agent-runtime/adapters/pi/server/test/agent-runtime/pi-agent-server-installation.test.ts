import assert from "node:assert/strict";
import test from "node:test";

import { PI_AGENT_RUNTIME_DESCRIPTOR } from "@workbench/agent-runtime-pi-shared/descriptor";
import { createInstalledWorkbenchAgentServerAdapter } from "@workbench/agent-runtime-server/installation";

import { createPiAgentServerInstallation } from "../../src/agent-runtime/pi-agent-server-installation";

test("installs Pi with one shared identity and preserves explicitly bound ports", () => {
  const commands = { getCatalog: async () => [] };
  const execution = {
    submit: async () => ({ kind: "started" as const }),
    cancel: async () => undefined,
    regeneration: { regenerate: async () => undefined },
    resume: { resume: async () => undefined },
    branches: { select: async () => undefined },
    queue: { update: async () => undefined },
  };
  const threads = {
    capabilities: { requestedThreadId: true, preset: false },
    list: async () => [],
    create: async () => ({ threadId: "created" }),
    rename: async () => ({ stateToken: "1" }),
    delete: async () => undefined,
    search: { listDocuments: async () => [] },
    fork: { fork: async () => ({ threadId: "forked" }) },
  };
  const installation = createPiAgentServerInstallation({ commands, execution, threads });
  const adapter = createInstalledWorkbenchAgentServerAdapter(installation);

  assert.equal(installation.descriptor, PI_AGENT_RUNTIME_DESCRIPTOR);
  assert.equal(adapter.id, PI_AGENT_RUNTIME_DESCRIPTOR.id);
  assert.equal(adapter.commands, commands);
  assert.equal(adapter.execution, execution);
  assert.equal(adapter.threads, threads);
});
