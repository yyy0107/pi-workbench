import assert from "node:assert/strict";
import test from "node:test";

import { terminalEnvironment } from "./terminal-environment";

test("uses the user's named UTF-8 locale instead of a launcher C locale", () => {
  assert.deepEqual(
    terminalEnvironment({
      LANG: "zh_CN.UTF-8",
      LC_CTYPE: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      KEEP: "value",
    }),
    {
      LANG: "zh_CN.UTF-8",
      LC_CTYPE: "zh_CN.UTF-8",
      KEEP: "value",
    },
  );
});

test("repairs a portable LC_CTYPE when LC_ALL is not set", () => {
  assert.deepEqual(terminalEnvironment({ LANG: "en_US.UTF-8", LC_CTYPE: "C" }), {
    LANG: "en_US.UTF-8",
    LC_CTYPE: "en_US.UTF-8",
  });
});

test("preserves an explicit named locale and a portable-only environment", () => {
  assert.deepEqual(terminalEnvironment({ LANG: "zh_CN.UTF-8", LC_ALL: "en_US.UTF-8" }), {
    LANG: "zh_CN.UTF-8",
    LC_ALL: "en_US.UTF-8",
  });
  assert.deepEqual(terminalEnvironment({ LANG: "C.UTF-8", LC_ALL: "C.UTF-8" }), {
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
  });
});
