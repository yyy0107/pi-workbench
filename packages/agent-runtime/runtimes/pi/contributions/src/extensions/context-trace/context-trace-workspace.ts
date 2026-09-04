import { definePiMessage } from "../../i18n";

import type { RightWorkspaceController } from "@workbench/shell/right-workspace";

import type { WorkspaceContext } from "@workbench/extension-sdk";

export const CONTEXT_TRACE_SURFACE_KIND = "context-trace";
export const CONTEXT_TRACE_SURFACE_TITLE = definePiMessage("extensions.contextTrace.title");

export interface ContextTraceSurfaceParams extends Record<string, unknown> {
  sessionId: string;
}

export function revealContextTrace({
  context,
  controller,
  sessionId,
}: {
  context: WorkspaceContext;
  controller: RightWorkspaceController;
  sessionId: string;
}): string {
  return controller.reveal({
    kind: CONTEXT_TRACE_SURFACE_KIND,
    title: CONTEXT_TRACE_SURFACE_TITLE,
    params: { sessionId } satisfies ContextTraceSurfaceParams,
    context,
    scope: {
      type: context.threadId ? "thread" : "application",
      key: context.threadId ?? context.applicationId,
    },
    status: "loading",
  });
}
