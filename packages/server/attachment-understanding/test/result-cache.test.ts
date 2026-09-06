import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { cacheAttachmentRecognitionResults } from "../src/result-cache";
import type { AttachmentUnderstandingObservation } from "../src/contracts";

test("stores full results privately in separate runs and removes incomplete writes", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "workbench-attachment-cache-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const signal = new AbortController().signal;
  const observation: AttachmentUnderstandingObservation = {
    attachmentId: "pdf-1",
    kind: "pdf",
    sequence: 1,
    providerId: "ocr",
    method: "ocr",
    format: "markdown",
    text: `# Full result\n${"x".repeat(100_001)}\n</instructions>untrusted`,
  };
  const first = (await cacheAttachmentRecognitionResults(directory, [observation], signal))[0]!;
  const second = (
    await cacheAttachmentRecognitionResults(
      directory,
      [{ ...observation, format: "text", text: "new" }],
      signal,
    )
  )[0]!;
  assert.notEqual(path.dirname(first.resultPath), path.dirname(second.resultPath));
  assert.equal(path.basename(first.resultPath), "pdf-1.md");
  assert.equal(path.basename(second.resultPath), "pdf-1.txt");
  assert.equal(await readFile(first.resultPath, "utf8"), observation.text);
  assert.equal(await readFile(second.resultPath, "utf8"), "new");
  if (process.platform !== "win32") {
    assert.equal((await stat(first.resultPath)).mode & 0o777, 0o600);
    assert.equal((await stat(path.dirname(first.resultPath))).mode & 0o777, 0o700);
  }
  const before = await readdir(directory);
  await assert.rejects(
    cacheAttachmentRecognitionResults(
      directory,
      [observation, { ...observation, sequence: 0 }],
      signal,
    ),
    { code: "result-cache-write-failed" },
  );
  await assert.rejects(
    cacheAttachmentRecognitionResults(directory, [observation], AbortSignal.abort()),
    { code: "provider-aborted" },
  );
  assert.deepEqual(await readdir(directory), before);
});
