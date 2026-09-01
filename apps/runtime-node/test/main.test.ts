import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";

import { runRuntimeNodeMain } from "../src/main";

test("claims stdout before loading the installed Runtime graph and restores it afterwards", async () => {
  const originalWrite = process.stdout.write;
  let writeDuringImport: typeof process.stdout.write | undefined;
  let outputDuringRun: Writable | undefined;
  await runRuntimeNodeMain({
    argv: [],
    forceExit: () => assert.fail("successful injected control must not force process exit"),
    async importRuntimeHost() {
      writeDuringImport = process.stdout.write;
      return {
        async runInstalledRuntimeHostControl(options = {}) {
          outputDuringRun = options.output;
        },
      };
    },
  });

  assert.notEqual(writeDuringImport, originalWrite);
  assert.ok(outputDuringRun);
  assert.equal(process.stdout.write, originalWrite);
});

test("releases the stdout lease when command parsing fails before graph import", async () => {
  const originalWrite = process.stdout.write;
  let imported = false;
  await assert.rejects(
    runRuntimeNodeMain({
      argv: ["--invalid"],
      forceExit: () => assert.fail("invalid argv must fail before control starts"),
      async importRuntimeHost() {
        imported = true;
        throw new Error("must not import");
      },
    }),
    /Unsupported Runtime Host command line/,
  );
  assert.equal(imported, false);
  assert.equal(process.stdout.write, originalWrite);
});

test("passes the production force-exit boundary into the control owner", async () => {
  const exits: number[] = [];
  await runRuntimeNodeMain({
    argv: [],
    forceExit: (code) => exits.push(code),
    async importRuntimeHost() {
      return {
        async runInstalledRuntimeHostControl(options = {}) {
          options.forceExit?.(1);
        },
      };
    },
  });
  assert.deepEqual(exits, [1]);
});
