import type { WorkbenchWorkspaceCapability } from "@workbench/agent-runtime-client/capabilities";
import type { WorkbenchWorkspaceGitDiffRequest } from "@workbench/agent-runtime-contracts/runtime-capabilities";
import { parseUnifiedPatch } from "@workbench/code-highlighting";
import type { OpenableResource } from "@workbench/extension-sdk";

const MAX_FILE_DIFF_BYTES = 16 * 1024 * 1024;

/** Read one immutable comparison in full before handing it to the existing file-tab opener. */
export async function readWorkspaceFileDiffResource(
  workspace: Pick<WorkbenchWorkspaceCapability, "readGitDiff">,
  request: WorkbenchWorkspaceGitDiffRequest & { path: string },
  signal: AbortSignal,
): Promise<OpenableResource> {
  const parts: string[] = [];
  let offset = 0;
  let patchVersion: string | undefined;
  let bytes = 0;
  const encoder = new TextEncoder();
  while (true) {
    signal.throwIfAborted();
    const page = await workspace.readGitDiff(
      { ...request, fullContext: true, exportPatch: false, offset, patchVersion },
      { signal },
    );
    signal.throwIfAborted();
    if (!page.repository || page.unrecorded || page.patch === undefined || !page.patchVersion) {
      throw new Error("File diff is unavailable");
    }
    if (patchVersion && patchVersion !== page.patchVersion) {
      throw new Error("File diff changed while loading");
    }
    patchVersion = page.patchVersion;
    bytes += encoder.encode(page.patch).byteLength;
    if (bytes > MAX_FILE_DIFF_BYTES) throw new Error("File diff exceeds the 16 MiB limit");
    parts.push(page.patch);
    if (page.nextOffset === undefined) break;
    if (page.nextOffset <= offset || page.nextOffset !== offset + page.patch.length) {
      throw new Error("Invalid file diff continuation");
    }
    offset = page.nextOffset;
  }
  const patch = parts.join("");
  if (/^(?:GIT binary patch|Binary files .+ differ)$/m.test(patch)) {
    throw new Error("Binary file diff is unavailable");
  }
  const hunks = parseUnifiedPatch(patch);
  // A full-context single-file patch must not silently become a misnumbered partial diff.
  if (hunks.length > 1 || hunks.some((hunk) => hunk.oldStart > 1 || hunk.newStart > 1)) {
    throw new Error("Full file context is unavailable");
  }
  return {
    scheme: "workspace-file",
    path: request.path,
    metadata: {
      viewMode: "diff",
      diffId: JSON.stringify([
        request.workspaceId,
        request.scope,
        request.revision,
        request.baseRevision,
        request.sessionId,
        request.path,
        patchVersion,
      ]),
      lines: hunks.flatMap((hunk) => hunk.lines),
      snapshotOnly: true,
    },
  };
}
