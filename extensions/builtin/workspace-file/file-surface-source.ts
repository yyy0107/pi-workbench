import type { WorkspaceContext, WorkspaceScope } from "@/platform/extensions";
import { fileWorkspaceContext, type WorkspaceFileContext } from "@/services/workspace-file-service";

export interface FileSurfaceSourceParams {
  source?: "workspace" | "skill";
  rootPath?: string;
}

export function isSkillFileSource(params: FileSurfaceSourceParams): boolean {
  return params.source === "skill";
}

export function fileSurfaceRootPath(
  params: FileSurfaceSourceParams,
  context: Pick<WorkspaceContext, "rootPath">,
): string | undefined {
  return isSkillFileSource(params) ? params.rootPath : context.rootPath;
}

export function fileSurfaceWorkspaceContext(
  scope: WorkspaceScope,
  context: Pick<WorkspaceContext, "worktreeId" | "projectId" | "rootPath">,
  params: FileSurfaceSourceParams,
): WorkspaceFileContext {
  if (isSkillFileSource(params)) {
    return {
      scope,
      ...(params.rootPath ? { rootPath: params.rootPath } : {}),
    };
  }
  return fileWorkspaceContext(scope, context);
}
