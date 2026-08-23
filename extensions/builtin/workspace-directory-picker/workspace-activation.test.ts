import assert from "node:assert/strict";
import test from "node:test";

import { activateCreatedWorkspace } from "./workspace-activation";

test("selects the accepted workspace before switching to the new thread", async () => {
  const events: string[] = [];
  let finishSwitch!: () => void;
  const switching = new Promise<void>((resolve) => {
    finishSwitch = resolve;
  });
  const workspace = { id: "workspace-created", name: "Created", cwd: "/created" };

  const activation = activateCreatedWorkspace(workspace, {
    beginNewThreadWithCreatedWorkspace: (created) => events.push(`begin:${created.id}`),
    switchToNewThread: () => {
      events.push("switch");
      return switching;
    },
    navigateHome: () => events.push("navigate"),
  });

  assert.deepEqual(events, ["begin:workspace-created", "switch"]);
  finishSwitch();
  await activation;
  assert.deepEqual(events, ["begin:workspace-created", "switch", "navigate"]);
});
