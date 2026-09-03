"use client";

import { useLayoutEffect, useRef, useState } from "react";

import type { WorkspaceSurfaceProps } from "@workbench/extension-sdk";
import { PiBoundThreadRuntimeProvider } from "@workbench/agent-runtime-pi-client/side-chat";
import { WorkbenchComposer } from "@workbench/shell/chat";
import { WorkbenchConversation } from "@workbench/shell/chat";
import { cn } from "@workbench/shell/utils";
import { useWorkbenchAgentThreadSnapshot } from "@workbench/agent-runtime-client/context";
import { THREAD_CONTENT_WIDTH_CLASS_NAME } from "@workbench/shell/layout";

import type { SideChatSurfaceParams } from "./side-chat-workspace";

const DEFAULT_SIDE_COMPOSER_DOCK_INSET_PX = 138;

function SideChatConversation({ params }: Readonly<{ params: SideChatSurfaceParams }>) {
  const source = useWorkbenchAgentThreadSnapshot(params.sourceSessionId);
  const workspace = source.workspace;
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
    <PiBoundThreadRuntimeProvider sessionId={params.scratchSessionId} workspace={workspace}>
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
    </PiBoundThreadRuntimeProvider>
  );
}

export function SideChatSurface({ surface }: WorkspaceSurfaceProps<SideChatSurfaceParams>) {
  return <SideChatConversation params={surface.params} />;
}
