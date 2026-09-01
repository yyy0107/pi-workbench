import assert from "node:assert/strict";
import test from "node:test";

import { runWebArtifactMain } from "@/server/web-artifact-main";

test("claims stdout before importing the Web/Next owner and passes only artifact-local state", async () => {
  const originalWrite = process.stdout.write;
  let writeDuringImport: typeof process.stdout.write | undefined;
  let received:
    | Parameters<typeof import("@/server/web-host-process").runWebHostProcess>[0]
    | undefined;
  await runWebArtifactMain({
    artifactRoot: "/artifact/from-import-meta",
    forceExit: () => assert.fail("successful injected process must not force exit"),
    async importWebHostProcess() {
      writeDuringImport = process.stdout.write;
      return {
        async runWebHostProcess(options) {
          received = options;
        },
      };
    },
  });

  assert.notEqual(writeDuringImport, originalWrite);
  assert.equal(received?.artifactRoot, "/artifact/from-import-meta");
  assert.ok(received?.output);
  assert.equal(process.stdout.write, originalWrite);
});

test("rejects argv path overrides before importing the Web application graph", async () => {
  const originalWrite = process.stdout.write;
  let imported = false;
  await assert.rejects(
    runWebArtifactMain({
      argv: ["--web-root", "/source/apps/web"],
      artifactRoot: "/artifact/from-import-meta",
      async importWebHostProcess() {
        imported = true;
        throw new Error("must not import");
      },
    }),
    /Unsupported Web Host command line/u,
  );
  assert.equal(imported, false);
  assert.equal(process.stdout.write, originalWrite);
});
