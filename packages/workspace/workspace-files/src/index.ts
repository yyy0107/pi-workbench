export {
  BufferedFileWorkspaceService,
  MemoryFileWorkspaceService,
  workspaceAbsolutePath,
  workspaceRelativePath,
  type FileWorkspaceBackend,
  type FileWorkspaceResourceBackend,
  type LocalFileWorkspaceBackend,
} from "./buffered-file-workspace-service";
export {
  MemoryFileDiffService,
  type FileDiffDescriptor,
  type FileDiffService,
  type FileDiffSnapshot,
} from "./file-diff-service";
export {
  FileWorkspaceTargetService,
  useFileWorkspaceTargetService,
} from "./file-workspace-target-service";
export {
  fileWorkspaceContext,
  fileWorkspaceOpenableResource,
  fileWorkspaceSessionKey,
  resolveFileWorkspaceSession,
  type ExtensionFileSession,
  type FileDescriptor,
  type FileContentTarget,
  type FileDirectoryListing,
  type FileNode,
  type FileSnapshot,
  type FileWorkspaceService,
  type FileWorkspaceSession,
  type LocalFileSession,
  type ResourceCatalogTarget,
  type ResourceFileSession,
  type SkillFileSession,
  type Unsubscribe,
  type WorkspaceFileContext,
  type WorkspaceFileSession,
} from "./workspace-file-service";
export {
  WorkbenchWorkspaceFileRuntimeProvider,
  WorkspaceFileRuntimeProvider,
  useWorkspaceFileRuntime,
  type WorkspaceFileRuntime,
} from "./workspace-file-runtime";
export { fileLinkResource, openFileLink, parseLocalFileHref } from "./file-link";

export { FileLink, FileLinkContextMenu } from "./file-link-component";
export * from "../lib/file-classification";
export * from "../lib/file-link-content";
export * from "../lib/asset-module-url";

export { readWorkspaceFileDiffResource } from "./file-diff-resource";
