"use client";

import type { WorkspaceSurfaceProps } from "@workbench/extension-sdk";
import {
  WorkbenchBoundSessionProvider,
  useWorkbenchScratchSessionCapability,
} from "@workbench/agent-runtime-client/context";
import { WorkbenchComposer, WorkbenchConversation } from "@workbench/shell/chat";

import { RuntimeCapabilityUnavailable } from "../../runtime-capability-unavailable";

import type { SideChatSurfaceParams } from "./side-chat-workspace";

function SideChatConversation({ params }: Readonly<{ params: SideChatSurfaceParams }>) {
  return (
    <WorkbenchBoundSessionProvider
      sessionId={params.scratchSessionId}
      fallback={<RuntimeCapabilityUnavailable />}
    >
      <WorkbenchConversation
        threadId={params.scratchSessionId}
        sessionId={params.scratchSessionId}
        emptyComposer={<WorkbenchComposer forceExistingThread />}
        composerDock={<WorkbenchComposer forceExistingThread />}
        showHistoryLoading
        scrollToBottomOnInitialize
        rootDataSurface="side-chat-conversation"
      />
    </WorkbenchBoundSessionProvider>
  );
}

export function SideChatSurface({ surface }: WorkspaceSurfaceProps<SideChatSurfaceParams>) {
  return useWorkbenchScratchSessionCapability() ? (
    <SideChatConversation params={surface.params} />
  ) : (
    <RuntimeCapabilityUnavailable />
  );
}
