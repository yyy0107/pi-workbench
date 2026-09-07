import assert from "node:assert/strict";
import test from "node:test";

import type { WorkbenchProjectTrust } from "@workbench/host-contracts/runtime-capabilities";
import { admitWorkspace } from "./workspace-admission";

test("only asks when the runtime requires a trust decision", async () => {
  const admitted: string[] = [];
  for (const trust of [
    { path: "/work/unresolved", requiresTrust: true, trusted: null, promptRequired: true },
    { path: "/work/untrusted", requiresTrust: true, trusted: false, promptRequired: false },
    { path: "/work/trusted", requiresTrust: true, trusted: true, promptRequired: false },
    { path: "/work/empty", requiresTrust: false, trusted: true, promptRequired: false },
  ] satisfies WorkbenchProjectTrust[]) {
    assert.equal(
      await admitWorkspace(trust, (path) => {
        admitted.push(path);
      }),
      trust.promptRequired ? trust.path : undefined,
    );
  }
  assert.deepEqual(admitted, ["/work/untrusted", "/work/trusted", "/work/empty"]);
});
