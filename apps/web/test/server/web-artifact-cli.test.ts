import assert from "node:assert/strict";
import test from "node:test";

import { parseWebArtifactCli } from "@/server/web-artifact-cli";

test("accepts only stdio control and no process-path configuration", () => {
  assert.deepEqual(parseWebArtifactCli([]), { control: "stdio" });
  assert.deepEqual(parseWebArtifactCli(["--control-stdio"]), { control: "stdio" });
  for (const argv of [
    ["--dev"],
    ["--web-root", "/source/apps/web"],
    ["--host", "0.0.0.0"],
    ["--manifest", "/tmp/artifact.json"],
  ]) {
    assert.throws(() => parseWebArtifactCli(argv), /Unsupported Web Host command line/u);
  }
});
