import assert from "node:assert/strict";
import test from "node:test";

import { admitTrustedWorkspace } from "./workspace-admission";

test("only admits a workspace with an affirmative trust decision", async () => {
  const admitted: string[] = [];
  const admit = (path: string) => {
    admitted.push(path);
  };

  assert.equal(
    await admitTrustedWorkspace({ path: "/work/unresolved", trusted: null }, admit),
    "/work/unresolved",
  );
  assert.equal(
    await admitTrustedWorkspace({ path: "/work/untrusted", trusted: false }, admit),
    "/work/untrusted",
  );
  assert.equal(
    await admitTrustedWorkspace({ path: "/work/trusted", trusted: true }, admit),
    undefined,
  );
  assert.deepEqual(admitted, ["/work/trusted"]);
});
