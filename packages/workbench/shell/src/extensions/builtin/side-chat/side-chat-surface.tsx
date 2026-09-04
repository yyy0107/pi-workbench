"use client";

import { useLayoutEffect, useRef, useState } from "react";

import type { WorkspaceSurfaceProps } from "@workbench/extension-sdk";
import {
  WorkbenchBoundSessionProvider,
  useWorkbenchScratchSessionCapability,
} from "@workbench/agent-runtime-client/context";
import { WorkbenchComposer } from "@workbench/shell/chat";
import { WorkbenchConversation } from "@workbench/shell/chat";
import { cn } from "@workbench/shell/utils";
import { THREAD_CONTENT_WIDTH_CLASS_NAME } from "@workbench/shell/layout";

import { RuntimeCapabilityUnavailable } from "../../runtime-capability-unavailable";

import type { SideChatSurfaceParams } from "./side-chat-workspace";

const DEFAULT_SIDE_COMPOSER_DOCK_INSET_PX = 138;

function SideChatConversation({ params }: Readonly<{ params: SideChatSurfaceParams }>) {
  const dockRef = useRef<HTMLDivElement>(null);
  const [dockInset, setDockInset] = useState(DEFAULT_SIDE_COMPOSER_DOCK_INSET_PX);

  useLayoutEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;
    const update = () => setDockInset(Math.ceil(dock.getBoundingClientRect().height));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(dock);
    return () => observer.disconnect();
  }, []);

  return (
    <WorkbenchBoundSessionProvider
      sessionId={params.scratchSessionId}
      fallback={<RuntimeCapabilityUnavailable />}
    >
      <WorkbenchConversation
        threadId={params.scratchSessionId}
        sessionId={params.scratchSessionId}
        emptyComposer={<WorkbenchComposer forceExistingThread />}
        composerDock={
          <div
            ref={dockRef}
            data-workbench-side-chat-composer-dock=""
            className={cn(
              THREAD_CONTENT_WIDTH_CLASS_NAME,
              "absolute bottom-0 z-20 mx-auto flex flex-col bg-transparent pt-[var(--composer-dock-top-gap)] pb-[var(--composer-dock-bottom-gap)] [inset-inline:var(--thread-viewport-inline-padding)] [overflow-anchor:none]",
            )}
          >
            <WorkbenchComposer forceExistingThread />
          </div>
        }
        showHistoryLoading
        composerDockInset={dockInset}
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
