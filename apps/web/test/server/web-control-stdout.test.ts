import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";

import { claimWebControlStdout } from "@/server/web-control-stdout";

function recordingWritable(chunks: string[]): Writable {
  return new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk).toString());
      callback();
    },
  });
}

test("reserves Web stdout for control and redirects incidental diagnostics to stderr", async () => {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const stdout = recordingWritable(stdoutChunks);
  const stderr = recordingWritable(stderrChunks);
  const originalWrite = stdout.write;
  const lease = claimWebControlStdout(stdout, stderr);

  stdout.write("Next diagnostic\n");
  lease.output.write('{"type":"ready"}\n');
  await new Promise<void>((resolve, reject) =>
    lease.output.write("", "utf8", (error) => (error ? reject(error) : resolve())),
  );

  assert.deepEqual(stdoutChunks, ['{"type":"ready"}\n', ""]);
  assert.deepEqual(stderrChunks, ["Next diagnostic\n"]);
  lease.release();
  lease.release();
  assert.equal(stdout.write, originalWrite);

  stdout.write("after release\n");
  assert.deepEqual(stdoutChunks, ['{"type":"ready"}\n', "", "after release\n"]);
});
