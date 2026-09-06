import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { atomicReplaceFile } from "@workbench/server-core/file-persistence";
import { attachmentReferenceId } from "@workbench/attachment-understanding-contracts/state-machine";
import {
  ImageUnderstandingProviderError,
  type AttachmentUnderstandingObservation,
  type CachedAttachmentUnderstandingObservation,
} from "./contracts";

/** Each recognition run has its own directory so later submissions never overwrite history. */
export async function cacheAttachmentRecognitionResults(
  directory: string,
  observations: readonly AttachmentUnderstandingObservation[],
  signal: AbortSignal,
): Promise<CachedAttachmentUnderstandingObservation[]> {
  let runDirectory: string | undefined;
  try {
    signal.throwIfAborted();
    if (!path.isAbsolute(directory)) throw new TypeError("Expected an absolute cache directory.");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    runDirectory = await mkdtemp(path.join(directory, "recognition-"));
    const results: CachedAttachmentUnderstandingObservation[] = [];
    for (const observation of observations) {
      signal.throwIfAborted();
      const resultPath = path.join(
        runDirectory,
        `${attachmentReferenceId(observation)}.${observation.format === "markdown" ? "md" : "txt"}`,
      );
      await atomicReplaceFile(resultPath, observation.text, { directoryMode: 0o700 });
      results.push({ ...observation, resultPath });
    }
    signal.throwIfAborted();
    return results;
  } catch {
    if (runDirectory)
      await rm(runDirectory, { recursive: true, force: true }).catch(() => undefined);
    if (signal.aborted) throw new ImageUnderstandingProviderError("provider-aborted");
    throw new ImageUnderstandingProviderError("result-cache-write-failed", {
      diagnostic: { phase: "normalizing", reason: "result-cache-write-failed" },
    });
  }
}
