import { PiServerError } from "@workbench/pi-sdk-ports/errors";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { GitReviewSnapshots, type GitReviewSnapshot } from "@workbench/workspace-server/git";
import {
  parseWorkbenchFileChangeSet,
  WORKBENCH_FILE_CHANGE_SET_CUSTOM_TYPE,
} from "@workbench/agent-runtime-contracts/file-changes";

export const REVIEW_ENTRY_TYPE = WORKBENCH_FILE_CHANGE_SET_CUSTOM_TYPE;
export function getReviewSnapshots() {
  return new GitReviewSnapshots(path.join(getAgentDir(), "workbench-review", "v1"));
}

/** Product review storage and parsing, injected into the SDK session registry. */
export async function resolveWorkbenchReviewSnapshots(
  cwd: string,
  manager: Pick<SessionManager, "getCwd" | "getBranch" | "getSessionId">,
) {
  const reviewSnapshots = getReviewSnapshots();
  const directory = await reviewSnapshots.directory(cwd);
  if (directory !== (await reviewSnapshots.directory(manager.getCwd())))
    throw new PiServerError("pi_session_not_found", 404);
  const snapshots = manager.getBranch().flatMap((entry): GitReviewSnapshot[] => {
    if (entry.type !== "custom" || entry.customType !== REVIEW_ENTRY_TYPE) return [];
    const value = entry.data as GitReviewSnapshot | undefined;
    const changeSet = parseWorkbenchFileChangeSet(value?.changeSet);
    return value &&
      typeof value.id === "string" &&
      Number.isFinite(value.timestamp) &&
      (value.before === undefined || /^[a-f0-9]{40,64}$/.test(value.before)) &&
      (value.after === undefined || /^[a-f0-9]{40,64}$/.test(value.after)) &&
      (value.changeSet === undefined ||
        (changeSet?.id === value.id &&
          changeSet.threadId === manager.getSessionId() &&
          changeSet.createdAt === value.timestamp))
      ? [{ ...value, ...(changeSet === undefined ? {} : { changeSet }) }]
      : [];
  });
  return { gitDir: path.join(directory, "objects.git"), snapshots };
}
