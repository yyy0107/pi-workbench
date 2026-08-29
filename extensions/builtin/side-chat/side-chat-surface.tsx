"use client";

import { useLayoutEffect, useRef, useState } from "react";

import type { WorkspaceSurfaceProps } from "@/platform/extensions";
import { PiBoundThreadRuntimeProvider } from "@/runtime/pi/client/assistant-ui/bound-thread-runtime-provider";
import { usePiThreadStateSnapshot } from "@/runtime/pi/client/runtime/context";
import { WorkbenchComposer } from "@/workbench/chat/workbench-composer";
import { WorkbenchConversation } from "@/workbench/chat/workbench-conversation";
import { THREAD_CONTENT_WIDTH_CLASS_NAME } from "@/workbench/chat/thread-content-width";
import { cn } from "@/lib/utils";

import type { SideChatSurfaceParams } from "./side-chat-workspace";

const DEFAULT_SIDE_COMPOSER_DOCK_INSET_PX = 138;

function SideChatConversation({ params }: Readonly<{ params: SideChatSurfaceParams }>) {
  const source = usePiThreadStateSnapshot(params.sourceSessionId);
  const workspace = source.metadata.workspace;
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
    <PiBoundThreadRuntimeProvider
      sessionId={params.scratchSessionId}
      workspace={
        workspace
          ? {
              id: workspace.id,
              name: workspace.name,
              rootPath: workspace.cwd,
              pinned: workspace.pinned,
            }
          : undefined
      }
    >
      <WorkbenchConversation
        threadId={params.scratchSessionId}
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
