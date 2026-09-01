import assert from "node:assert/strict";
import test from "node:test";

import { parseRuntimeNodeCli } from "../src/cli";

test("accepts only the API-only stdio control mode", () => {
  assert.deepEqual(parseRuntimeNodeCli([]), { control: "stdio" });
  assert.deepEqual(parseRuntimeNodeCli(["--control-stdio"]), { control: "stdio" });
  for (const argv of [["--dev"], ["--runtime-only"], ["--host", "0.0.0.0"]]) {
    assert.throws(() => parseRuntimeNodeCli(argv), /Unsupported Runtime Host command line/);
  }
});
