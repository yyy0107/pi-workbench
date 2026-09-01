import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";

import { claimRuntimeControlStdout } from "../src/runtime-control-stdout";

function recordingWritable(chunks: string[]): Writable {
  return new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk).toString());
      callback();
    },
  });
}

test("reserves stdout for the control writer and restores direct writes on release", async () => {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const stdout = recordingWritable(stdoutChunks);
  const stderr = recordingWritable(stderrChunks);
  const originalWrite = stdout.write;
  const lease = claimRuntimeControlStdout(stdout, stderr);

  stdout.write("application diagnostic\n");
  lease.output.write('{"type":"ready"}\n');
  await new Promise<void>((resolve, reject) =>
    lease.output.write("", "utf8", (error) => (error ? reject(error) : resolve())),
  );

  assert.deepEqual(stdoutChunks, ['{"type":"ready"}\n', ""]);
  assert.deepEqual(stderrChunks, ["application diagnostic\n"]);
  lease.release();
  lease.release();
  assert.equal(stdout.write, originalWrite);

  stdout.write("after release\n");
  assert.deepEqual(stdoutChunks, ['{"type":"ready"}\n', "", "after release\n"]);
});
