import assert from "node:assert/strict";
import test from "node:test";

import { normalizeMobileSystemPath } from "../src/app/+native-intent.tsx";

test("rejects every unsolicited system URL because direct pairing stays inside the foreground UI", () => {
  assert.equal(
    normalizeMobileSystemPath("workbench-remote://oauth/callback?code=opaque&state=opaque"),
    "/",
  );
  assert.equal(
    normalizeMobileSystemPath(
      "workbench-remote://notification/open?machineId=machine-1&sessionId=session-1",
    ),
    "/",
  );
  assert.equal(
    normalizeMobileSystemPath(
      "workbench-remote://notification/open?machineId=bad%20id&sessionId=session-1",
    ),
    "/",
  );
  assert.equal(normalizeMobileSystemPath("https://attacker.example/session-1"), "/");
});
