import assert from "node:assert/strict";
import test from "node:test";

import { defineWorkbenchAgentRuntimeDescriptor } from "@/runtime/shared/agent-runtime/descriptor";
import {
  createInstalledWorkbenchAgentServerAdapter,
  type WorkbenchAgentServerInstallation,
} from "./agent-runtime-installation";
import { createFixtureAgentServerAdapter } from "./testing/fixture-agent-server-adapter";

test("creates the server adapter selected by one explicit installation", () => {
  const adapter = createFixtureAgentServerAdapter();
  const installation: WorkbenchAgentServerInstallation = {
    descriptor: defineWorkbenchAgentRuntimeDescriptor(adapter.id),
    createAdapter: () => adapter,
  };

  assert.equal(createInstalledWorkbenchAgentServerAdapter(installation), adapter);
});

test("rejects a descriptor and server adapter identity mismatch", () => {
  const installation: WorkbenchAgentServerInstallation = {
    descriptor: defineWorkbenchAgentRuntimeDescriptor("selected-runtime"),
    createAdapter: createFixtureAgentServerAdapter,
  };

  assert.throws(
    () => createInstalledWorkbenchAgentServerAdapter(installation),
    /selected-runtime.*fixture-agent-server/,
  );
});
