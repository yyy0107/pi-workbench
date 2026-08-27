import assert from "node:assert/strict";
import test from "node:test";

import { readAgentThreadWorkspace } from "@/runtime/assistant-ui/agent-runtime-extras";

import { PiSessionManager } from "../runtime/manager";
import { projectPiAgentRuntimeExtras } from "./extras";

test("projects Pi cwd metadata into the backend-neutral Workbench workspace capability", () => {
  const manager = new PiSessionManager();
  const session = manager.getSession("local-thread");

  try {
    manager.setDraftWorkspace("local-thread", {
      id: "workspace-1",
      name: "Project",
      cwd: "/projects/example",
      pinned: true,
    });
    const workspace = manager.getThreadStateSnapshot("local-thread").metadata.workspace;
    const extras = projectPiAgentRuntimeExtras({
      session,
      snapshot: session.getSnapshot(),
      workspace,
      clearComposerError: () => undefined,
    });

    assert.deepEqual(readAgentThreadWorkspace(extras), {
      id: "workspace-1",
      name: "Project",
      rootPath: "/projects/example",
      pinned: true,
    });
  } finally {
    manager.dispose();
  }
});
