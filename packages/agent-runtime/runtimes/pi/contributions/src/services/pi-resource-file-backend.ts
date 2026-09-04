import type { PiResourceClient } from "@workbench/agent-runtime-pi-client/resources";
import { projectPiCapabilityError } from "@workbench/agent-runtime-pi-client/errors";
import {
  workspaceAbsolutePath,
  type ExtensionFileSession,
  type FileWorkspaceResourceBackend,
  type ResourceFileSession,
} from "@workbench/shell/workspace-files";

function resourceRequest(session: ResourceFileSession) {
  return session.resourceTarget
    ? { target: session.resourceTarget }
    : { sessionId: session.sessionId };
}

function extensionIdentity(session: ExtensionFileSession) {
  return {
    ...resourceRequest(session),
    name: session.extensionName,
    filePath: session.extensionFilePath,
    source: session.extensionSource,
    scope: session.extensionScope,
    origin: session.extensionOrigin,
  };
}

export function createPiResourceFileBackend(
  resources: Pick<
    PiResourceClient,
    "listSkillFiles" | "readSkillFile" | "listExtensionFiles" | "readExtensionFile"
  >,
): FileWorkspaceResourceBackend {
  return {
    async listDirectory(session, relativePath) {
      try {
        const listing = await (session.source === "skill"
          ? resources.listSkillFiles({
              ...resourceRequest(session),
              name: session.skillName,
              relativePath,
            })
          : resources.listExtensionFiles({ ...extensionIdentity(session), relativePath }));
        return {
          path: workspaceAbsolutePath(listing.rootPath, listing.relativePath),
          relativePath: listing.relativePath,
          nodes: listing.entries.map((entry) => ({
            ...entry,
            path: workspaceAbsolutePath(listing.rootPath, entry.relativePath),
          })),
          truncated: listing.truncated,
        };
      } catch (error) {
        throw projectPiCapabilityError(error);
      }
    },
    async readFile(session, relativePath) {
      try {
        const file = await (session.source === "skill"
          ? resources.readSkillFile({
              ...resourceRequest(session),
              name: session.skillName,
              relativePath,
            })
          : resources.readExtensionFile({ ...extensionIdentity(session), relativePath }));
        return {
          path: file.absolutePath,
          relativePath: file.relativePath,
          source: "resource",
          name: file.name,
          content: file.content,
          savedContent: file.content,
          version: file.version,
          modifiedAt: file.modifiedAt,
          size: file.size,
        };
      } catch (error) {
        throw projectPiCapabilityError(error);
      }
    },
  };
}
