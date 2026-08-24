import assert from "node:assert/strict";
import test from "node:test";

import { localAppSpawnEnvironment } from "./process";

test("local app launches do not inherit Electron's run-as-Node mode", () => {
  assert.deepEqual(
    localAppSpawnEnvironment({
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "test",
      PATH: "/usr/bin",
    }),
    { NODE_ENV: "test", PATH: "/usr/bin" },
  );
});
