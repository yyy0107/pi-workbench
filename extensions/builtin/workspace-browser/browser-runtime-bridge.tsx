"use client";

import { useCallback } from "react";

import { useRightWorkspace, useWorkspaceContext } from "@/components/right-workspace";

import { stringArg, useCompletedWorkspaceToolCalls } from "../workspace-shared/runtime-tool-events";
import { browserSessionService } from "./browser-session-service";

export function BrowserRuntimeBridge() {
  const controller = useRightWorkspace();
  const context = useWorkspaceContext();

  useCompletedWorkspaceToolCalls(
    useCallback(
      (part) => {
        const url = stringArg(part.args, "url");
        const sessionId = stringArg(part.args, "browserSessionId", "sessionId", "session_id");
        if (!/browser/i.test(part.toolName) || part.result === undefined || !url || !sessionId) {
          return false;
        }
        const projectId = context.projectId ?? context.applicationId;
        if (!browserSessionService.getSession(sessionId)) {
          browserSessionService.attach({
            id: sessionId,
            projectId,
            url,
            title: url,
            status: "ready",
            canGoBack: false,
            canGoForward: false,
          });
        }
        controller.reveal({
          kind: "browser",
          title: url,
          params: { browserSessionId: sessionId, url },
          context,
          scope: { type: context.projectId ? "project" : "application", key: projectId },
          status: "ready",
          policy: "background",
        });
        return true;
      },
      [context, controller],
    ),
  );

  return null;
}
