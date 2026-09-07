import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

test(
  "Linux launchers resolve the checkout and stop before packaging or uploading on failure",
  {
    skip: process.platform === "win32",
  },
  () => {
    const temporary = mkdtempSync(path.join(tmpdir(), "workbench launchers "));
    const bin = path.join(temporary, "bin");
    const log = path.join(temporary, "calls.jsonl");
    try {
      mkdirSync(bin);
      writeFileSync(
        path.join(bin, "pnpm"),
        `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.WORKBENCH_SCRIPT_TEST_LOG, JSON.stringify({ cwd: process.cwd(), args }) + "\\n");
process.exit(args[0] === process.env.WORKBENCH_SCRIPT_TEST_FAIL ? 23 : 0);
`,
        { mode: 0o755 },
      );

      function run(script, args = [], fail = "") {
        writeFileSync(log, "");
        const result = spawnSync("bash", [path.join(root, "run_scripts/linux", script), ...args], {
          cwd: temporary,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${bin}${path.delimiter}${process.env.PATH}`,
            WORKBENCH_SCRIPT_TEST_LOG: log,
            WORKBENCH_SCRIPT_TEST_FAIL: fail,
          },
        });
        assert.ifError(result.error);
        const calls = readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
        for (const call of calls) assert.equal(call.cwd, path.resolve(root));
        return { status: result.status, calls: calls.map(({ args: callArgs }) => callArgs) };
      }

      assert.deepEqual(run("release.sh", ["--clobber"]), {
        status: 0,
        calls: [["release:build"], ["release:upload", "--clobber"]],
      });
      assert.deepEqual(run("release.sh", [], "release:build"), {
        status: 23,
        calls: [["release:build"]],
      });
      assert.deepEqual(run("electron-build.sh", [], "install"), {
        status: 23,
        calls: [["install", "--frozen-lockfile", "--prod=false"]],
      });
      assert.deepEqual(run("electron-build.sh", ["--x64"]), {
        status: 0,
        calls: [
          ["install", "--frozen-lockfile", "--prod=false"],
          ["electron:dist", "--linux", "deb", "--publish", "never", "--x64"],
        ],
      });
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  },
);
