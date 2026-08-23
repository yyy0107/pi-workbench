"use client";

import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { AssistantRuntimeProvider, useAui, useAuiState } from "@assistant-ui/react";

import {
  useRightWorkspace,
  useSetWorkspaceContext,
  useWorkspaceFeedbackStore,
} from "@/components/right-workspace";
import { useRightWorkspaceState } from "@/components/right-workspace/workspace-context";
import { PiCommandsProvider } from "@/runtime/pi/client/runtime/command-context";
import { PiSessionManagerProvider } from "@/runtime/pi/client/runtime/context";
import { PiSessionManager } from "@/runtime/pi/client/runtime/manager";
import { piThreadListStructureMatches } from "@/runtime/pi/client/runtime/thread-list-sync";
import { useWorkbenchRuntime } from "@/runtime/use-workbench-runtime";
import { resolvePendingThreadPromotionId } from "@/workbench/workspaces/new-thread-policy";
import { useWorkspaceDirectoryStore } from "@/workbench/workspaces/workspace-directory-store";

import { activeWorkspaceContext } from "./active-workspace-context";

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
  const threadIds = useAuiState((state) => state.threads.threadIds);
  const archivedThreadIds = useAuiState((state) => state.threads.archivedThreadIds);
  const isThreadListLoading = useAuiState((state) => state.threads.isLoading);
  const threadItems = useAuiState((state) => state.threads.threadItems);
  const mainThread = threadItems.find((thread) => thread.id === mainThreadId);
  const [reconcileTick, requestReconcile] = useReducer((value: number) => value + 1, 0);
  const reloadedRevision = useRef(managerRevision);
  const requestedReloadRevision = useRef(managerRevision);
  const reloadTask = useRef<Promise<void> | null>(null);
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
    requestedReloadRevision.current = managerRevision;

    if (reloadDeferred.current) return;
    if (
      isThreadListLoading ||
      reloadTask.current ||
      reloadedRevision.current === requestedReloadRevision.current
    ) {
      return;
    }

    const revision = requestedReloadRevision.current;
    const managedThreads = manager.getThreadListSnapshot();
    if (
      piThreadListStructureMatches(managedThreads, {
        threadIds,
        archivedThreadIds,
        threadItems,
      })
    ) {
      reloadedRevision.current = revision;
      return;
    }

    // RemoteThreadListAdapter is pull-based. Reconcile once only when a host event changes list
    // membership or ordering; metadata-only revisions are rendered from the manager snapshot.
    reloadedRevision.current = revision;
    const task = aui.threads.reload();
    reloadTask.current = task;
    void task
      .catch((error) => console.error("[workbench-pi] thread list reload failed", error))
      .finally(() => {
        if (reloadTask.current === task) reloadTask.current = null;
        requestReconcile();
      });
  }, [
    activeMessageCount,
    archivedThreadIds,
    aui,
    isThreadListLoading,
    mainThreadId,
    mainThread?.remoteId,
    mainThread?.status,
    manager,
    managerRevision,
    newThreadId,
    reconcileTick,
    threadIds,
    threadItems,
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

  useLayoutEffect(() => {
    if (!newThreadId) return;
    manager.setDraftWorkspace(newThreadId, draftWorkspace);
    return () => manager.setDraftWorkspace(newThreadId, undefined);
  }, [draftWorkspace, manager, newThreadId]);

  return null;
}

function ActiveWorkspaceContextTracker() {
  const controller = useRightWorkspace();
  const setContext = useSetWorkspaceContext();
  const surfaceOrder = useRightWorkspaceState((state) => state.surfaceOrder);
  const surfacesById = useRightWorkspaceState((state) => state.surfaces);
  const mainThreadId = useAuiState((state) => state.threads.mainThreadId);
  const mainThread = useAuiState((state) =>
    state.threads.threadItems.find((thread) => thread.id === state.threads.mainThreadId),
  );
  const workspaceId =
    typeof mainThread?.custom?.piWorkspaceId === "string"
      ? mainThread.custom.piWorkspaceId
      : undefined;
  const rootPath =
    typeof mainThread?.custom?.piWorkspaceCwd === "string"
      ? mainThread.custom.piWorkspaceCwd
      : undefined;
  const threadScopeId = mainThread?.remoteId ?? mainThread?.externalId ?? mainThreadId;
  const previousThread = useRef<{ localId?: string; scopeId?: string }>({});

  useLayoutEffect(() => {
    const context = activeWorkspaceContext({
      ...(threadScopeId ? { threadId: threadScopeId } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      ...(rootPath ? { rootPath } : {}),
    });
    setContext(context);
    if (threadScopeId) {
      const previous = previousThread.current;
      const promotedScopeId =
        previous.localId === mainThreadId && previous.scopeId !== threadScopeId
          ? previous.scopeId
          : undefined;
      for (const surfaceId of surfaceOrder) {
        const surface = surfacesById[surfaceId];
        if (
          !surface ||
          (surface.scope.type === "thread" && surface.scope.key !== promotedScopeId)
        ) {
          continue;
        }
        controller.update(surfaceId, { scope: { type: "thread", key: threadScopeId } });
      }
    }
    previousThread.current = { localId: mainThreadId, scopeId: threadScopeId };
    controller.restoreContext(context);
  }, [
    controller,
    mainThreadId,
    rootPath,
    setContext,
    surfaceOrder,
    surfacesById,
    threadScopeId,
    workspaceId,
  ]);

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
        <PiCommandsProvider>
          <ActivePiThreadTracker manager={manager} />
          <PiDraftWorkspaceTracker manager={manager} />
          <ActiveWorkspaceContextTracker />
          {children}
        </PiCommandsProvider>
      </AssistantRuntimeProvider>
    </PiSessionManagerProvider>
  );
}
