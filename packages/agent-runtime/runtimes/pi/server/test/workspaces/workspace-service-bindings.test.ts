import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceGitServiceError } from "@workbench/workspace-server/git";
import {
  getPiResourceMutationCoordinator,
  PiResourceMutationCoordinator,
} from "../../src/resources/pi-resource-mutation-coordinator";
import { mutatePiWorkspace } from "../../src/workspaces/workspace-service-bindings";

test("workspace mutations reject busy sessions, then mutate and reload in order; no-ops skip reload", async (t) => {
  let busy = true;
  const calls: string[] = [];
  const coordinator = new PiResourceMutationCoordinator({
    getLoadedSessions: () => [
      {
        id: "session-1",
        get isBusy() {
          calls.push("check");
          return busy;
        },
        session: {
          sessionManager: { getCwd: () => "/workspace/project" },
          reload: async () => {
            calls.push("reload");
          },
        },
      },
    ],
  });
  t.mock.method(getPiResourceMutationCoordinator(), "mutate", coordinator.mutate.bind(coordinator));
  const operation = async () => {
    calls.push("mutate");
    return { value: "done", changed: true };
  };
  await assert.rejects(mutatePiWorkspace("/workspace/project", operation), (error) => {
    assert.ok(error instanceof WorkspaceGitServiceError);
    assert.equal(error.code, "session-busy");
    assert.equal(error.details.sessionId, "session-1");
    return true;
  });
  assert.deepEqual(calls, ["check"]);
  busy = false;
  calls.length = 0;
  assert.equal(await mutatePiWorkspace("/workspace/project", operation), "done");
  assert.ok(calls.indexOf("check") < calls.indexOf("mutate"));
  assert.ok(calls.indexOf("mutate") < calls.indexOf("reload"));
  calls.length = 0;
  assert.equal(
    await mutatePiWorkspace("/workspace/project", async () => ({
      value: "unchanged",
      changed: false,
    })),
    "unchanged",
  );
  assert.equal(calls.includes("reload"), false);
});
