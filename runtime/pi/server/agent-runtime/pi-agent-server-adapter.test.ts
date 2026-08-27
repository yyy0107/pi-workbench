import assert from "node:assert/strict";
import test from "node:test";

import { createPiAgentServerAdapter, PI_AGENT_SERVER_ADAPTER_ID } from "./pi-agent-server-adapter";

test("assembles Pi behind the Workbench Agent server boundary", () => {
  const adapter = createPiAgentServerAdapter();

  assert.equal(adapter.id, PI_AGENT_SERVER_ADAPTER_ID);
  assert.equal(typeof adapter.commands.getCatalog, "function");
  assert.equal(typeof adapter.execution.submit, "function");
  assert.equal(typeof adapter.execution.cancel, "function");
  assert.equal(typeof adapter.threads.list, "function");
  assert.equal(typeof adapter.threads.create, "function");
});
