"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";

import { useI18n } from "@/i18n";
import { WorkbenchAgentRuntimeHost } from "@/runtime/assistant-ui/agent-runtime-host";
import type { PromptFeedbackPort } from "@/services/workspace-feedback-service";

import { PiSessionManagerProvider } from "../runtime/context";
import { PI_CLIENT_RUNTIME_IMPLEMENTATION_TOKEN, PiSessionManager } from "../runtime/manager";
import { createPiAgentRuntimeAdapter } from "./adapter";
import { beginPiSessionManagerLifecycle } from "./session-manager-lifecycle";
import { ActivePiThreadTracker, PiDraftWorkspaceTracker } from "./trackers";
import { PiWorkspaceSelectionProvider } from "./workspace-selection-provider";

/** Complete Pi installation behind the generic Workbench Agent Runtime host. */
export function PiAgentRuntimeProvider({
  children,
  promptFeedback,
}: Readonly<{ children: ReactNode; promptFeedback?: PromptFeedbackPort }>) {
  const { t } = useI18n();
  const titleFallbacks = useMemo(
    () => ({
      attachment: t("workbench.chat.titles.attachmentAnalysis"),
      image: t("workbench.chat.titles.imageConversation"),
    }),
    [t],
  );
  const managerRef = useRef<PiSessionManager | null>(null);
  const managerLifecycleRef = useRef(0);

  // Fast Refresh keeps refs alive even when the manager module is replaced. Recreate the manager
  // so existing sessions cannot retain an older class prototype without newly added RPC methods.
  if (
    managerRef.current &&
    managerRef.current.implementationToken !== PI_CLIENT_RUNTIME_IMPLEMENTATION_TOKEN
  ) {
    managerRef.current = null;
  }
  if (!managerRef.current) {
    managerRef.current = new PiSessionManager({ promptFeedback, titleFallbacks });
  }
  const manager = managerRef.current;
  const adapter = useMemo(() => createPiAgentRuntimeAdapter(manager), [manager]);

  useEffect(() => manager.setTitleFallbacks(titleFallbacks), [manager, titleFallbacks]);

  useEffect(
    () =>
      beginPiSessionManagerLifecycle(manager, managerRef, managerLifecycleRef, (error) =>
        console.error("[workbench-pi] session manager failed to start", error),
      ),
    [manager],
  );

  return (
    <PiSessionManagerProvider manager={manager}>
      <PiWorkspaceSelectionProvider>
        <WorkbenchAgentRuntimeHost adapter={adapter}>
          <ActivePiThreadTracker manager={manager} />
          <PiDraftWorkspaceTracker manager={manager} />
          {children}
        </WorkbenchAgentRuntimeHost>
      </PiWorkspaceSelectionProvider>
    </PiSessionManagerProvider>
  );
}
