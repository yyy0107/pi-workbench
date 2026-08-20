"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { AssistantRuntimeProvider, useAui, useAuiState } from "@assistant-ui/react";

import { useWorkspaceFeedbackStore } from "@/components/right-workspace";
import { PiSessionManagerProvider } from "@/runtime/pi/client/runtime/context";
import { PiSessionManager } from "@/runtime/pi/client/runtime/manager";
import { useWorkbenchRuntime } from "@/runtime/use-workbench-runtime";
import { resolvePendingThreadPromotionId } from "@/workbench/workspaces/new-thread-policy";
import { useWorkspaceDirectoryStore } from "@/workbench/workspaces/workspace-directory-store";

function ActivePiThreadTracker({ manager }: { manager: PiSessionManager }) {
  const aui = useAui();
  const managerRevision = useSyncExternalStore(
    manager.subscribe,
    manager.getSnapshot,
    manager.getSnapshot,
  );
  const mainThreadId = useAuiState((state) => state.threads.mainThreadId);
  const newThreadId = useAuiState((state) => state.threads.newThreadId);
  const activeMessageCount = useAuiState((state) => state.thread.messages.length);
  const threadItems = useAuiState((state) => state.threads.threadItems);
  const mainThread = threadItems.find((thread) => thread.id === mainThreadId);
  const reloadedRevision = useRef(managerRevision);
  const reloadDeferred = useRef(false);
  const draftThreadId = useRef<string | undefined>(undefined);
  const pendingPromotionThreadId = useRef<string | undefined>(undefined);
  const syncDirectory = useWorkspaceDirectoryStore((state) => state.syncDirectory);
  const revealDirectory = useWorkspaceDirectoryStore((state) => state.revealDirectory);

  if (mainThreadId && mainThreadId === newThreadId) {
    draftThreadId.current = mainThreadId;
  } else if (draftThreadId.current !== mainThreadId) {
    draftThreadId.current = undefined;
  }
  pendingPromotionThreadId.current = resolvePendingThreadPromotionId({
    pendingThreadId:
      pendingPromotionThreadId.current ??
      (draftThreadId.current === mainThreadId ? draftThreadId.current : undefined),
    mainThreadId,
    status: mainThread?.status,
    remoteId: mainThread?.remoteId,
    hasMessages: activeMessageCount > 0,
  });
  if (activeMessageCount > 0) draftThreadId.current = undefined;
  reloadDeferred.current = pendingPromotionThreadId.current === mainThreadId;

  useEffect(() => {
    manager.setActive(mainThreadId, mainThread?.remoteId);
  }, [mainThread?.remoteId, mainThreadId, manager]);

  useEffect(() => {
    if (reloadedRevision.current === managerRevision || reloadDeferred.current) return;
    reloadedRevision.current = managerRevision;
    void aui.threads
      .reload()
      .catch((error) => console.error("[workbench-pi] thread list reload failed", error));
  }, [
    activeMessageCount,
    aui,
    mainThreadId,
    mainThread?.remoteId,
    mainThread?.status,
    managerRevision,
    newThreadId,
  ]);

  useEffect(() => {
    for (const thread of threadItems) {
      if (!thread.remoteId) continue;
      const custom = manager.getThreadCustom(thread.remoteId);
      if (!custom) continue;
      const changed = [
        "piRunning",
        "piPinned",
        "piWorkspaceId",
        "piWorkspaceName",
        "piWorkspaceCwd",
      ].some((key) => thread.custom?.[key] !== custom[key]);
      if (!changed) continue;
      const {
        piRunning: _piRunning,
        piPinned: _piPinned,
        piWorkspaceId: _piWorkspaceId,
        piWorkspaceName: _piWorkspaceName,
        piWorkspaceCwd: _piWorkspaceCwd,
        ...otherCustom
      } = thread.custom ?? {};
      const piCustom = Object.fromEntries(
        Object.entries(custom).filter(([, value]) => value !== undefined),
      );
      aui.threads.item({ id: thread.id }).updateCustom({ ...otherCustom, ...piCustom });
    }
  }, [aui, manager, managerRevision, threadItems]);

  useEffect(() => {
    const custom = mainThread?.remoteId
      ? manager.getThreadCustom(mainThread.remoteId)
      : mainThread?.custom;
    const id = custom?.piWorkspaceId;
    const name = custom?.piWorkspaceName;
    const cwd = custom?.piWorkspaceCwd;
    if (typeof id !== "string" || typeof name !== "string" || typeof cwd !== "string") return;
    syncDirectory({ id, name, cwd });
    revealDirectory(id);
  }, [
    mainThread?.custom,
    mainThread?.remoteId,
    manager,
    managerRevision,
    revealDirectory,
    syncDirectory,
  ]);

  return null;
}

function PiDraftWorkspaceTracker({ manager }: { manager: PiSessionManager }) {
  const newThreadId = useAuiState((state) => state.threads.newThreadId);
  const draftWorkspace = useWorkspaceDirectoryStore((state) =>
    state.directories.find((directory) => directory.id === state.draftDirectoryId),
  );

  useEffect(() => {
    if (!newThreadId) return;
    manager.setDraftWorkspace(newThreadId, draftWorkspace);
    return () => manager.setDraftWorkspace(newThreadId, undefined);
  }, [draftWorkspace, manager, newThreadId]);

  return null;
}

export function WorkbenchAssistantRuntimeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const workspaceFeedback = useWorkspaceFeedbackStore();
  const managerRef = useRef<PiSessionManager | null>(null);
  const managerLifecycleRef = useRef(0);
  if (!managerRef.current) managerRef.current = new PiSessionManager({ workspaceFeedback });
  const manager = managerRef.current;
  const runtime = useWorkbenchRuntime(manager);

  useEffect(() => {
    const lifecycle = ++managerLifecycleRef.current;
    void manager
      .start()
      .catch((error) => console.error("[workbench-pi] session manager failed to start", error));
    return () => {
      // React Strict Effects immediately mounts this effect again in development. Defer the
      // irreversible disposal so the replacement setup can claim the same manager first.
      queueMicrotask(() => {
        if (managerLifecycleRef.current === lifecycle) manager.dispose();
      });
    };
  }, [manager]);

  return (
    <PiSessionManagerProvider manager={manager}>
      <AssistantRuntimeProvider runtime={runtime}>
        <ActivePiThreadTracker manager={manager} />
        <PiDraftWorkspaceTracker manager={manager} />
        {children}
      </AssistantRuntimeProvider>
    </PiSessionManagerProvider>
  );
}
